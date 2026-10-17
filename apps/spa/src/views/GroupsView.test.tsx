import { expect } from "@std/expect"
import { afterEach, describe, it } from "@std/testing/bdd"
import { renderToString } from "preact-render-to-string"
import { Router } from "wouter-preact"
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
