/**
 * A post's sharing checklist, driven in a browser DOM (happy-dom): the groups, the link field that
 * marks a row posted, the status menu, the skip and results dialogs, the row keys and where focus
 * goes after a change.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import type {
  AdminBlogShareRow,
  AdminBlogSharingResponse,
  BlogChannel,
  BlogShare,
} from "@domain/blog"
import { AdminBlogSharingScreen, type AdminBlogSharingScreenProps } from "./admin-blog-sharing.tsx"

const window = new Window({ url: "http://admin.localhost/blog/x/sharing" })
const own = {
  document: globalThis.document,
  FormData: globalThis.FormData,
  getComputedStyle: globalThis.getComputedStyle,
  KeyboardEvent: globalThis.KeyboardEvent,
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

function find<T extends Element = HTMLElement>(selector: string, scope: ParentNode = document): T {
  const element = scope.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

async function clickOn(element: Element): Promise<void> {
  await act(() => {
    element.dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event,
    )
  })
}

async function type(field: HTMLInputElement, value: string): Promise<void> {
  field.value = value
  await act(() => {
    field.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  })
}

async function submit(element: Element): Promise<void> {
  const form = element.closest("form")!
  await act(async () => {
    form.dispatchEvent(
      new window.SubmitEvent("submit", { bubbles: true, cancelable: true }) as unknown as Event,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function press(target: Element, key: string): Promise<void> {
  await act(() => {
    target.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      }) as unknown as Event,
    )
  })
}

const POST_ID = "0195f0b4-3c1e-7a00-8000-0000000000a1"
const NOW = "2026-11-01T10:00:00.000Z"

function channelOf(id: string, overrides: Partial<BlogChannel>): BlogChannel {
  return {
    id,
    name: "r/selfhosted",
    kind: "reddit",
    address: "https://www.reddit.com/r/selfhosted/",
    utmSource: "reddit-selfhosted",
    addUtm: true,
    autoPost: false,
    languages: ["en"],
    startsAt: null,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...overrides,
  }
}

function shareOf(channelId: string, overrides: Partial<BlogShare>): BlogShare {
  return {
    id: `0195f0b4-3c1e-7a00-8000-0000000001${channelId.slice(-2)}`,
    postId: POST_ID,
    channelId,
    status: "posted",
    url: null,
    sharedAt: NOW,
    skipReason: null,
    automatic: false,
    error: null,
    readError: null,
    readFailedAt: null,
    updatedAt: NOW,
    ...overrides,
  }
}

function rowOf(
  channel: BlogChannel,
  state: AdminBlogShareRow["state"],
  overrides: Partial<AdminBlogShareRow> = {},
): AdminBlogShareRow {
  return {
    channel,
    share: null,
    state,
    text: null,
    link: "https://example.com/blog/post?utm_source=x",
    submitUrl: null,
    result: null,
    visits: null,
    posting: false,
    ...overrides,
  }
}

const REDDIT = channelOf("0195f0b4-3c1e-7a00-8000-000000000001", {})
const TELEGRAM = channelOf("0195f0b4-3c1e-7a00-8000-000000000002", {
  name: "Seed channel",
  kind: "telegram",
  address: "https://t.me/seed",
  utmSource: "telegram",
})
const NEWSLETTER = channelOf("0195f0b4-3c1e-7a00-8000-000000000003", {
  name: "Weekly",
  kind: "newsletter",
  address: "Weekly",
  utmSource: "weekly",
})
const DEVTO = channelOf("0195f0b4-3c1e-7a00-8000-000000000004", {
  name: "Dev.to",
  kind: "devto",
  address: "https://dev.to/seed",
  utmSource: "devto",
  autoPost: true,
})

const ROWS: AdminBlogShareRow[] = [
  rowOf(REDDIT, "todo", {
    text: "Seed is out https://example.com/blog/post?utm_source=reddit-selfhosted",
    submitUrl: "https://www.reddit.com/r/selfhosted/submit?url=x",
  }),
  rowOf(TELEGRAM, "todo", { text: "Seed is out" }),
  rowOf(NEWSLETTER, "suggested", {
    share: shareOf(NEWSLETTER.id, { status: "suggested" }),
  }),
  rowOf(DEVTO, "posted", {
    share: shareOf(DEVTO.id, { url: "https://dev.to/seed/post", automatic: true }),
    result: {
      readAt: NOW,
      source: "job",
      views: 120,
      reactions: 4,
      comments: 1,
      score: null,
    },
    visits: 9,
  }),
]

function sharingOf(rows: AdminBlogShareRow[] = ROWS): AdminBlogSharingResponse {
  return {
    post: {
      id: POST_ID,
      title: "Seed is out",
      language: "en",
      status: "published",
      translationOf: null,
      publishedAt: NOW,
    },
    hasChannels: true,
    linkedinExpiresAt: null,
    rows,
    visits: { setup: true, missing: [], readAt: NOW, stale: false },
  }
}

function props(
  calls: unknown[][],
  overrides: Partial<AdminBlogSharingScreenProps> = {},
): AdminBlogSharingScreenProps {
  return {
    postId: POST_ID,
    sharing: sharingOf(),
    loadError: null,
    onRetry: () => calls.push(["retry"]),
    pending: null,
    rowErrors: {},
    onChange: (change) => calls.push(["change", change]),
    resultsPending: false,
    resultsError: null,
    onResults: (channelId, counts) => calls.push(["results", channelId, counts]),
    onRetryPost: (channelId) => calls.push(["retryPost", channelId]),
    announcement: "",
    copy: () => Promise.resolve(true),
    ...overrides,
  }
}

/** The channel of the row that has focus, compared as text so a failure prints a short diff. */
function focusedChannel(): string | undefined {
  return (document.activeElement as HTMLElement | null)?.dataset.channel
}

