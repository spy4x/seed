/**
 * What the sync strip shows a person: a tag write the server refused, with both sides and a way to
 * choose, and the notice that a tag was taken off their notes. Drawn in a browser DOM (happy-dom)
 * over a layer that holds the queue in memory.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { act } from "preact/test-utils"
import type { CallPort } from "@spy4x/realtime/calls"
import { OfflineStatus } from "./OfflineStatus.tsx"
import { startOffline, stopOffline } from "./index.ts"
import { createMemoryStorage } from "./memory-storage.ts"

const window = new Window({ url: "http://app.localhost/" })
const own = { document: globalThis.document }

beforeAll(() => {
  Object.assign(globalThis, { document: window.document })
})

afterAll(async () => {
  Object.assign(globalThis, own)
  await window.happyDOM.close()
})

let root: HTMLElement | null = null

afterEach(async () => {
  if (root) await act(() => render(null, root!))
  root = null
  await stopOffline()
})

/** Lets the layer read its queues. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** A layer that may not send, on a device that holds `storage`, drawn as the strip. */
async function mountStrip(storage: ReturnType<typeof createMemoryStorage>) {
  const layer = startOffline(
    7,
    { calls: {} as unknown as CallPort, canSend: () => false },
    storage,
  )
  await settle()
  root = window.document.createElement("div") as unknown as HTMLElement
  window.document.body.append(root as never)
  await act(() => render(<OfflineStatus groupId="g-1" onResolved={() => {}} />, root!))
  return layer
}

const text = () => root!.textContent ?? ""

describe("OfflineStatus", () => {
  it("shows a tag the server refused with both sides, so the person can choose", async () => {
    const storage = createMemoryStorage()
    await storage.of(7).tagsQueue.putEntry({
      key: "tag-key",
      entityId: "t-1",
      kind: "update",
      baseVersion: 1,
      payload: { groupId: "g-1", name: "Mine", color: "#b91c1c" },
      attempted: true,
      status: "conflict",
      queuedAt: "2026-10-01T08:00:00.000Z",
      conflict: {
        reason: "version",
        message: "Someone changed this tag.",
        server: {
          id: "t-1",
          groupId: "g-1",
          name: "Theirs",
          color: "#1d4ed8",
          version: 2,
          changeSequence: "2",
          createdByUserId: 7,
          updatedByUserId: 8,
          createdAt: "2026-10-02T00:00:00.000Z",
          updatedAt: "2026-10-02T00:00:00.000Z",
        },
      },
    })

    await mountStrip(storage)

    expect(root!.querySelector("[data-e2e=tag-sync-conflict]")).not.toBeNull()
    expect(root!.querySelector("[data-e2e=conflict-mine]")?.textContent).toBe("Mine (Red)")
    expect(root!.querySelector("[data-e2e=conflict-theirs]")?.textContent).toBe("Theirs (Blue)")
    expect(text()).toContain("Tag Mine")
  })

  it("keeps a section gap between itself and the page header under it", async () => {
    const storage = createMemoryStorage()
    await storage.of(7).tagsQueue.putEntry({
      key: "tag-key",
      entityId: "t-1",
      kind: "create",
      baseVersion: 0,
      payload: { groupId: "g-1", name: "Mine", color: "#b91c1c" },
      attempted: false,
      status: "pending",
      queuedAt: "2026-10-01T08:00:00.000Z",
    })

    await mountStrip(storage)

    expect(root!.querySelector("[data-e2e=offline-status]")!.classList.contains("mb-8")).toBe(true)
  })

  it("tells the person a tag was taken off their notes, until they dismiss it", async () => {
    const layer = await mountStrip(createMemoryStorage())
    const message = "A tag you created offline could not be saved, so it was taken off 2 notes."

    await act(() => {
      layer.notices.value = [message]
    })
    expect(root!.querySelector("[data-e2e=sync-notice]")?.textContent).toContain(message)

    await act(() => {
      ;(root!.querySelector("[data-e2e=sync-notice-dismiss]") as HTMLElement).click()
    })
    expect(root!.querySelector("[data-e2e=sync-notice]")).toBeNull()
  })
})
