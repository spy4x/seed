/**
 * The group page's route: the addresses it takes over from before the tabs, and what it does with
 * one it does not know.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { act } from "preact/test-utils"
import { Router } from "wouter-preact"
import { memoryLocation } from "wouter-preact/memory-location"
import { GroupPage } from "./GroupEditorView.tsx"

const window = new Window({ url: "http://app.localhost/" })
const own = { document: globalThis.document, window: globalThis.window }

beforeAll(() => {
  Object.assign(globalThis, { document: window.document, window })
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

const groupId = "019a0000-0000-7000-8000-000000000001"

/** Opens `/groups/:groupId/<tab>` and resolves on the addresses the page went through. */
async function open(tab: string): Promise<string[]> {
  const path = `/groups/${groupId}/${tab}`
  const location = memoryLocation({ path, record: true })
  root = document.createElement("div")
  document.body.append(root)
  await act(() =>
    render(
      <Router hook={location.hook}>
        <GroupPage groupId={groupId} tab={tab} />
      </Router>,
      root!,
    )
  )
  return location.history!
}

describe("GroupPage", () => {
  it("opens the old plans page's address on the Plan and billing tab, in its place", async () => {
    expect(await open("pricing")).toEqual([`/groups/${groupId}/billing`])
  })

  it("opens an address with an unknown last part on the General tab, in its place", async () => {
    expect(await open("nonsense")).toEqual([`/groups/${groupId}`])
  })
})
