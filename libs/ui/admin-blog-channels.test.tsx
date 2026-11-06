/**
 * The sharing channels' admin pages, driven in a browser DOM (happy-dom): the list's menus and
 * the delete confirmation, and the channel form's defaults, live count, submit and focus.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import type { AdminBlogChannelRow, AdminBlogChannelsResponse } from "@domain/blog"
import {
  AdminBlogChannelScreen,
  type AdminBlogChannelScreenProps,
  AdminBlogChannelsScreen,
  type AdminBlogChannelsScreenProps,
  blankChannelForm,
  type BlogChannelFormValue,
} from "./admin-blog-channels.tsx"

const window = new Window({ url: "http://admin.localhost/blog/channels" })
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

async function clickOn(element: Element): Promise<void> {
  await act(() => {
    element.dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event,
    )
  })
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

const NOW = "2026-11-01T10:00:00.000Z"

function channelOf(id: string, overrides: Partial<AdminBlogChannelRow> = {}): AdminBlogChannelRow {
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
    shares: 2,
    toDo: 1,
    lastError: null,
    ...overrides,
  }
}

const REDDIT = channelOf("0195f0b4-3c1e-7a00-8000-000000000001")
const DEVTO = channelOf("0195f0b4-3c1e-7a00-8000-000000000002", {
  name: "Dev.to",
  kind: "devto",
  address: "https://dev.to/seed",
  utmSource: "devto",
  autoPost: true,
  shares: 0,
  toDo: 0,
  lastError: "key-missing",
})

const LIST: AdminBlogChannelsResponse = {
  channels: [REDDIT, DEVTO],
  linkedinExpiresAt: null,
  livePosts: [
    { language: "en", publishedAt: "2026-10-01T10:00:00.000Z" },
    { language: "en", publishedAt: "2026-10-20T10:00:00.000Z" },
    { language: "ru", publishedAt: "2026-10-21T10:00:00.000Z" },
  ],
}

function listProps(
  calls: unknown[][],
  overrides: Partial<AdminBlogChannelsScreenProps> = {},
): AdminBlogChannelsScreenProps {
  return {
    list: LIST,
    error: null,
    busy: false,
    archived: false,
    onShowArchived: (archived) => calls.push(["archived", archived]),
    onRetry: () => calls.push(["retry"]),
    onArchive: (channel, archived) => calls.push(["archive", channel.id, archived]),
    onDelete: (channel) => calls.push(["delete", channel.id]),
    ...overrides,
  }
}

function row(index: number): Element {
  return document.querySelectorAll("[data-e2e=blog-channel-row]")[index]
}

async function openMenu(index: number): Promise<string[]> {
  await clickOn(row(index).querySelector("[data-e2e=blog-channel-menu]")!)
  return [...row(index).querySelectorAll("[role=menuitem]")].map((item) =>
    item.textContent?.trim() ?? ""
  )
}

describe("the sharing channels list", () => {
  it("names each channel, says the Dev.to key is missing, and hides the chips with nothing archived", async () => {
    await mount(<AdminBlogChannelsScreen {...listProps([])} />)
    const names = [...document.querySelectorAll("[data-e2e=blog-channel-edit]")]
      .map((link) => link.textContent)
    expect(names).toEqual(["r/selfhosted", "Dev.to"])
    expect(row(1).querySelector("[data-e2e=blog-channel-key-missing]")?.textContent)
      .toContain("DEVTO_API_KEY")
    expect(document.querySelectorAll("[data-e2e=blog-channels-filter]").length).toBe(0)
  })

  it("offers Delete only on a channel without shares, and archives through the menu", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogChannelsScreen {...listProps(calls)} />)
    expect(await openMenu(0)).toEqual(["Edit channel", "Archive channel"])
    await clickOn(row(0).querySelector("[data-e2e=blog-channel-archive]")!)
    expect(calls).toEqual([["archive", REDDIT.id, true]])
    expect(await openMenu(1)).toEqual(["Edit channel", "Archive channel", "Delete channel…"])
  })

  it("deletes a channel only after the dialog is confirmed", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogChannelsScreen {...listProps(calls)} />)
    await openMenu(1)
    await clickOn(row(1).querySelector("[data-e2e=blog-channel-delete]")!)
    expect(find("[data-e2e=blog-channel-delete-dialog]").textContent).toContain("Dev.to")
    expect(calls).toEqual([])
    await clickOn(find("[data-e2e=blog-channel-delete-dialog] [data-e2e=confirm-dialog-confirm]"))
    expect(calls).toEqual([["delete", DEVTO.id]])
  })

  it("opens the delete dialog on Cancel", async () => {
    await mount(<AdminBlogChannelsScreen {...listProps([])} />)
    await openMenu(1)
    await clickOn(row(1).querySelector("[data-e2e=blog-channel-delete]")!)
    const focused = document.activeElement
    // Compared as text: a failing comparison of two elements prints the whole document.
    expect(focused?.getAttribute("data-e2e")).toBe("confirm-dialog-cancel")
    expect(find("[data-e2e=blog-channel-delete-dialog]").contains(focused)).toBe(true)
  })

  it("moves focus to the next row's menu after an archive", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogChannelsScreen {...listProps(calls)} />)
    await openMenu(0)
    await clickOn(row(0).querySelector("[data-e2e=blog-channel-archive]")!)
    await mount(<AdminBlogChannelsScreen {...listProps(calls, { busy: true })} />)
    const left = { ...LIST, channels: [{ ...REDDIT, archivedAt: NOW }, DEVTO] }
    await mount(<AdminBlogChannelsScreen {...listProps(calls, { list: left })} />)
    const focused = document.activeElement as HTMLElement | null
    expect(focused?.dataset.e2e).toBe("blog-channel-menu")
    expect(
      focused?.closest("[data-e2e=blog-channel-row]")?.querySelector(
        "[data-e2e=blog-channel-edit]",
      )?.textContent,
    ).toBe("Dev.to")
  })
})

describe("the automatic channels on the list", () => {
  const DAY = 86_400_000
  const TODAY = Date.parse(NOW)
  const linkedin = (fields: Partial<AdminBlogChannelRow> = {}) =>
    channelOf("0195f0b4-3c1e-7a00-8000-000000000003", {
      name: "LinkedIn",
      kind: "linkedin",
      address: "https://www.linkedin.com/in/seed",
      autoPost: true,
      lastError: null,
      ...fields,
    })
  const listOf = (channel: AdminBlogChannelRow, expiresAt: string | null) => ({
    ...LIST,
    channels: [channel],
    linkedinExpiresAt: expiresAt,
  })
  const signIn = () => document.querySelector<HTMLElement>("[data-e2e=blog-linkedin-sign-in]")

  it("names the missing key of each automatic kind", async () => {
    const mastodon = channelOf("0195f0b4-3c1e-7a00-8000-000000000005", {
      kind: "mastodon",
      address: "https://mastodon.social/@seed",
      autoPost: true,
      lastError: "key-missing",
    })
    await mount(
      <AdminBlogChannelsScreen {...listProps([], { list: { ...LIST, channels: [mastodon] } })} />,
    )
    expect(find("[data-e2e=blog-channel-key-missing]").textContent).toContain(
      "MASTODON_ACCESS_TOKEN",
    )
  })

  it("warns about the LinkedIn sign-in from 14 days before it expires, with the renewal command", async () => {
    const expires = new Date(TODAY + 15 * DAY).toISOString()
    await mount(
      <AdminBlogChannelsScreen
        {...listProps([], { list: listOf(linkedin(), expires), now: TODAY })}
      />,
    )
    expect(signIn()?.dataset.state).toBe("ok")
    await mount(
      <AdminBlogChannelsScreen
        {...listProps([], { list: listOf(linkedin(), expires), now: TODAY + DAY })}
      />,
    )
    expect(signIn()?.dataset.state).toBe("soon")
    expect(signIn()?.textContent).toContain("14 days")
    expect(signIn()?.textContent).toContain("deno task linkedin:sign-in")
  })

  it("says the LinkedIn sign-in expired instead of a failure, and hides it when the channel is manual", async () => {
    const expired = new Date(TODAY - DAY).toISOString()
    const stopped = linkedin({ lastError: "sign-in-expired" })
    await mount(
      <AdminBlogChannelsScreen
        {...listProps([], { list: listOf(stopped, expired), now: TODAY })}
      />,
    )
    expect(signIn()?.dataset.state).toBe("expired")
    expect(document.querySelector("[data-e2e=blog-channel-failed]")).toBeNull()
    const manual = linkedin({ autoPost: false })
    await mount(
      <AdminBlogChannelsScreen {...listProps([], { list: listOf(manual, expired), now: TODAY })} />,
    )
    expect(signIn()).toBeNull()
  })

  it("drops the Posts automatically badge from a LinkedIn channel once its sign-in has expired", async () => {
    const facts = () => find("[data-e2e=blog-channel-row]").textContent
    await mount(
      <AdminBlogChannelsScreen
        {...listProps([], {
          list: listOf(linkedin(), new Date(TODAY + DAY).toISOString()),
          now: TODAY,
        })}
      />,
    )
    expect(facts()).toContain("Posts automatically")
    await mount(
      <AdminBlogChannelsScreen
        {...listProps([], {
          list: listOf(linkedin(), new Date(TODAY - DAY).toISOString()),
          now: TODAY,
        })}
      />,
    )
    expect(facts()).not.toContain("Posts automatically")
  })
})

function formProps(
  calls: unknown[][],
  overrides: Partial<AdminBlogChannelScreenProps> = {},
): AdminBlogChannelScreenProps {
  return {
    channel: null,
    loading: false,
    notFound: false,
    value: blankChannelForm(),
    onChange: (value) => calls.push(["change", value]),
    errors: {},
    saving: false,
    onSave: () => calls.push(["save"]),
    livePosts: LIST.livePosts,
    now: NOW,
    ...overrides,
  }
}

/** The last value the form passed up. */
function lastValue(calls: unknown[][]): BlogChannelFormValue {
  const change = calls.findLast((call) => call[0] === "change")
  if (!change) throw new Error("the form passed nothing up")
  return change[1] as BlogChannelFormValue
}

