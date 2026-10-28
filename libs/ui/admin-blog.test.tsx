/**
 * The blog's admin pages (#396), driven in a browser DOM (happy-dom): what the list's chips and
 * search send, the editor's errors and where focus goes, the Preview tab, and what each dialog
 * sends, the newsletter list above all.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import type { AdminBlogListResponse, BlogPost } from "@domain/blog"
import {
  ADMIN_BLOG_NO_FILTER,
  AdminBlogListScreen,
  type AdminBlogListScreenProps,
} from "./admin-blog-list.tsx"
import {
  AdminBlogEditorScreen,
  type AdminBlogEditorScreenProps,
  blogDraftErrors,
  blogDraftOf,
  blogErrorText,
  blogSlugFromTitle,
  emptyBlogDraft,
  followTitle,
} from "./admin-blog-editor.tsx"
import { ADMIN_ENGLISH, ADMIN_PSEUDO, englishLeft } from "./admin-pseudo.ts"

import { I18nContext } from "@spy4x/preact-ui/i18n"
const window = new Window({ url: "http://admin.localhost/blog" })
const own = {
  document: globalThis.document,
  FormData: globalThis.FormData,
  getComputedStyle: globalThis.getComputedStyle,
}

beforeAll(() => {
  Object.assign(globalThis, {
    document: window.document,
    FormData: window.FormData,
    getComputedStyle: window.getComputedStyle.bind(window),
  })
})

afterAll(async () => {
  Object.assign(globalThis, own)
  await window.happyDOM.close()
})

let root: HTMLElement | null = null

afterEach(async () => {
  if (root) await act(() => render(null, root!))
  document.body.innerHTML = ""
  root = null
})

async function mount(node: VNode): Promise<HTMLElement> {
  if (!root) {
    root = document.createElement("div")
    document.body.append(root)
  }
  await act(() => render(node, root!))
  return root
}

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

function has(selector: string): boolean {
  return document.querySelector(selector) !== null
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function clickOn(element: Element): Promise<void> {
  await act(() => {
    element.dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event,
    )
  })
}

/** The button whose text, without its key hint, starts with `text`; inside the open dialog if any. */
function button(text: string): HTMLButtonElement {
  const scope = document.querySelector("dialog") ?? document
  const found = [...scope.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.trim() === text) ??
    [...scope.querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.trim().startsWith(text))
  if (!found) throw new Error(`no button "${text}"`)
  return found as unknown as HTMLButtonElement
}

async function type(selector: string, value: string): Promise<void> {
  const field = find<HTMLInputElement>(selector)
  field.value = value
  await act(() => {
    field.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  })
}

async function submit(selector: string): Promise<void> {
  const form = find(selector).closest("form")!
  await act(async () => {
    form.dispatchEvent(
      new window.SubmitEvent("submit", { bubbles: true, cancelable: true }) as unknown as Event,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

// #region List

const listed: AdminBlogListResponse = {
  posts: [
    {
      id: "0195f0b4-3c1e-7a00-8000-000000000001",
      slug: "hello-world",
      title: "Hello world",
      status: "published",
      topic: "News",
      publishAt: "2026-10-01T10:00:00.000Z",
      publishedAt: "2026-10-01T10:00:00.000Z",
      updatedAt: "2026-10-02T10:00:00.000Z",
    },
  ],
  counts: { all: 3, draft: 1, scheduled: 1, published: 1 },
}

function listProps(
  calls: unknown[][],
  overrides: Partial<AdminBlogListScreenProps> = {},
): AdminBlogListScreenProps {
  return {
    filter: ADMIN_BLOG_NO_FILTER,
    list: listed,
    pending: false,
    error: null,
    onFilter: (filter) => calls.push(["filter", filter]),
    onRetry: () => calls.push(["retry"]),
    ...overrides,
  }
}

describe("the blog list", () => {
  it("counts each status on its chip and filters by the chip pressed", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogListScreen {...listProps(calls)} />)
    const chips = [...document.querySelectorAll("[data-e2e=admin-blog-status] button")]
      .map((chip) => chip.textContent?.trim())
    expect(chips).toEqual(["All 3", "Drafts 1", "Scheduled 1", "Published 1"])
    await clickOn(button("Scheduled"))
    expect(calls).toEqual([["filter", { status: "scheduled", query: "" }]])
  })

  it("searches by title or slug, and links each title to its editor", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogListScreen {...listProps(calls)} />)
    find<HTMLInputElement>("[data-e2e=admin-blog-search]").value = "  hello "
    await submit("[data-e2e=admin-blog-search]")
    expect(calls).toEqual([["filter", { status: null, query: "hello" }]])
    expect(find("[data-e2e=admin-blog-row]").getAttribute("href"))
      .toBe("/blog/0195f0b4-3c1e-7a00-8000-000000000001")
  })

  it("says no post exists yet only while nothing is searched", async () => {
    const none = { posts: [], counts: { all: 0, draft: 0, scheduled: 0, published: 0 } }
    await mount(<AdminBlogListScreen {...listProps([], { list: none })} />)
    expect(find("[data-e2e=admin-blog-none]").textContent).toContain("No posts yet")
    await mount(
      <AdminBlogListScreen
        {...listProps([], { list: none, filter: { status: null, query: "x" } })}
      />,
    )
    expect(has("[data-e2e=admin-blog-none]")).toBe(false)
    expect(find("[data-e2e=admin-blog-list]").textContent).toContain("Nothing matches")
    expect(has("[data-e2e=admin-blog-clear]")).toBe(true)
  })

  it("says the list failed in its own words and tries again", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogListScreen {...listProps(calls, { list: null, error: "boom" })} />)
    expect(find("[data-e2e=admin-blog-error]").textContent)
      .toContain("Posts could not be loaded. Try again in a moment.")
    await clickOn(button("Try again"))
    expect(calls).toEqual([["retry"]])
  })
})

