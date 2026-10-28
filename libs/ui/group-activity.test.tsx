/**
 * The group page's Activity tab: what it renders (server-rendered HTML) and what "Load more" does in a
 * browser DOM (happy-dom).
 */
import { expect } from "@std/expect"
import { afterAll, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { act } from "preact/test-utils"
import { renderToString } from "preact-render-to-string"
import {
  type ActivityRow,
  GroupActivityPanel,
  type GroupActivityPanelProps,
} from "./group-activity-panel.tsx"

const window = new Window({ url: "http://app.localhost/" })
const own = { document: globalThis.document }

beforeAll(() => {
  Object.assign(globalThis, { document: window.document })
})

afterAll(async () => {
  Object.assign(globalThis, own)
  await window.happyDOM.close()
})

const noteId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"

function row(id: number, parts: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: String(id),
    kind: "group.renamed",
    at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    actor: { userId: 1, name: "Ada" },
    target: null,
    entity: null,
    details: { from: "Home", to: "Family" },
    ...parts,
  }
}

function html(props: Partial<GroupActivityPanelProps>): string {
  return renderToString(
    <GroupActivityPanel events={[]} loading={false} error={null} {...props} />,
  )
}

describe("group activity panel", () => {
  it("writes each event as a sentence with when it happened", () => {
    const page = html({
      events: [
        row(2, {
          kind: "note.moved_out",
          details: { count: 3, groupName: "Work" },
        }),
        row(1),
      ],
    })
    // Names and what members typed sit in `<bdi>`: the sentence is the text around them.
    const text = page.replaceAll(/<\/?bdi[^>]*>/g, "")
    expect(text).toContain("Ada moved 3 notes to Work")
    expect(text).toContain("Ada renamed the group from “Home” to “Family”")
    expect(page).toContain("3 hours ago")
    expect(page).toContain(`data-e2e="activity-2"`)
  })

  it("links a note that is still in the group and leaves a gone one as text", () => {
    const page = html({
      events: [
        row(2, {
          kind: "note.created",
          entity: { type: "note", id: noteId, exists: true },
          details: { title: "Plan" },
        }),
        row(1, {
          kind: "note.deleted",
          entity: { type: "note", id: "other", exists: false },
          details: { title: "Old" },
        }),
      ],
    })
    expect(page).toContain(`href="/notes/${noteId}"`)
    expect(page).not.toContain(`/notes/other`)
    expect(page.match(/activity-note-link/g)?.length).toBe(1)
    expect(page).toContain(`aria-label="Open the note “Plan”"`)
  })

  it("says so when nothing happened yet, and while it loads", () => {
    expect(html({})).toContain("Nothing has happened yet.")
    expect(html({ loading: true })).toContain("Loading the activity…")
    expect(html({})).not.toContain(`data-e2e="activity-more"`)
  })

  it("refuses an editor or a viewer in words, without the list", () => {
    const page = html({ forbidden: true, events: [row(1)] })
    expect(page).toContain("Only admins and the owner can see the activity.")
    expect(page).not.toContain(`data-e2e="activity-list"`)
  })

  it("shows a read error in place of the empty list", () => {
    const page = html({ error: "The server is out of reach." })
    expect(page).toContain("The server is out of reach.")
    expect(page).not.toContain("Nothing has happened yet.")
  })

  it("draws 'Open the note' as an underlined link with a phone-sized touch target", () => {
    const page = html({
      events: [
        row(1, {
          kind: "note.created",
          entity: { type: "note", id: noteId, exists: true },
          details: { title: "Plan" },
        }),
      ],
    })
    const link = page.match(/<a [^>]*data-e2e="activity-note-link"[^>]*>/)?.[0] ?? ""
    expect(link).toMatch(/class="[^"]*\bpc-link\b/)
    expect(link).toMatch(/class="[^"]*\bmin-h-11\b/)
  })

  it("asks for the next page when 'Load more' is pressed, and only while more exist", async () => {
    let asked = 0
    const root = document.createElement("div")
    document.body.append(root)
    await act(() =>
      render(
        <GroupActivityPanel
          events={[row(1)]}
          loading={false}
          error={null}
          hasMore
          onLoadMore={() => asked++}
        />,
        root,
      )
    )
    const more = root.querySelector<HTMLElement>(`[data-e2e="activity-more"]`)!
    await act(() => more.click())
    expect(asked).toBe(1)

    await act(() =>
      render(
        <GroupActivityPanel
          events={[row(1)]}
          loading={false}
          error={null}
          hasMore={false}
          onLoadMore={() => asked++}
        />,
        root,
      )
    )
    expect(root.querySelector(`[data-e2e="activity-more"]`)).toBeNull()
    await act(() => render(null, root))
    document.body.innerHTML = ""
  })
})
