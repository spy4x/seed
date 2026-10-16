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

    expect(html).toContain("Loading groups...")
    expect(html).not.toContain("No groups yet.")
    expect(html).not.toContain("group-new-empty")
  })

  it("says the same after a sign-out, before the next person's list has been read", () => {
    groupsStore.reset()

    const html = render()

    expect(html).toContain("Loading groups...")
    expect(html).not.toContain("No groups yet.")
  })

  it("opens the new-group dialog when the address asks for it with ?new", () => {
    expect(render("new")).toContain(`data-e2e="group-new-dialog"`)
    expect(render()).not.toContain(`data-e2e="group-new-dialog"`)
  })
})