// #endregion

// #region Editor

const saved: BlogPost = {
  id: "0195f0b4-3c1e-7a00-8000-000000000002",
  slug: "jobs-explained",
  title: "Jobs explained",
  seoTitle: null,
  description: "How the worker runs jobs.",
  tldr: ["Jobs run in the background"],
  topic: "Infra",
  coverUrl: null,
  coverAlt: null,
  bodyMd: "## Why\n\nIt is fast.",
  status: "draft",
  publishAt: null,
  publishedAt: null,
  contentUpdatedAt: null,
  authorId: 7,
  authorName: "Ann",
  newsletterList: null,
  newsletterSentAt: null,
  newsletterRecipients: null,
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
  version: 3,
}

const NOW = new Date("2026-10-23T10:00:00.000Z")

function editorProps(
  calls: unknown[][],
  overrides: Partial<AdminBlogEditorScreenProps> = {},
): AdminBlogEditorScreenProps {
  const post = overrides.post === undefined ? saved : overrides.post
  return {
    post,
    loading: false,
    notFound: false,
    loadError: null,
    onRetry: () => calls.push(["retry"]),
    value: post ? blogDraftOf(post) : emptyBlogDraft(),
    onChange: (value) => calls.push(["change", value]),
    errors: {},
    saveStatus: "saved",
    conflict: false,
    onReload: () => calls.push(["reload"]),
    onSave: () => calls.push(["save"]),
    significantUpdate: false,
    onSignificantUpdate: (value) => calls.push(["significant", value]),
    topics: ["Infra"],
    newsletter: { enabled: true, lists: [{ list: "news", confirmed: 12 }], siteUrl: null },
    siteUrl: "https://www.example.com",
    preview: null,
    previewPending: false,
    previewError: null,
    onPreview: () => calls.push(["preview"]),
    dialog: null,
    dialogPending: false,
    dialogError: null,
    onOpenDialog: (dialog) => calls.push(["open", dialog]),
    onCloseDialog: () => calls.push(["close"]),
    onPublish: (choice) => calls.push(["publish", choice]),
    onUnschedule: () => calls.push(["unschedule"]),
    onUnpublish: () => calls.push(["unpublish"]),
    onChangeUrl: (slug) => calls.push(["change-url", slug]),
    onDelete: () => calls.push(["delete"]),
    now: NOW,
    ...overrides,
  }
}

const scheduled: BlogPost = {
  ...saved,
  status: "scheduled",
  publishAt: "2026-11-01T09:00:00.000Z",
  newsletterList: "news",
}

