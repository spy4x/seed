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
import type {
  AdminBlogListResponse,
  BlogPost,
  BlogProblem,
  BlogRevision,
  BlogRevisionSummary,
} from "@domain/blog"
import { useState } from "preact/hooks"
import { LANGUAGES } from "@domain/identity"
import { languageName } from "@spy4x/preact-ui/language-picker"
import {
  ADMIN_BLOG_NO_FILTER,
  AdminBlogListScreen,
  type AdminBlogListScreenProps,
} from "./admin-blog-list.tsx"
import {
  AdminBlogEditorScreen,
  type AdminBlogEditorScreenProps,
  type BlogDialog,
  type BlogDraft,
  blogDraftErrors,
  blogDraftOf,
  blogErrorText,
  blogSlugFromTitle,
  emptyBlogDraft,
  followTitle,
} from "./admin-blog-editor.tsx"
import { ADMIN_ENGLISH, ADMIN_PSEUDO, englishLeft } from "./i18n-testing.ts"
import { type BlogHistoryState, NO_BLOG_HISTORY } from "./admin-blog-history.tsx"

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

async function choose(selector: string, value: string): Promise<void> {
  const field = find<HTMLSelectElement>(selector)
  field.value = value
  await act(() => {
    field.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event)
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
      language: "en",
      translationOf: null,
      publishAt: "2026-10-01T10:00:00.000Z",
      publishedAt: "2026-10-01T10:00:00.000Z",
      updatedAt: "2026-10-02T10:00:00.000Z",
      coverUrl: null,
      coverAlt: null,
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
      .toContain("Couldn't load posts. Try again in a moment.")
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
  coverFile: null,
  intro: null,
  relatedFeature: null,
  bodyMd: "## Why\n\nIt is fast.",
  language: "en",
  translationOf: null,
  status: "draft",
  publishAt: null,
  publishedAt: null,
  contentUpdatedAt: null,
  authorId: 7,
  authorName: "Ann",
  authorUrl: null,
  newsletterList: null,
  newsletterSentAt: null,
  newsletterRecipients: null,
  crosspostedAt: null,
  devtoUrl: null,
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
    originals: [],
    newsletter: {
      enabled: true,
      lists: [{ list: "news", byLanguage: { en: 12, de: 3 } }],
      siteUrl: null,
    },
    siteUrl: "https://www.example.com",
    preview: null,
    previewPending: false,
    previewError: null,
    onPreview: () => calls.push(["preview"]),
    problems: [],
    figureExample: null,
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
    history: NO_BLOG_HISTORY,
    onSelectRevision: (id) => calls.push(["select-revision", id]),
    onRestoreRevision: (revision) => calls.push(["restore", revision.id]),
    onRetryHistory: () => calls.push(["retry-history"]),
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

  it("sets the post's language, and the post it translates from those in other languages, taking its cover (#527, #733)", async () => {
    const calls: unknown[][] = []
    const english = {
      id: "01a184ae-0000-7000-8000-000000000001",
      title: "Hello world",
      language: "en" as const,
      coverUrl: "https://images.example.com/hello.webp",
      coverAlt: "A seedling",
    }
    const german = {
      id: "01a184ae-0000-7000-8000-000000000002",
      title: "Hallo",
      language: "de" as const,
      coverUrl: null,
      coverAlt: null,
    }
    const value = { ...blogDraftOf(saved), language: "de" as const }
    await mount(
      <AdminBlogEditorScreen {...editorProps(calls, { value, originals: [english, german] })} />,
    )
    const translationOf = find<HTMLSelectElement>(
      "select[data-e2e=admin-blog-translation-of]",
    )
    expect([...translationOf.options].map((option) => option.value)).toEqual(["", english.id])

    await choose(
      "select[data-e2e=admin-blog-language]",
      "es",
    )
    await choose(
      "select[data-e2e=admin-blog-translation-of]",
      english.id,
    )

    expect(calls).toEqual([
      ["change", { ...value, language: "es" }],
      ["change", {
        ...value,
        translationOf: english.id,
        coverUrl: "https://images.example.com/hello.webp",
        coverAlt: "A seedling",
      }],
    ])
  })

  it("groups the settings under four headings, in the order focus follows (#733)", async () => {
    await mount(<AdminBlogEditorScreen {...editorProps([])} />)
    const groups = [...document.querySelectorAll("[data-e2e=admin-blog-settings] section h2")]
    expect(groups.map((heading) => heading.textContent)).toEqual([
      "Address & language",
      "Summary",
      "Cover",
      "Links",
    ])
    const inGroup = (group: string) =>
      [...find(`[data-e2e=admin-blog-group-${group}]`).querySelectorAll("[data-e2e]")]
        .map((element) => element.getAttribute("data-e2e"))
    expect(inGroup("address")).toEqual([
      "admin-blog-slug",
      "admin-blog-language",
      "admin-blog-translation-of",
      "admin-blog-topic",
    ])
    expect(inGroup("cover")).toEqual(["admin-blog-cover-url"])
    expect(inGroup("links")).toEqual(["admin-blog-related-feature", "admin-blog-author-url"])
    expect(find("[data-e2e=admin-blog-group-cover]").getAttribute("aria-labelledby"))
      .toBe("admin-blog-group-cover-heading")

    await mount(
      <AdminBlogEditorScreen
        {...editorProps([], { errors: { relatedFeature: "Bad.", coverUrl: "Bad." } })}
      />,
    )
    await settle()
    expect(document.activeElement?.getAttribute("data-e2e")).toBe("admin-blog-cover-url")
  })

  it("draws a cover address as a 16:9 thumbnail, and says so when the picture does not load (#733)", async () => {
    const value = {
      ...blogDraftOf(saved),
      coverUrl: "https://images.example.com/a.webp",
      coverAlt: "A chart",
    }
    await mount(<AdminBlogEditorScreen {...editorProps([], { value })} />)
    const thumbnail = find<HTMLImageElement>("[data-e2e=admin-blog-cover-thumbnail]")
    expect(thumbnail.getAttribute("src")).toBe("https://images.example.com/a.webp")
    expect(thumbnail.className).toContain("aspect-video")
    expect(find("[data-e2e=admin-blog-group-cover]").textContent).toContain(
      "A 16:9 picture, https:// address.",
    )

    await act(() => {
      thumbnail.dispatchEvent(new window.Event("error") as unknown as Event)
    })
    expect(has("[data-e2e=admin-blog-cover-thumbnail]")).toBe(false)
    expect(find("[data-e2e=admin-blog-cover-broken]").textContent).toBe(
      "This picture did not load.",
    )
  })

  it("shows a translation the cover of its original, read-only, instead of the cover fields (#733)", async () => {
    const english = {
      id: "01a184ae-0000-7000-8000-000000000001",
      title: "Hello world",
      language: "en" as const,
      coverUrl: "https://images.example.com/hello.webp",
      coverAlt: "A seedling",
    }
    const value = {
      ...blogDraftOf(saved),
      language: "de" as const,
      translationOf: english.id,
      coverUrl: english.coverUrl,
      coverAlt: english.coverAlt,
    }
    await mount(<AdminBlogEditorScreen {...editorProps([], { value, originals: [english] })} />)
    expect(has("[data-e2e=admin-blog-cover-url]")).toBe(false)
    expect(has("[data-e2e=admin-blog-cover-alt]")).toBe(false)
    expect(find("[data-e2e=admin-blog-cover-of]").textContent).toBe(
      "Uses the cover of: Hello world",
    )
    expect(find<HTMLImageElement>("[data-e2e=admin-blog-cover-thumbnail]").getAttribute("src"))
      .toBe(english.coverUrl)
  })

  it("says where an empty slug comes from instead of drawing a placeholder address", async () => {
    const empty = emptyBlogDraft()
    await mount(<AdminBlogEditorScreen {...editorProps([], { post: null, value: empty })} />)
    const settings = find("[data-e2e=admin-blog-settings]")
    expect(settings.textContent).toContain(
      "Filled in from the title. Lowercase letters, digits and hyphens.",
    )
    expect(settings.textContent).not.toContain("{slug}")
    expect(settings.textContent).not.toContain("The post's URL")

    const value = { ...empty, slug: "hello-world" }
    await mount(<AdminBlogEditorScreen {...editorProps([], { post: null, value })} />)
    expect(find("[data-e2e=admin-blog-settings]").textContent).toContain(
      "The post's URL: /blog/hello-world. Lowercase letters, digits and hyphens.",
    )
  })

  it("shows no reading time for an empty post, and counts from the first word", async () => {
    const empty = emptyBlogDraft()
    await mount(<AdminBlogEditorScreen {...editorProps([], { post: null, value: empty })} />)
    expect(has("[data-e2e=admin-blog-words]")).toBe(false)

    const one = { ...empty, bodyMd: "Hello" }
    await mount(<AdminBlogEditorScreen {...editorProps([], { post: null, value: one })} />)
    expect(find("[data-e2e=admin-blog-words]").textContent).toBe("1 word · 1 min read")
  })

  it("passes a typed author link up, and shows its error under the field and focuses it (#730)", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogEditorScreen {...editorProps(calls)} />)
    const field = find<HTMLInputElement>("[data-e2e=admin-blog-author-url]")
    expect(field.type).toBe("url")
    expect(document.querySelector(`label[for="${field.id}"]`)?.textContent).toBe("Author link")
    await type("[data-e2e=admin-blog-author-url]", "https://example.com/about")
    expect(calls).toEqual([
      ["change", { ...blogDraftOf(saved), authorUrl: "https://example.com/about" }],
    ])
    await submit("[data-e2e=admin-blog-author-url]")
    expect(calls.at(-1)).toEqual(["save"])

    await mount(
      <AdminBlogEditorScreen
        {...editorProps([], { errors: { authorUrl: "AdminBlogEditor.httpsCover" } })}
      />,
    )
    await settle()
    const refused = find<HTMLInputElement>("[data-e2e=admin-blog-author-url]")
    expect(document.activeElement).toBe(refused)
    const described = refused.getAttribute("aria-describedby") ?? ""
    const error = described.split(" ").map((id) => document.getElementById(id)?.textContent)
    expect(error).toContain("Start the link with https://.")
  })

  it("shows a saved author link in its field, and an empty field for none (#730)", async () => {
    await mount(
      <AdminBlogEditorScreen
        {...editorProps([], { post: { ...saved, authorUrl: "https://example.com/about" } })}
      />,
    )
    expect(find<HTMLInputElement>("[data-e2e=admin-blog-author-url]").value)
      .toBe("https://example.com/about")
    expect(blogDraftOf(saved).authorUrl).toBe("")
  })

  it("passes a typed intro and related feature up, and shows saved ones in their fields (#733)", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogEditorScreen {...editorProps(calls)} />)
    const intro = find<HTMLTextAreaElement>("[data-e2e=admin-blog-intro]")
    expect(document.querySelector(`label[for="${intro.id}"]`)?.textContent).toBe("Intro")
    await type("[data-e2e=admin-blog-intro]", "Two sentences.")
    await type("[data-e2e=admin-blog-related-feature]", "realtime")
    expect(calls).toEqual([
      ["change", { ...blogDraftOf(saved), intro: "Two sentences." }],
      ["change", { ...blogDraftOf(saved), relatedFeature: "realtime" }],
    ])

    await mount(
      <AdminBlogEditorScreen
        {...editorProps([], {
          post: { ...saved, intro: "Saved intro.", relatedFeature: "offline" },
        })}
      />,
    )
    expect(find<HTMLTextAreaElement>("[data-e2e=admin-blog-intro]").value).toBe("Saved intro.")
    expect(find<HTMLInputElement>("[data-e2e=admin-blog-related-feature]").value).toBe("offline")
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
          preview: {
            parts: [{ kind: "html", html: "<h2>Why</h2><p>It is fast.</p>" }],
            words: 4,
            readingMinutes: 1,
          },
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

  it("offers Now and Schedule as the times to publish", async () => {
    await mount(<AdminBlogEditorScreen {...editorProps([], { dialog: "publish" })} />)
    const when = find("[data-e2e=admin-blog-when]")
    expect(when.querySelector("legend")?.textContent).toBe("When")
    expect([...when.querySelectorAll("label")].map((label) => label.textContent?.trim()))
      .toEqual(["Now", "Schedule"])
  })

  it("publishes a draft now without email until the box is ticked", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogEditorScreen {...editorProps(calls, { dialog: "publish" })} />)
    const email = find<HTMLInputElement>(
      "[data-e2e=admin-blog-email] input, input[data-e2e=admin-blog-email]",
    )
    expect(email.checked).toBe(false)
    expect(document.body.textContent).toContain(
      "Also email this post to 12 confirmed subscribers in English",
    )
    await clickOn(button("Publish"))
    expect(calls).toEqual([["publish", { at: null, list: null }]])
    await clickOn(email)
    expect(document.body.textContent).toContain("You can't unsend it.")
    await clickOn(button("Publish and email 12"))
    expect(calls.at(-1)).toEqual(["publish", { at: null, list: "news" }])
  })

  it("counts only the subscribers of the post's language as the issue's readers, and names it (#527, #530)", async () => {
    const value = { ...blogDraftOf(saved), language: "de" as const }
    await mount(<AdminBlogEditorScreen {...editorProps([], { dialog: "publish", value })} />)
    expect(document.body.textContent).toContain(
      "Also email this post to 3 confirmed subscribers in Deutsch",
    )
    expect(find("dialog[open] span[lang=de]").textContent).toBe("Deutsch")
    // The checkbox's label is a flex row: the sentence must be one item, or its words spread out.
    const label = find("dialog[open] span[lang=de]").closest("label")!
    expect([...label.childNodes].map((node) => node.nodeName)).toEqual(["INPUT", "SPAN"])
    expect(label.children[1].textContent).toBe(
      "Also email this post to 3 confirmed subscribers in Deutsch",
    )
    expect(find("dialog[open]").textContent).toContain(`It goes live at /de/blog/${value.slug}`)
    await clickOn(
      find("[data-e2e=admin-blog-email] input, input[data-e2e=admin-blog-email]"),
    )
    expect(find("[data-e2e=admin-blog-email-hint]").textContent).toContain(
      "Only subscribers who signed up in the post's language get it.",
    )
    expect(button("Publish and email 3")).toBeTruthy()
  })

  it("offers no email to a language with no confirmed subscribers, and publishes without one (#530)", async () => {
    const calls: unknown[][] = []
    const value = { ...blogDraftOf(saved), language: "es" as const }
    await mount(
      <AdminBlogEditorScreen
        {...editorProps(calls, { post: scheduled, dialog: "publish-now", value })}
      />,
    )
    expect(has("[data-e2e=admin-blog-email]")).toBe(false)
    expect(document.body.textContent).not.toContain("Also email")
    expect(find("[data-e2e=admin-blog-email-none]").textContent).toBe(
      "No confirmed subscribers in Español yet, so this post can't be emailed.",
    )
    await clickOn(button("Publish"))
    expect(calls).toEqual([["publish", { at: null, list: null }]])
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

  it("drops a scheduled post's list while the newsletter is off, and says so (#414)", async () => {
    const calls: unknown[][] = []
    const off = { enabled: false, lists: [], siteUrl: null }
    for (const dialog of ["publish-now", "reschedule"] as const) {
      await mount(<AdminBlogEditorScreen {...editorProps([], { post: null })} />)
      await mount(
        <AdminBlogEditorScreen
          {...editorProps(calls, { post: scheduled, dialog, newsletter: off })}
        />,
      )
      expect(find("[data-e2e=admin-blog-email-off]").textContent).toBe(
        "The newsletter is off, so this post won't be emailed to the news list.",
      )
      await clickOn(button(dialog === "reschedule" ? "Schedule" : "Publish"))
      expect(calls.at(-1)).toEqual([
        "publish",
        { at: dialog === "reschedule" ? scheduled.publishAt : null, list: null },
      ])
    }
  })

  it("says nothing was emailed for a post settled with no list (#414)", async () => {
    const settled: BlogPost = {
      ...saved,
      status: "published",
      publishedAt: "2026-10-01T09:00:00.000Z",
      newsletterSentAt: "2026-10-01T09:00:05.000Z",
    }
    await mount(<AdminBlogEditorScreen {...editorProps([], { post: settled })} />)
    expect(has("[data-e2e=admin-blog-publishing]")).toBe(true)
    expect(has("[data-e2e=admin-blog-emailed]")).toBe(false)
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
      crosspostedAt: null,
      devtoUrl: null,
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

  it("says the old address, in the post's own language, keeps working when the URL changes, and sends the new slug (#418, #530)", async () => {
    const calls: unknown[][] = []
    const live: BlogPost = {
      ...saved,
      language: "de",
      status: "published",
      publishAt: "2026-10-01T09:00:00.000Z",
      publishedAt: "2026-10-01T09:00:00.000Z",
    }
    // The draft's language is not saved yet: the old address is the saved one's.
    const value = { ...blogDraftOf(live), language: "es" as const }
    await mount(
      <AdminBlogEditorScreen
        {...editorProps(calls, { post: live, value, dialog: "change-url" })}
      />,
    )
    expect(find("dialog[open]").textContent).toContain(
      "Links to /de/blog/jobs-explained keep working: they redirect to the new URL.",
    )
    expect(document.body.textContent).toContain(
      "Locked once published. Use Change URL… to change it; old links redirect to the new one.",
    )
    // Old links redirect, so nothing is lost: the dialog is not drawn as a destructive one.
    expect(button("Change URL").className).not.toContain("danger")
    await type("[data-e2e=admin-blog-new-slug]", "jobs-in-depth")
    await clickOn(button("Change URL"))
    expect(calls.at(-1)).toEqual(["change-url", "jobs-in-depth"])
  })

  it("says where a published post moves when its language changes, and nothing for a draft (#530)", async () => {
    const live: BlogPost = {
      ...saved,
      status: "published",
      publishAt: "2026-10-01T09:00:00.000Z",
      publishedAt: "2026-10-01T09:00:00.000Z",
    }
    const value = { ...blogDraftOf(live), language: "de" as const }
    await mount(<AdminBlogEditorScreen {...editorProps([], { post: live, value })} />)
    expect(find("[data-e2e=admin-blog-language-moves]").textContent).toBe(
      "Saving moves the post to /de/blog/jobs-explained. Its old address redirects there.",
    )

    await mount(<AdminBlogEditorScreen {...editorProps([], { post: live })} />)
    expect(has("[data-e2e=admin-blog-language-moves]")).toBe(false)
    await mount(<AdminBlogEditorScreen {...editorProps([], { value })} />)
    expect(has("[data-e2e=admin-blog-language-moves]")).toBe(false)
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

// #region History (#418)

/** Two earlier versions of `saved`, newest first: Lee's rewrite and the first draft. */
const REVISIONS: BlogRevision[] = [
  {
    ...blogDraftOf(saved),
    seoTitle: null,
    topic: null,
    coverUrl: null,
    coverAlt: null,
    authorUrl: null,
    translationOf: null,
    id: "019a0f00-0000-7000-8000-000000000002",
    savedAt: "2026-10-23T09:57:00.000Z",
    savedBy: "Lee Park",
    title: "Jobs, rewritten",
    bodyMd: "Worse.",
  },
  {
    ...blogDraftOf(saved),
    seoTitle: null,
    topic: null,
    coverUrl: null,
    coverAlt: null,
    authorUrl: null,
    translationOf: null,
    id: "019a0f00-0000-7000-8000-000000000001",
    savedAt: "2026-10-22T10:00:00.000Z",
    savedBy: null,
    title: "Jobs, first draft",
    description: "The first description.",
    bodyMd: "The good paragraph.\n\nAnd a second one.",
  },
]

const summaryOf = ({ id, savedAt, savedBy, title }: BlogRevision): BlogRevisionSummary => ({
  id,
  savedAt,
  savedBy,
  title,
})

/**
 * The editor with what the admin app's state does around History: opening it reads the list and
 * the newest version, picking one reads it, and restoring puts its fields in the editor.
 */
function HistoryHarness(
  { calls, revisions }: { calls: unknown[][]; revisions: BlogRevision[] },
) {
  const [dialog, setDialog] = useState<BlogDialog | null>(null)
  const [value, setValue] = useState<BlogDraft>(blogDraftOf(saved))
  const [history, setHistory] = useState<BlogHistoryState>(NO_BLOG_HISTORY)
  const pick = (id: string) =>
    setHistory((open) => ({
      ...open,
      selectedId: id,
      selected: revisions.find((revision) => revision.id === id) ?? null,
    }))
  return (
    <AdminBlogEditorScreen
      {...editorProps(calls, {
        dialog,
        value,
        history,
        saveStatus: value.title === saved.title ? "saved" : "unsaved",
        onOpenDialog: (next) => {
          setDialog(next)
          setHistory({ ...NO_BLOG_HISTORY, revisions: revisions.map(summaryOf) })
          if (revisions[0]) pick(revisions[0].id)
        },
        onCloseDialog: () => {
          calls.push(["close"])
          setDialog(null)
        },
        onSelectRevision: (id) => {
          calls.push(["select-revision", id])
          pick(id)
        },
        onRestoreRevision: (revision) => {
          calls.push(["restore", revision.id])
          setValue(blogDraftOf(revision))
          setDialog(null)
        },
      })}
    />
  )
}

/** Opens "More actions", then its History item. */
async function openHistory(): Promise<void> {
  await clickOn(find("[data-e2e=admin-blog-menu]"))
  await clickOn(find("[data-e2e=admin-blog-history-open]"))
}

describe("the blog editor's History", () => {
  it("lists earlier versions newest first, shows the one picked, and restores it into the editor with focus on the title (#418)", async () => {
    const calls: unknown[][] = []
    await mount(<HistoryHarness calls={calls} revisions={REVISIONS} />)
    await openHistory()

    const dialog = find("dialog[open][data-e2e=admin-blog-history]")
    const rows = [...dialog.querySelectorAll<HTMLInputElement>("input[type=radio]")]
    expect(rows.map((row) => row.closest("label")?.textContent)).toEqual([
      "Jobs, rewritten3 minutes ago · Lee Park",
      "Jobs, first draft1 day ago · Unknown",
    ])
    // The newest is picked and shown; its exact time sits on the row's <time> for hover.
    expect(rows[0].checked).toBe(true)
    expect(find("[data-e2e=admin-blog-history-body]").textContent).toBe("Worse.")
    expect(dialog.querySelector("time")?.getAttribute("title")).toBeTruthy()

    await act(() => {
      rows[1].checked = true
      rows[1].dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event)
    })
    expect(find("[data-e2e=admin-blog-history-preview] h3").textContent).toBe("Jobs, first draft")
    expect(find("[data-e2e=admin-blog-history-saved]").textContent).toContain("by Unknown")
    expect(find("[data-e2e=admin-blog-history-body]").textContent)
      .toBe("The good paragraph.\n\nAnd a second one.")

    // Cancel comes first and Restore last, the house order of a dialog's footer.
    const footer = [...dialog.querySelectorAll("footer button")].map((b) => b.textContent?.trim())
    expect(footer).toEqual(["Cancel", "Restore this version"])
    await clickOn(button("Restore this version"))
    await settle()

    expect(calls).toContainEqual(["restore", REVISIONS[1].id])
    expect(has("dialog[open][data-e2e=admin-blog-history]")).toBe(false)
    expect(find<HTMLInputElement>("#blog-title").value).toBe("Jobs, first draft")
    expect(find<HTMLTextAreaElement>("[data-e2e=admin-blog-description]").value).toBe(
      "The first description.",
    )
    expect(find<HTMLTextAreaElement>("[data-e2e=admin-blog-body]").value)
      .toBe("The good paragraph.\n\nAnd a second one.")
    expect(document.activeElement?.id).toBe("blog-title")
  })

  it("says how versions come to be when a post has none, and offers nothing to restore (#418)", async () => {
    await mount(<HistoryHarness calls={[]} revisions={[]} />)
    await openHistory()
    expect(find("[data-e2e=admin-blog-history-empty]").textContent)
      .toBe("No earlier versions yet. Each save keeps one.")
    expect(has("[data-e2e=admin-blog-history-restore]")).toBe(false)
  })

  it("shows why the list could not be read, and reads it again on Try again (#418)", async () => {
    const calls: unknown[][] = []
    const history = { ...NO_BLOG_HISTORY, listError: "Couldn't reach the server." }
    await mount(
      <AdminBlogEditorScreen {...editorProps(calls, { dialog: "history", history })} />,
    )
    expect(find("[data-e2e=admin-blog-history-error]").textContent)
      .toContain("Couldn't reach the server.")
    await clickOn(button("Try again"))
    expect(calls).toEqual([["retry-history"]])
  })

  it("closes on Escape and gives focus back to More actions (#418)", async () => {
    const calls: unknown[][] = []
    await mount(<HistoryHarness calls={calls} revisions={REVISIONS} />)
    await openHistory()
    const dialog = find("dialog[open][data-e2e=admin-blog-history]")
    await act(() => {
      dialog.dispatchEvent(new window.Event("cancel", { cancelable: true }) as unknown as Event)
    })
    await settle()
    expect(calls).toContainEqual(["close"])
    expect(has("dialog[open][data-e2e=admin-blog-history]")).toBe(false)
    expect(document.activeElement?.getAttribute("data-e2e")).toBe("admin-blog-menu")
  })
})

// #endregion

/** What the fake live figure in the preview says. */
const LIVE_FIGURE = "Live"

/** Two broken tags on lines 3 and 5 of a five-line body (#620). */
const FIGURE_BODY = "Intro.\n\n<CostCalc members={4} />\n\n<CostCalculator members={0} />"
const FIGURE_PROBLEMS: BlogProblem[] = [
  {
    line: 3,
    code: "unknown",
    tag: "CostCalc",
    detail: "",
    suggestion: "CostCalculator",
    names: ["CostCalculator"],
  },
  { line: 5, code: "props", tag: "CostCalculator", detail: "members must be at least 1" },
]

function figureProps(calls: unknown[][], overrides: Partial<AdminBlogEditorScreenProps> = {}) {
  return editorProps(calls, {
    value: { ...blogDraftOf(saved), bodyMd: FIGURE_BODY },
    problems: FIGURE_PROBLEMS,
    ...overrides,
  })
}

/** The body's selected text: the line a jump selected. */
function selectedLine(): string {
  const body = find<HTMLTextAreaElement>("[data-e2e=admin-blog-body]")
  return body.value.slice(body.selectionStart, body.selectionEnd)
}

async function press(element: Element, key: string, shiftKey = false): Promise<void> {
  await act(() => {
    element.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key,
        shiftKey,
        bubbles: true,
        cancelable: true,
      }) as unknown as Event,
    )
  })
}

describe("figure problems in the editor (#620)", () => {
  it("lists each problem in the panel, and a row selects its line in the body", async () => {
    await mount(<AdminBlogEditorScreen {...figureProps([])} />)
    const panel = find("[data-e2e=admin-blog-problems]")
    expect(panel.textContent).toContain("2 problems in this post")
    expect(panel.textContent).toContain(
      "There's no component called CostCalc. Did you mean CostCalculator?",
    )
    expect(panel.textContent).toContain(
      "CostCalculator can't use these props: members must be at least 1",
    )
    const rows = [...panel.querySelectorAll("button")]
    expect(rows.map((row) => row.textContent)).toEqual(["Line 3", "Line 5"])
    await clickOn(rows[1])
    await settle()
    expect(document.activeElement?.getAttribute("data-e2e")).toBe("admin-blog-body")
    expect(selectedLine()).toBe("<CostCalculator members={0} />")
  })

  it("draws no panel without problems", async () => {
    await mount(<AdminBlogEditorScreen {...editorProps([])} />)
    expect(has("[data-e2e=admin-blog-problems]")).toBe(false)
  })

  it("moves to the next problem on F8 and the previous on Shift F8, round the end", async () => {
    await mount(<AdminBlogEditorScreen {...figureProps([])} />)
    const body = find<HTMLTextAreaElement>("[data-e2e=admin-blog-body]")
    body.focus()
    body.setSelectionRange(0, 0)
    await press(body, "F8")
    expect(selectedLine()).toBe("<CostCalc members={4} />")
    await press(body, "F8")
    expect(selectedLine()).toBe("<CostCalculator members={0} />")
    await press(body, "F8")
    expect(selectedLine()).toBe("<CostCalc members={4} />")
    await press(body, "F8", true)
    expect(selectedLine()).toBe("<CostCalculator members={0} />")
  })

  it("draws a live figure in the preview, and a warning with its line where a tag won't show", async () => {
    const calls: unknown[][] = []
    await mount(
      <AdminBlogEditorScreen
        {...figureProps(calls, {
          preview: {
            parts: [
              { kind: "html", html: "<p>Intro.</p>" },
              { kind: "problem", line: 3 },
              {
                kind: "figure",
                id: "cost-calculator",
                node: <figure data-live="true">{LIVE_FIGURE}</figure>,
              },
            ],
            words: 1,
            readingMinutes: 1,
          },
        })}
      />,
    )
    await clickOn(find("#preview-tab"))
    const preview = find("[data-e2e=admin-blog-preview]")
    expect(preview.querySelector("figure[data-live]")?.textContent).toBe("Live")
    const marker = find("[data-e2e=admin-blog-preview-problem]")
    // Part of the page, not news: no live region.
    expect(marker.getAttribute("role")).toBe(null)
    expect(marker.textContent).toContain("This figure won't show")
    expect(marker.textContent).toContain("There's no component called CostCalc.")
    await clickOn(button("Go to line 3"))
    await settle()
    expect(document.activeElement?.getAttribute("data-e2e")).toBe("admin-blog-body")
    expect(selectedLine()).toBe("<CostCalc members={4} />")
  })

  it("names a real tag in the body's hint", async () => {
    await mount(
      <AdminBlogEditorScreen {...figureProps([], { figureExample: "<CostCalculator />" })} />,
    )
    expect(find("[data-e2e=admin-blog-body]").closest("div")?.parentElement?.textContent)
      .toContain("put its tag on a line of its own: <CostCalculator />")
  })

  it("warns in the publish dialog, focuses Go to problems first, and publishes anyway", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogEditorScreen {...figureProps(calls, { dialog: "publish" })} />)
    const warning = find("[data-e2e=admin-blog-publish-problems]")
    expect(warning.textContent).toContain("2 figures won't show")
    expect(warning.textContent).toContain("Readers will see the post without them.")
    expect(warning.textContent).toContain("Line 5")
    const goTo = find("[data-e2e=admin-blog-go-to-problems]")
    // The dialog's first focus: `showModal()` focuses the control marked `autofocus`.
    expect(goTo.hasAttribute("autofocus")).toBe(true)
    expect(
      [...find("dialog").querySelectorAll("[autofocus]")].map((element) => element.textContent),
    ).toEqual(["Go to problems"])
    await clickOn(button("Publish anyway"))
    expect(calls.at(-1)).toEqual(["publish", { at: null, list: null }])
  })

  it("closes the dialog on Go to problems and focuses the panel's first row", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogEditorScreen {...figureProps(calls, { dialog: "publish" })} />)
    await clickOn(find("[data-e2e=admin-blog-go-to-problems]"))
    expect(calls.at(-1)).toEqual(["close"])
    await mount(<AdminBlogEditorScreen {...figureProps(calls)} />)
    await settle()
    expect(document.activeElement?.textContent).toBe("Line 3")
  })

  it("says Schedule anyway when a post with problems is scheduled", async () => {
    await mount(<AdminBlogEditorScreen {...figureProps([], { dialog: "reschedule" })} />)
    expect(button("Schedule anyway")).toBeTruthy()
  })

  it("leaves the publish dialog as it was without problems", async () => {
    await mount(<AdminBlogEditorScreen {...editorProps([], { dialog: "publish" })} />)
    expect(has("[data-e2e=admin-blog-publish-problems]")).toBe(false)
    expect(button("Publish")).toBeTruthy()
    expect(() => button("Publish anyway")).toThrow()
  })
})

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
      authorUrl: "javascript:alert(1)",
    }
    expect(blogDraftWords(draft)).toEqual({
      slug: "Use lowercase letters, digits and hyphens only.",
      coverUrl: "Start the link with https://.",
      coverAlt: "Describe the cover image.",
      authorUrl: "Start the link with https://.",
    })
    const ok = { ...emptyBlogDraft(), title: "T", slug: "t", description: "D" }
    expect(blogDraftWords(ok)).toEqual({})
    expect(blogDraftWords(ok, true)).toEqual({
      bodyMd: "The post is empty. Write something first.",
    })
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
    // A language is named in its own language, as every language picker does: data, not English.
    const languageNames = LANGUAGES.map((language) => languageName(language))
    expect(
      englishLeft(document.body, [
        `Hello world`,
        `Jobs explained`,
        `News`,
        /\/blog\/[a-z-]+/g,
        ...languageNames,
      ]),
    )
      .toEqual([])
  })
})