describe("the channel form", () => {
  it("keeps the source tag following the name until the tag is typed", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogChannelScreen {...formProps(calls)} />)
    await type("[data-e2e=blog-channel-name]", "r/Self Hosted")
    expect(lastValue(calls).utmSource).toBe("r-self-hosted")
    const edited = { ...blankChannelForm(), utmSource: "mine", utmEdited: true }
    await mount(<AdminBlogChannelScreen {...formProps(calls, { value: edited })} />)
    await type("[data-e2e=blog-channel-name]", "Other")
    expect(lastValue(calls).utmSource).toBe("mine")
  })

  it("fills Hacker News's address and turns utm off on a new channel", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogChannelScreen {...formProps(calls)} />)
    await choose("[data-e2e=blog-channel-kind]", "hackernews")
    expect(lastValue(calls)).toMatchObject({
      kind: "hackernews",
      address: "news.ycombinator.com",
      addUtm: false,
    })
  })

  it("says how many live posts the chosen languages and start list it on", async () => {
    await mount(<AdminBlogChannelScreen {...formProps([])} />)
    expect(find("[data-e2e=blog-channel-count]").textContent).toContain("2")
    const fromToday = { ...blankChannelForm(), which: "from" as const }
    await mount(<AdminBlogChannelScreen {...formProps([], { value: fromToday })} />)
    expect(find("[data-e2e=blog-channel-count]").textContent).toContain("0")
  })

  it("shows Post automatically only for a kind Seed can post to, on for a new channel", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogChannelScreen {...formProps(calls)} />)
    expect(document.querySelector("[data-e2e=blog-channel-auto-post]")).toBeNull()
    expect(blankChannelForm().autoPost).toBe(true)
    const telegram = { ...blankChannelForm(), kind: "telegram" as const }
    await mount(<AdminBlogChannelScreen {...formProps(calls, { value: telegram })} />)
    const toggle = find("[data-e2e=blog-channel-auto-post] [role=switch]")
    expect(toggle.getAttribute("aria-checked")).toBe("true")
    await clickOn(toggle)
    expect(lastValue(calls)).toMatchObject({ kind: "telegram", autoPost: false })
  })

  it("saves through its callback on submit", async () => {
    const calls: unknown[][] = []
    await mount(<AdminBlogChannelScreen {...formProps(calls)} />)
    await submit("[data-e2e=blog-channel-name]")
    expect(calls).toEqual([["save"]])
  })

  it("moves focus to the first refused field and ties the error to it", async () => {
    await mount(
      <AdminBlogChannelScreen
        {...formProps([], {
          errors: { address: "Start the link with https://.", utmSource: "Taken." },
        })}
      />,
    )
    const field = find<HTMLInputElement>("[data-e2e=blog-channel-address]")
    expect(document.activeElement?.id).toBe(field.id)
    const described = (field.getAttribute("aria-describedby") ?? "").split(" ")
      .map((id) => document.getElementById(id)?.textContent).join(" ")
    expect(described).toContain("Start the link with https://.")
  })
})
