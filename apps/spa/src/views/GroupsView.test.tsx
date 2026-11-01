import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render as draw } from "preact"
import { act } from "preact/test-utils"
import { renderToString } from "preact-render-to-string"
import { Router } from "wouter-preact"
import { memoryLocation } from "wouter-preact/memory-location"
import { groupsStore } from "../state/groups.ts"
import { GroupsView } from "./GroupsView.tsx"

/** The view on the server: the router needs a path, because there is no `location`. */
const render = (search = "") =>
  renderToString(
    <Router ssrPath="/groups" ssrSearch={search}>
      <GroupsView />
    </Router>,
  )

describe("GroupsView", () => {
  afterEach(() => groupsStore.reset())

  it("says the groups are loading, not that there are none, before the list has been read", () => {
    const html = render()

    expect(html).toContain("Loading groups…")
    expect(html).not.toContain("No groups yet")
    expect(html).not.toContain("group-new-empty")
  })

  it("says the same after a sign-out, before the next person's list has been read", () => {
    groupsStore.reset()

    const html = render()

    expect(html).toContain("Loading groups…")
    expect(html).not.toContain("No groups yet")
  })

  it("shows a failed first read and Try again, not No groups yet, when nothing is saved", () => {
    groupsStore.loading.value = false
    groupsStore.loadError.value = "Could not load the groups"

    const html = render()

    expect(html).toContain("Could not load the groups")
    expect(html).toContain(`data-e2e="groups-retry"`)
    expect(html).not.toContain("No groups yet")
    expect(html).not.toContain(`data-e2e="group-new"`)
  })

  it("links New group to the create page, and opens no dialog for an old ?new address", () => {
    const html = render("new")

    expect(html).toMatch(/<a data-e2e="group-new" href="\/groups\/new"/)
    expect(html).not.toContain("<dialog")
    expect(html).not.toContain(`data-e2e="group-name"`)
  })
})

describe("GroupsView in a browser", () => {
  const window = new Window({ url: "http://app.localhost/groups" })
  const NAMES = ["document", "location", "history", "getComputedStyle", "fetch"] as const
  const own = Object.fromEntries(
    NAMES.map((name) => [name, (globalThis as Record<string, unknown>)[name]]),
  )
  const realRefresh = groupsStore.refresh

  beforeAll(() => {
    // Preact draws into `document`, the router reads `location` and `history`, and the
    // invitations read the page starts is refused, so the view never reaches a server.
    const refuse = () =>
      Promise.resolve(Response.json({ error: { code: "NO", message: "No" } }, { status: 503 }))
    Object.assign(globalThis, {
      document: window.document,
      location: window.location,
      history: window.history,
      getComputedStyle: window.getComputedStyle.bind(window),
      fetch: refuse,
    })
  })

  afterAll(async () => {
    Object.assign(globalThis, own)
    await window.happyDOM.close()
  })

  afterEach(() => {
    groupsStore.refresh = realRefresh
    groupsStore.reset()
  })

  it("reads the groups again when Try again is pressed, and a retry that fails again rejects nothing", async () => {
    const reads: string[] = []
    groupsStore.refresh = (via) => {
      reads.push(via ?? "rest")
      return Promise.reject(new Error("still offline"))
    }
    groupsStore.loading.value = false
    groupsStore.loadError.value = "Could not load the groups"
    const root = window.document.createElement("div") as unknown as HTMLElement
    window.document.body.appendChild(root as never)
    const { hook } = memoryLocation({ path: "/groups" })
    try {
      await act(() =>
        draw(
          <Router hook={hook}>
            <GroupsView />
          </Router>,
          root,
        )
      )

      await act(() => root.querySelector<HTMLElement>("[data-e2e=groups-retry]")!.click())

      expect(reads).toEqual(["rest"])
    } finally {
      await act(() => draw(null, root))
      root.remove()
    }
  })
})