describe("the blog editor", () => {
  it("passes each typed field up and saves on submit", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogEditorScreen {...editorProps(calls)} />)
    await type("[data-e2e=admin-blog-title-field]", "Jobs, explained")
    expect(calls).toEqual([["change", { ...blogDraftOf(saved), title: "Jobs, explained" }]])
    await submit("[data-e2e=admin-blog-title-field]")
    expect(calls.at(-1)).toEqual(["save"])
  })

  it("opens the folded settings and focuses the first field in error", async () => {
    await mount(<AdminBlogEditorScreen {...editorProps([])} />)
    expect(find("[data-e2e=admin-blog-settings-toggle]").getAttribute("aria-expanded"))
      .toBe("false")
    await mount(
      <AdminBlogEditorScreen
        {...editorProps([], { errors: { slug: "Add a slug.", coverAlt: "Describe it." } })}
      />,
    )
    await settle()
    expect(find("[data-e2e=admin-blog-settings-toggle]").getAttribute("aria-expanded"))
      .toBe("true")
    expect(document.activeElement?.id).toBe("blog-slug")
    expect(find("[data-e2e=admin-blog-settings]").textContent).toContain("Add a slug.")
  })

  it("asks the API for the preview when the Preview tab opens, and shows its HTML under an h2 title", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogEditorScreen {...editorProps(calls)} />)
    await clickOn(find("#preview-tab"))
    expect(calls).toEqual([["preview"]])
    await mount(
      <AdminBlogEditorScreen
        {...editorProps(calls, {
          preview: { html: "<h2>Why</h2><p>It is fast.</p>", words: 4, readingMinutes: 1 },
        })}
      />,
    )
    const preview = find("[data-e2e=admin-blog-preview]")
    // The page's h1 is "Edit post": the preview's title is an h2, its key points an h3.
    expect([...preview.querySelectorAll("h1, h2, h3")].map((h) => `${h.tagName} ${h.textContent}`))
      .toEqual(["H2 Jobs explained", "H3 In short", "H2 Why"])
  })

  it("gives the field and its caret back once a save is done, so typing goes on there", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogEditorScreen {...editorProps(calls)} />)
    const body = find<HTMLTextAreaElement>("[data-e2e=admin-blog-body]")
    body.focus()
    body.setSelectionRange(5, 5)
    await submit("[data-e2e=admin-blog-body]")
    expect(calls.at(-1)).toEqual(["save"])
    // Saving disables the form, which drops focus to the page and the caret with it.
    await mount(<AdminBlogEditorScreen {...editorProps(calls, { saveStatus: "saving" })} />)
    body.blur()
    body.setSelectionRange(0, 0)
    await mount(<AdminBlogEditorScreen {...editorProps(calls, { saveStatus: "saved" })} />)
    await settle()
    expect(document.activeElement?.getAttribute("data-e2e")).toBe("admin-blog-body")
    expect([body.selectionStart, body.selectionEnd]).toEqual([5, 5])
  })

  it("moves focus to the page title once publishing closes the dialog", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogEditorScreen {...editorProps(calls, { dialog: "publish" })} />)
    await clickOn(button("Publish"))
    const published = { ...saved, status: "published" as const, publishedAt: NOW.toISOString() }
    await mount(<AdminBlogEditorScreen {...editorProps(calls, { post: published })} />)
    await settle()
    expect(document.activeElement?.getAttribute("data-e2e")).toBe("admin-blog-editor-title")
  })

  it("says when a published post went live and was last updated, with a space before the middle dot", async () => {
    const post = {
      ...saved,
      status: "published" as const,
      publishedAt: "2026-10-01T10:00:00.000Z",
      contentUpdatedAt: "2026-10-20T10:00:00.000Z",
    }
    await mount(<AdminBlogEditorScreen {...editorProps([], { post })} />)
    expect(find("[data-e2e=admin-blog-publishing]").textContent).toMatch(
      /^Published [^·]*\S · Updated [^·]+\./,
    )
  })

  it("publishes a draft now without email until the box is ticked", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogEditorScreen {...editorProps(calls, { dialog: "publish" })} />)
    const email = find<HTMLInputElement>(
      "[data-e2e=admin-blog-email] input, input[data-e2e=admin-blog-email]",
    )
    expect(email.checked).toBe(false)
    expect(document.body.textContent).toContain("Also email this post to 12 confirmed subscribers")
    await clickOn(button("Publish"))
    expect(calls).toEqual([["publish", { at: null, list: null }]])
    await clickOn(email)
    expect(document.body.textContent).toContain("It cannot be unsent.")
    await clickOn(button("Publish and email 12"))
    expect(calls.at(-1)).toEqual(["publish", { at: null, list: "news" }])
  })

  it("keeps a scheduled post's list when it is published now or moved, unless unticked", async () => {
    const calls: unknown[][] = []
    await mount(
      <AdminBlogEditorScreen
        {...editorProps(calls, { post: scheduled, dialog: "publish-now" })}
      />,
    )
    await clickOn(button("Publish and email 12"))
    expect(calls.at(-1)).toEqual(["publish", { at: null, list: "news" }])
    await clickOn(find("input[data-e2e=admin-blog-email], [data-e2e=admin-blog-email] input"))
    await clickOn(button("Publish"))
    expect(calls.at(-1)).toEqual(["publish", { at: null, list: null }])

    await mount(<AdminBlogEditorScreen {...editorProps([], { post: null })} />)
    await mount(
      <AdminBlogEditorScreen
        {...editorProps(calls, { post: scheduled, dialog: "reschedule", newsletter: null })}
      />,
    )
    await clickOn(button("Schedule"))
    expect(calls.at(-1)).toEqual(["publish", { at: scheduled.publishAt, list: "news" }])
  })

  it("refuses a time in the past before it asks the API", async () => {
    const calls: unknown[][] = []
    await mount(
      <AdminBlogEditorScreen
        {...editorProps(calls, {
          post: { ...scheduled, publishAt: "2026-10-01T09:00:00.000Z" },
          dialog: "reschedule",
        })}
      />,
    )
    await clickOn(button("Schedule"))
    expect(calls).toEqual([])
    expect(document.body.textContent).toContain("Pick a time in the future.")
  })

  it("offers no email once the post was sent, and says when it went", async () => {
    const sent: BlogPost = {
      ...saved,
      status: "published",
      publishAt: "2026-10-01T09:00:00.000Z",
      publishedAt: "2026-10-01T09:00:00.000Z",
      newsletterList: "news",
      newsletterSentAt: "2026-10-01T09:00:05.000Z",
      newsletterRecipients: 312,
    }
    await mount(<AdminBlogEditorScreen {...editorProps([], { post: sent })} />)
    expect(find("[data-e2e=admin-blog-emailed]").textContent).toContain("Emailed to 312 on")
    expect(find<HTMLInputElement>("[data-e2e=admin-blog-slug]").readOnly).toBe(true)
    await mount(
      <AdminBlogEditorScreen
        {...editorProps([], { post: { ...sent, status: "scheduled" }, dialog: "publish-now" })}
      />,
    )
    expect(has("[data-e2e=admin-blog-email]")).toBe(false)
  })

  it("confirms a delete in a dialog that names the post", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogEditorScreen {...editorProps(calls, { dialog: "delete" })} />)
    expect(document.body.textContent).toContain(`Delete "Jobs explained"?`)
    await clickOn(button("Delete post"))
    expect(calls).toEqual([["delete"]])
  })

  it("holds back saving and publishing while someone else's change is not reloaded", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogEditorScreen {...editorProps(calls, { conflict: true })} />)
    expect(find("[data-e2e=admin-blog-conflict]").textContent)
      .toContain("Someone else changed this post. Reload to see their version.")
    expect(find<HTMLButtonElement>("[data-e2e=admin-blog-publish]").disabled).toBe(true)
    await clickOn(button("Reload"))
    expect(calls).toEqual([["reload"]])
  })
})

