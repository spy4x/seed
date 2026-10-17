/**
 * The inbox screen and the header's bell: what they render (server-rendered HTML) and what a click
 * on a notification does in a browser DOM (happy-dom).
 */
import { expect } from "@std/expect"
import { afterAll, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { act } from "preact/test-utils"
import { renderToString } from "preact-render-to-string"
import { AppFrame } from "./frame.tsx"
import { type NotificationRow, NotificationsScreen } from "./notifications-screen.tsx"

const window = new Window({ url: "http://app.localhost/" })
const own = { document: globalThis.document }

beforeAll(() => {
  Object.assign(globalThis, { document: window.document })
})

afterAll(async () => {
  Object.assign(globalThis, own)
  await window.happyDOM.close()
})

function row(id: number, parts: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: String(id),
    kind: "group.removed",
    payload: { groupName: "Family" },
    link: "/groups",
    readAt: null,
    createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    ...parts,
  }
}

const noop = () => {}

function screen(props: Partial<Parameters<typeof NotificationsScreen>[0]> = {}) {
  return (
    <NotificationsScreen
      notifications={[]}
      unreadCount={0}
      loading={false}
      error={null}
      onRead={noop}
      onReadAll={noop}
      {...props}
    />
  )
}

describe("notifications screen", () => {
  it("writes each notification as a sentence with a link to its subject and when it came", () => {
    const page = renderToString(screen({
      notifications: [row(2, { link: "/groups/g-1" }), row(1)],
      unreadCount: 2,
    }))
    expect(page).toContain("You were removed from “Family”.")
    expect(page).toContain(`href="/groups/g-1"`)
    expect(page).toContain("3 hours ago")
  })

  it("marks an unread notification by a word, a dot and weight, never by colour alone", () => {
    const root = document.createElement("div")
    root.innerHTML = renderToString(screen({
      notifications: [row(2), row(1, { readAt: new Date().toISOString() })],
      unreadCount: 1,
    }))
    const [unread, read] = [...root.querySelectorAll("li")]
    expect(unread.getAttribute("data-unread")).toBe("true")
    expect(unread.querySelector(".sr-only")?.textContent).toBe("Unread:")
    expect(unread.querySelector("[data-e2e=notification-dot]")?.className).toContain("bg-selected")
    expect(unread.querySelector("[data-e2e=notification-text]")?.className).toContain("font-medium")
    expect(read.getAttribute("data-unread")).toBe("false")
    expect(read.querySelector(".sr-only")).toBe(null)
    expect(read.querySelector("[data-e2e=notification-dot]")?.className).not.toContain(
      "bg-selected",
    )
    expect(read.querySelector("[data-e2e=notification-text]")?.className).not.toContain(
      "font-medium",
    )
  })

  it("lists the notifications as rows of one card, each row a link, in the frame's column", () => {
    const root = document.createElement("div")
    root.innerHTML = renderToString(screen({ notifications: [row(2), row(1)], unreadCount: 2 }))
    const list = root.querySelector("[data-e2e=notifications-list]")!
    expect(list.parentElement?.className).toContain("pc-card")
    for (const item of list.querySelectorAll("li")) {
      const link = item.querySelector("[data-e2e=notification-link]")!
      // The link is the row: its only child, at least 56 px tall.
      expect(item.children.length).toBe(1)
      expect(link.className).toContain("min-h-14")
      expect(link.contains(item.querySelector("time"))).toBe(true)
    }
    // `AppFrame` owns the page's width; the screen sets none.
    expect(root.innerHTML).not.toMatch(/\bmax-w-|\bmx-auto\b/)
  })

  it("draws a row's keyboard focus as the library's ring inside the row, which the card cannot clip", () => {
    const root = document.createElement("div")
    root.innerHTML = renderToString(screen({ notifications: [row(1)], unreadCount: 1 }))
    const classes = root.querySelector("[data-e2e=notification-link]")!.className.split(" ")
    expect(classes).toContain("focus-visible:ring-2")
    expect(classes).toContain("focus-visible:ring-inset")
  })

  it("offers Mark all as read only while something is unread", () => {
    expect(renderToString(screen({ notifications: [row(1)], unreadCount: 1 })))
      .toContain(`data-e2e="notifications-read-all"`)
    expect(renderToString(screen({ notifications: [row(1, { readAt: "2026-10-01T10:00:00Z" })] })))
      .not.toContain(`data-e2e="notifications-read-all"`)
  })

  it("says the inbox is empty instead of showing a blank page", () => {
    expect(renderToString(screen())).toContain("You are all caught up.")
  })

  it("tells the app a notification was read as its link is followed, and only if it was unread", async () => {
    const read: string[] = []
    const root = document.createElement("div")
    document.body.append(root)
    await act(() =>
      render(
        screen({
          notifications: [row(2), row(1, { readAt: "2026-10-01T10:00:00Z" })],
          unreadCount: 1,
          onRead: (id) => read.push(id),
          navigate: noop,
        }),
        root,
      )
    )
    const links = root.querySelectorAll<HTMLElement>(`[data-e2e="notification-link"]`)
    await act(() => links[1].click())
    expect(read).toEqual([])
    await act(() => links[0].click())
    expect(read).toEqual(["2"])
    await act(() => render(null, root))
    root.remove()
  })

  it("names each notification's link by its sentence and when it came, unread first", () => {
    const root = document.createElement("div")
    root.innerHTML = renderToString(screen({
      notifications: [
        row(2, { kind: "group.ownership_received", payload: { groupName: "Trip" } }),
        row(1, { readAt: "2026-10-01T10:00:00Z" }),
      ],
      unreadCount: 1,
    }))
    const links = [...root.querySelectorAll("[data-e2e=notification-link]")]
    // No `aria-label`: the name is the text on screen, so voice control finds it by what it says.
    expect(links.map((link) => link.getAttribute("aria-label"))).toEqual([null, null])
    expect(links[0].textContent).toBe("Unread: You now own “Trip”. 3 hours ago")
    expect(links[1].textContent).toMatch(/^You were removed from “Family”\. \S/)
  })

  it("moves focus to the first notification's link once Mark all as read went through", async () => {
    let asked = 0
    const props = { notifications: [row(2), row(1)], onReadAll: () => asked++ }
    const root = document.createElement("div")
    document.body.append(root)
    await act(() => render(screen({ ...props, unreadCount: 2 }), root))
    const button = root.querySelector<HTMLElement>(`[data-e2e="notifications-read-all"]`)!
    button.focus()
    await act(() => button.click())
    expect(asked).toBe(1)
    await act(() => render(screen({ ...props, unreadCount: 0 }), root))
    const first = root.querySelector(`[data-e2e="notification-link"]`)
    expect(document.activeElement === first).toBe(true)
    await act(() => render(null, root))
    root.remove()
  })

  it("leaves focus alone when the unread count reaches zero without a press of the button", async () => {
    const props = { notifications: [row(2), row(1)] }
    const root = document.createElement("div")
    document.body.append(root)
    await act(() =>
      render(screen({ ...props, unreadCount: 2, hasMore: true, onLoadMore: noop }), root)
    )
    const more = root.querySelector<HTMLElement>(`[data-e2e="notifications-more"]`)!
    more.focus()
    await act(() =>
      render(screen({ ...props, unreadCount: 0, hasMore: true, onLoadMore: noop }), root)
    )
    expect(document.activeElement === more).toBe(true)
    await act(() => render(null, root))
    root.remove()
  })

  it("keeps focus on Mark all as read when the press was refused, and after a later read by another way", async () => {
    const props = { notifications: [row(2), row(1)] }
    const root = document.createElement("div")
    document.body.append(root)
    await act(() => render(screen({ ...props, unreadCount: 2 }), root))
    const button = root.querySelector<HTMLElement>(`[data-e2e="notifications-read-all"]`)!
    button.focus()
    await act(() => button.click())
    await act(() => render(screen({ ...props, unreadCount: 2, error: "Offline." }), root))
    expect(document.activeElement === button).toBe(true)
    const body = document.body as HTMLElement
    button.blur()
    await act(() => render(screen({ ...props, unreadCount: 0 }), root))
    expect(document.activeElement === body).toBe(true)
    await act(() => render(null, root))
    root.remove()
  })

  it("loads the next page when asked", async () => {
    let asked = 0
    const root = document.createElement("div")
    document.body.append(root)
    await act(() =>
      render(screen({ notifications: [row(1)], hasMore: true, onLoadMore: () => asked++ }), root)
    )
    await act(() => root.querySelector<HTMLElement>(`[data-e2e="notifications-more"]`)!.click())
    expect(asked).toBe(1)
    await act(() => render(null, root))
    root.remove()
  })
})

