/**
 * The group page's Activity tab as the SPA wires it: its empty hint follows `SPA_NOTES`
 * (`notesOn()`), so a product with the notes off never names them.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { act } from "preact/test-utils"
import { Router } from "wouter-preact"
import { memoryLocation } from "wouter-preact/memory-location"
import { configureModules } from "../modules.ts"
import { groupsStore } from "../state/groups.ts"
import { GroupActivityView } from "./GroupActivityView.tsx"

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
  configureModules({})
  groupsStore.loading.value = true
})

/**
 * Draws the tab for a group the person is not in, with the group list read, so the panel shows
 * its empty state without asking the server.
 */
async function open(): Promise<string> {
  groupsStore.loading.value = false
  root = document.createElement("div")
  document.body.append(root)
  await act(() =>
    render(
      <Router hook={memoryLocation({ path: "/" }).hook}>
        <GroupActivityView groupId="019a0000-0000-7000-8000-000000000001" />
      </Router>,
      root!,
    )
  )
  return root.textContent ?? ""
}

describe("GroupActivityView", () => {
  it("names the notes in the empty hint with the notes on", async () => {
    configureModules({ notes: true })
    expect(await open()).toContain("Changes to the group and its notes show up here.")
  })

  it("does not name notes in the empty hint with the notes off", async () => {
    configureModules({ notes: false })
    const text = await open()
    expect(text).toContain("Changes to the group show up here.")
    expect(text).not.toMatch(/\b(notes?|tags?|files?)\b/i)
  })
})