// #endregion

describe("the editor's rules", () => {
  it("suggests a slug of the address's letters only", () => {
    expect(blogSlugFromTitle("Why Deno? (and not Node)")).toBe("why-deno-and-not-node")
    expect(blogSlugFromTitle("Café — crème brûlée")).toBe("cafe-creme-brulee")
    expect(blogSlugFromTitle("Привет, мир")).toBe("")
  })

  it("moves the slug with the title until the slug is typed or the post was published", () => {
    const start = { ...emptyBlogDraft(), title: "Old", slug: "old" }
    expect(followTitle(start, { ...start, title: "New title" }, false).slug).toBe("new-title")
    expect(followTitle(start, { ...start, title: "New title" }, true).slug).toBe("old")
    const typed = { ...start, slug: "my-own" }
    expect(followTitle(typed, { ...typed, title: "New title" }, false).slug).toBe("my-own")
  })

  it("checks the fields in the page's words, and the body only for publishing", () => {
    const blogDraftWords = (...args: Parameters<typeof blogDraftErrors>) =>
      Object.fromEntries(
        Object.entries(blogDraftErrors(...args)).map((
          [field, key],
        ) => [field, blogErrorText(ADMIN_ENGLISH, key)]),
      )
    expect(blogDraftWords(emptyBlogDraft())).toEqual({
      title: "Add a title.",
      slug: "Add a slug.",
      description: "Add a description.",
    })
    const draft = {
      ...emptyBlogDraft(),
      title: "T",
      slug: "Bad Slug",
      description: "D",
      coverUrl: "http://example.com/a.png",
    }
    expect(blogDraftWords(draft)).toEqual({
      slug: "Use lowercase letters, digits and hyphens only.",
      coverUrl: "Start the link with https://.",
      coverAlt: "Describe the cover image.",
    })
    const ok = { ...emptyBlogDraft(), title: "T", slug: "t", description: "D" }
    expect(blogDraftWords(ok)).toEqual({})
    expect(blogDraftWords(ok, true)).toEqual({ bodyMd: "The post is empty." })
  })
})

describe("the blog screens in en-XA", () => {
  it("shows no English outside the catalog: every word is pseudo-language or data", async () => {
    await mount(
      <I18nContext.Provider value={ADMIN_PSEUDO}>
        <AdminBlogListScreen {...listProps([])} />
        <AdminBlogEditorScreen {...editorProps([], { dialog: "publish" })} />
        <AdminBlogEditorScreen {...editorProps([], { dialog: "delete" })} />
      </I18nContext.Provider>,
    )
    expect(englishLeft(document.body, [`Hello world`, `News`, /\/blog\/[a-z-]+/g])).toEqual([])
  })
})