/** The `data-e2e` hook of the element that has focus, as text for the same reason. */
function focusedHook(): string | null | undefined {
  return document.activeElement?.getAttribute("data-e2e")
}

function rowFor(channel: BlogChannel): HTMLElement {
  return find(`[data-e2e=blog-share-row][data-channel="${channel.id}"]`)
}

describe("the sharing checklist", () => {
  it("counts the shares in its subtitle and groups the rows by their next step", async () => {
    await mount(<AdminBlogSharingScreen {...props([])} />)
    expect(find("[data-e2e=blog-sharing-subtitle]").textContent).toBe(
      "English · Shared on 1 of 4 · 2 to do · 1 suggested",
    )
    const groups = [...document.querySelectorAll("[data-e2e=blog-sharing-group]")]
    expect(groups.map((group) => group.querySelector("h2, summary")?.textContent)).toEqual([
      "To do 2",
      "Suggested 1",
      "Posted 1",
    ])
    expect(rowFor(DEVTO).querySelector("[data-e2e=blog-share-numbers]")?.textContent)
      .toContain("120")
  })

  it("says when the numbers were read, and by hand when they were typed", async () => {
    await mount(<AdminBlogSharingScreen {...props([])} />)
    const numbers = find("[data-e2e=blog-share-numbers]", rowFor(DEVTO))
    expect(numbers.textContent).toContain("Numbers from")
    expect(numbers.textContent).not.toContain("entered by hand")
    const hand = ROWS.map((row) =>
      row.channel.id === DEVTO.id
        ? { ...row, result: { ...row.result!, source: "hand" as const } }
        : row
    )
    await mount(<AdminBlogSharingScreen {...props([], { sharing: sharingOf(hand) })} />)
    expect(find("[data-e2e=blog-share-numbers]", rowFor(DEVTO)).textContent)
      .toContain("entered by hand")
  })

  it("says a failed read shows older numbers, with the reason, or that none were read", async () => {
    const failed = (result: AdminBlogShareRow["result"]) =>
      ROWS.map((row) =>
        row.channel.id === DEVTO.id
          ? {
            ...row,
            result,
            share: { ...row.share!, readError: "Dev.to answered 503", readFailedAt: NOW },
          }
          : row
      )
    await mount(
      <AdminBlogSharingScreen {...props([], { sharing: sharingOf(failed(ROWS[3].result)) })} />,
    )
    const line = find("[data-e2e=blog-share-read-failed]", rowFor(DEVTO)).textContent ?? ""
    expect(line).toContain("Couldn't read new numbers from Dev.to. Showing numbers from")
    expect(line).toContain("Dev.to answered 503")
    expect(find("[data-e2e=blog-share-numbers]", rowFor(DEVTO)).textContent).toContain("120")

    await mount(<AdminBlogSharingScreen {...props([], { sharing: sharingOf(failed(null)) })} />)
    expect(find("[data-e2e=blog-share-read-failed]", rowFor(DEVTO)).textContent)
      .toContain("Couldn't read numbers from Dev.to yet.")
  })

  it("marks a row posted with the pasted link on Enter", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogSharingScreen {...props(calls)} />)
    const field = find<HTMLInputElement>("[data-e2e=blog-share-link]", rowFor(REDDIT))
    await type(field, "  https://www.reddit.com/r/selfhosted/comments/1  ")
    await submit(field)
    expect(calls).toEqual([["change", {
      channelIds: [REDDIT.id],
      status: "posted",
      url: "https://www.reddit.com/r/selfhosted/comments/1",
    }]])
  })

  it("asks for the link when Mark posted is pressed with the field empty", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogSharingScreen {...props(calls)} />)
    const field = find<HTMLInputElement>("[data-e2e=blog-share-link]", rowFor(REDDIT))
    await submit(field)
    expect(calls).toEqual([])
    const described = (field.getAttribute("aria-describedby") ?? "").split(" ")
      .map((id) => document.getElementById(id)?.textContent).join(" ")
    expect(described).toContain("Add the link.")
  })

  it("skips a row with the reason typed in the dialog", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogSharingScreen {...props(calls)} />)
    await clickOn(find("[data-e2e=blog-share-status]", rowFor(TELEGRAM)))
    await clickOn(find("[data-e2e=blog-share-skip]", rowFor(TELEGRAM)))
    const dialog = find("[data-e2e=blog-share-skip-dialog]")
    expect(dialog.textContent).toContain("Skip Seed channel for this post?")
    await type(find<HTMLInputElement>("[data-e2e=blog-share-skip-reason]"), " Off-topic ")
    await submit(find("[data-e2e=blog-share-skip-confirm]"))
    expect(calls).toEqual([["change", {
      channelIds: [TELEGRAM.id],
      status: "skipped",
      skipReason: "Off-topic",
    }]])
  })

  it("skips every row still to do from the page's menu", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogSharingScreen {...props(calls)} />)
    await clickOn(find("[data-e2e=blog-sharing-menu]"))
    await clickOn(find("[data-e2e=blog-sharing-skip-rest]"))
    expect(calls).toEqual([["change", {
      channelIds: [REDDIT.id, TELEGRAM.id],
      status: "skipped",
      skipReason: null,
    }]])
  })

  it("names the row and its status on the status menu's button", async () => {
    await mount(<AdminBlogSharingScreen {...props([])} />)
    expect(find("[data-e2e=blog-share-status]", rowFor(NEWSLETTER)).getAttribute("aria-label"))
      .toBe("Status on Weekly: Suggested")
  })

  it("moves focus to the next row still to do once a change lands", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogSharingScreen {...props(calls)} />)
    const field = find<HTMLInputElement>("[data-e2e=blog-share-link]", rowFor(REDDIT))
    await type(field, "https://www.reddit.com/r/selfhosted/comments/1")
    await submit(field)
    await mount(<AdminBlogSharingScreen {...props(calls, { pending: REDDIT.id })} />)
    const after = [
      rowOf(REDDIT, "posted", { share: shareOf(REDDIT.id, {}) }),
      ...ROWS.slice(1),
    ]
    await mount(<AdminBlogSharingScreen {...props(calls, { sharing: sharingOf(after) })} />)
    expect(focusedChannel()).toBe(TELEGRAM.id)
  })

  it("moves between rows with j and k and opens the skip dialog with s", async () => {
    await mount(<AdminBlogSharingScreen {...props([])} />)
    rowFor(REDDIT).focus()
    await press(rowFor(REDDIT), "j")
    expect(focusedChannel()).toBe(TELEGRAM.id)
    await press(rowFor(TELEGRAM), "k")
    expect(focusedChannel()).toBe(REDDIT.id)
    await press(rowFor(REDDIT), "s")
    expect(find("[data-e2e=blog-share-skip-dialog]").textContent).toContain("r/selfhosted")
  })

  it("takes the row keys on a fresh load, with focus still on the page", async () => {
    await mount(<AdminBlogSharingScreen {...props([])} />)
    await press(document.body, "j")
    expect(focusedChannel()).toBe(REDDIT.id)
    await press(document.body, "p")
    expect(focusedHook()).toBe("blog-share-link")
    expect(rowFor(REDDIT).contains(document.activeElement)).toBe(true)
  })

  it("leaves a row key that follows g to the shell's Go to sequence", async () => {
    await mount(<AdminBlogSharingScreen {...props([])} />)
    rowFor(REDDIT).focus()
    await press(document.body, "g")
    await press(document.body, "j")
    expect(focusedChannel()).toBe(REDDIT.id)
  })

  it("moves focus to the row Undo puts back, opening its folded group", async () => {
    await mount(<AdminBlogSharingScreen {...props([])} />)
    await mount(<AdminBlogSharingScreen {...props([], { pending: DEVTO.id })} />)
    await mount(<AdminBlogSharingScreen {...props([], { sharing: sharingOf() })} />)
    expect(focusedChannel()).toBe(DEVTO.id)
    expect(rowFor(DEVTO).closest("details")?.open).toBe(true)
  })

  it("moves focus to the heading once the last row to do is handled", async () => {
    const calls: unknown[][] = []
    const one = [ROWS[0], ROWS[3]]
    await mount(<AdminBlogSharingScreen {...props(calls, { sharing: sharingOf(one) })} />)
    const field = find<HTMLInputElement>("[data-e2e=blog-share-link]", rowFor(REDDIT))
    await type(field, "https://www.reddit.com/r/selfhosted/comments/1")
    await submit(field)
    await mount(
      <AdminBlogSharingScreen {...props(calls, { sharing: sharingOf(one), pending: REDDIT.id })} />,
    )
    const done = [rowOf(REDDIT, "posted", { share: shareOf(REDDIT.id, {}) }), ROWS[3]]
    await mount(<AdminBlogSharingScreen {...props(calls, { sharing: sharingOf(done) })} />)
    // A heading takes focus in a browser only with a tabindex; happy-dom does not check.
    expect(find("h1").getAttribute("tabindex")).toBe("-1")
    expect(document.activeElement?.tagName).toBe("H1")
  })

  it("opens each dialog on its first field", async () => {
    const firstFocus = () =>
      [...find("dialog").querySelectorAll("[autofocus]")].map((element) =>
        element.getAttribute("data-e2e")
      )
    await mount(<AdminBlogSharingScreen {...props([])} />)
    await clickOn(find("[data-e2e=blog-share-status]", rowFor(TELEGRAM)))
    await clickOn(find("[data-e2e=blog-share-skip]", rowFor(TELEGRAM)))
    // `showModal()` focuses the control marked `autofocus`.
    expect(firstFocus()).toEqual(["blog-share-skip-reason"])
    const cancel = () =>
      clickOn(
        [...find("dialog").querySelectorAll("button")].find((button) =>
          button.textContent === "Cancel"
        )!,
      )
    await cancel()
    await clickOn(find("[data-e2e=blog-share-status]", rowFor(DEVTO)))
    await clickOn(find("[data-e2e=blog-share-edit-link]", rowFor(DEVTO)))
    expect(firstFocus()).toEqual(["blog-share-link-edit"])
    await cancel()
    await clickOn(find("[data-e2e=blog-share-status]", rowFor(DEVTO)))
    await clickOn(find("[data-e2e=blog-share-results]", rowFor(DEVTO)))
    expect(firstFocus()).toEqual(["blog-share-result-views"])
  })

  it("names the post's language in English when no channel fits, and offers Add channel", async () => {
    const russian = { ...sharingOf([]), post: { ...sharingOf().post, language: "ru" as const } }
    await mount(<AdminBlogSharingScreen {...props([], { sharing: russian })} />)
    expect(document.body.textContent).toContain("No active channel takes posts in Russian.")
    const add = [...document.querySelectorAll("a")].find((link) =>
      link.textContent === "Add channel"
    )
    expect(add?.getAttribute("href")).toBe("/blog/channels/new")
  })

  it("says there is no ready-made text only for a row with no text and no submit form", async () => {
    const rows = [
      rowOf(REDDIT, "todo", { submitUrl: "https://www.reddit.com/r/selfhosted/submit?url=x" }),
      rowOf(TELEGRAM, "todo"),
    ]
    await mount(<AdminBlogSharingScreen {...props([], { sharing: sharingOf(rows) })} />)
    expect(rowFor(REDDIT).textContent).not.toContain("No ready-made text")
    expect(rowFor(TELEGRAM).textContent).toContain("No ready-made text")
  })

  it("shows the checklist's own header while it loads", async () => {
    await mount(<AdminBlogSharingScreen {...props([], { sharing: null })} />)
    expect(find("h1").textContent).toBe("Sharing checklist")
    expect(find("[data-e2e=page-back]").getAttribute("aria-label")).toBe("Back to post")
  })

  it("leaves the row keys alone while the link field has focus", async () => {
    await mount(<AdminBlogSharingScreen {...props([])} />)
    const field = find<HTMLInputElement>("[data-e2e=blog-share-link]", rowFor(REDDIT))
    field.focus()
    await press(field, "s")
    expect(document.querySelectorAll("[data-e2e=blog-share-skip-dialog]").length).toBe(0)
  })

  it("sends only the numbers the channel shows from the results dialog", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogSharingScreen {...props(calls)} />)
    await clickOn(find("[data-e2e=blog-share-status]", rowFor(DEVTO)))
    await clickOn(find("[data-e2e=blog-share-results]", rowFor(DEVTO)))
    const dialog = find("[data-e2e=blog-share-results-dialog]")
    expect(dialog.querySelectorAll("[data-e2e=blog-share-result-score]").length).toBe(0)
    await type(find<HTMLInputElement>("[data-e2e=blog-share-result-views]"), "150")
    await type(find<HTMLInputElement>("[data-e2e=blog-share-result-comments]"), "")
    await submit(find("[data-e2e=blog-share-results-save]"))
    expect(calls).toEqual([["results", DEVTO.id, {
      views: 150,
      reactions: 4,
      comments: null,
      score: null,
    }]])
  })

  it("says a draft lists no channels until it is live", async () => {
    const draft = { ...sharingOf([]), post: { ...sharingOf().post, status: "draft" as const } }
    await mount(<AdminBlogSharingScreen {...props([], { sharing: draft })} />)
    expect(document.body.textContent).toContain("Once this post is live")
    expect(document.querySelectorAll("[data-e2e=blog-share-row]").length).toBe(0)
  })

  it("names the missing Umami settings next to a posted row's visits", async () => {
    const off = {
      ...sharingOf(),
      visits: { setup: false, missing: ["UMAMI_API_TOKEN"], readAt: null, stale: false },
    }
    await mount(<AdminBlogSharingScreen {...props([], { sharing: off })} />)
    expect(find("[data-e2e=blog-share-umami-off]", rowFor(DEVTO)).textContent)
      .toContain("UMAMI_API_TOKEN")
  })

  it("shows Posting… on one line, as its own status, on a row whose automatic post waits, with no Try again", async () => {
    const auto = { ...TELEGRAM, autoPost: true }
    const rows = [rowOf(auto, "todo", { text: "Seed is out", posting: true })]
    await mount(<AdminBlogSharingScreen {...props([], { sharing: sharingOf(rows) })} />)
    const posting = find("[data-e2e=blog-share-posting]", rowFor(auto))
    expect(posting.textContent).toContain("Posting…")
    // One status region that says the words itself, not a spinner's own "Loading" region in a <p>.
    expect(posting.getAttribute("role")).toBe("status")
    expect(posting.tagName).toBe("DIV")
    expect(posting.querySelector("[role=status], div") === null).toBe(true)
    expect(rowFor(auto).querySelector("[data-e2e=blog-share-retry]")).toBeNull()
  })

  it("says why the automatic post failed and tries again through its callback", async () => {
    const calls: unknown[][] = []
    const auto = { ...TELEGRAM, autoPost: true }
    const failed = shareOf(auto.id, {
      status: "todo",
      sharedAt: null,
      automatic: true,
      error: "Telegram answered 400: chat not found",
    })
    const rows = [rowOf(auto, "todo", { text: "Seed is out", share: failed })]
    await mount(<AdminBlogSharingScreen {...props(calls, { sharing: sharingOf(rows) })} />)
    expect(find("[data-e2e=blog-share-failed]", rowFor(auto)).textContent)
      .toContain("Couldn't post: Telegram answered 400: chat not found")
    await clickOn(find("[data-e2e=blog-share-retry]", rowFor(auto)))
    expect(calls).toEqual([["retryPost", auto.id]])
  })

  it("shows no automatic note on a channel with Post automatically off", async () => {
    const rows = [rowOf(TELEGRAM, "todo", { text: "Seed is out", posting: false })]
    await mount(<AdminBlogSharingScreen {...props([], { sharing: sharingOf(rows) })} />)
    expect(rowFor(TELEGRAM).textContent).not.toContain("Posts automatically")
    expect(rowFor(TELEGRAM).querySelector("[data-e2e=blog-share-retry]")).toBeNull()
  })

  it("says on a LinkedIn row that its sign-in expired, and offers Try again", async () => {
    const linkedin = channelOf("0195f0b4-3c1e-7a00-8000-000000000005", {
      name: "LinkedIn",
      kind: "linkedin",
      address: "https://www.linkedin.com/in/seed",
      autoPost: true,
    })
    const stopped = shareOf(linkedin.id, {
      status: "todo",
      sharedAt: null,
      automatic: true,
      error: "sign-in-expired",
    })
    const rows = [rowOf(linkedin, "todo", { text: "Seed is out", share: stopped })]
    const sharing = { ...sharingOf(rows), linkedinExpiresAt: "2026-10-30T00:00:00.000Z" }
    await mount(<AdminBlogSharingScreen {...props([], { sharing, now: Date.parse(NOW) })} />)
    const note = find("[data-e2e=blog-linkedin-sign-in]", rowFor(linkedin))
    expect(note.dataset.state).toBe("expired")
    expect(note.textContent).toContain("deno task linkedin:sign-in")
    expect(rowFor(linkedin).querySelector("[data-e2e=blog-share-failed]")).toBeNull()
    expect(rowFor(linkedin).querySelector("[data-e2e=blog-share-retry]")).not.toBeNull()
  })
})