describe("Notifications entry", () => {
  const frame = (unreadCount?: number) =>
    renderToString(
      <AppFrame
        user={{ firstName: "Ada", lastName: "L" }}
        onSignOut={noop}
        unreadCount={unreadCount}
      >
        <p>page</p>
      </AppFrame>,
    )

  /** Every Notifications link the frame renders: the rail's cell, then the phone sheet's row. */
  const bells = (page: string) =>
    [...page.matchAll(/<a\b[^>]*href="\/notifications"[^>]*>.*?<\/a>/g)]
      .map((match) => match[0])

  it("names the unread count in the link's accessible name and badges it", () => {
    const [rail, sheet] = bells(frame(3))
    expect(rail).toContain(`aria-label="Notifications, 3 unread"`)
    expect(rail).toMatch(/data-e2e="rail-shell-counter"[^>]*>3</)
    // The rail's own 48 px cell, so the bell lines up with the sections above it.
    expect(rail).toContain("size-12")
    expect(sheet).toContain(`aria-label="Notifications, 3 unread"`)
    expect(sheet).toContain("min-h-11")
  })

  it("shows no badge when everything is read, and caps a long count at 99+", () => {
    const [read] = bells(frame(0))
    expect(read).not.toContain(`data-e2e="rail-shell-counter"`)
    // The visible label names the link on its own; no count, so no aria-label to add one.
    expect(read).not.toContain("aria-label")
    expect(read).toMatch(/>Notifications<\/span><\/a>$/)
    const [many] = bells(frame(250))
    expect(many).toMatch(/data-e2e="rail-shell-counter"[^>]*>99\+</)
    expect(many).toContain(`aria-label="Notifications, 250 unread"`)
  })

  it("has no Notifications entry in a frame that was not given a count", () => {
    expect(bells(frame())).toEqual([])
  })
})
