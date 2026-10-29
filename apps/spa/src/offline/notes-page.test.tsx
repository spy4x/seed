/**
 * The offline status on the notes page, in a browser DOM (happy-dom). It lives in this folder
 * because only the composition root may import the offline layer from outside it, so a product
 * that removes the layer removes this test with it. Every read the page starts gets a refusal, so
 * the page never reaches a server.
 */
import "@preact/signals"
import { signal } from "@preact/signals"
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { Router } from "wouter-preact"
import { memoryLocation } from "wouter-preact/memory-location"
import { act } from "preact/test-utils"
import type { CallPort } from "@spy4x/realtime/calls"
import { UserMFAStatus, UserRole } from "@domain/identity"
import { onboardingStore } from "../state/onboarding.ts"
import { selectionStore } from "../state/selection.ts"
import { sessionState } from "../state/session.ts"
import { NotesView } from "../views/NotesView.tsx"
import { startOffline, stopOffline } from "./index.ts"
import { createMemoryStorage } from "./memory-storage.ts"

const window = new Window({ url: "http://app.localhost/" })
const NAMES = [
  "document",
  "location",
  "history",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "HTMLElement",
  "Element",
  "fetch",
  "CSS",
  "matchMedia",
] as const
const own = Object.fromEntries(
  NAMES.map((name) => [name, (globalThis as Record<string, unknown>)[name]]),
)
const signedOut = sessionState.value
const realStore = { ...onboardingStore }

beforeAll(() => {
  // As in `views/NotesView.test.tsx`: Preact, the router and the library's tour read these.
  const refuse = () =>
    Promise.resolve(Response.json({ error: { code: "NO", message: "No" } }, { status: 503 }))
  Object.assign(
    globalThis,
    Object.fromEntries(NAMES.map((name) => {
      if (name === "fetch") return [name, refuse]
      if (name === "matchMedia") return [name, undefined]
      const value = (window as unknown as Record<string, unknown>)[name]
      return [
        name,
        typeof value === "function" && !/^[A-Z]/.test(name) ? value.bind(window) : value,
      ]
    })),
  )
  // No first-steps card: the status is the only thing between the header and the list.
  Object.assign(onboardingStore, {
    status: signal(null),
    visible: signal(false),
    open: () => Promise.resolve(),
    close: () => {},
  })
  sessionState.value = {
    ...signedOut,
    isReady: true,
    user: {
      id: 1,
      firstName: "Ada",
      lastName: "Lovelace",
      mfa: UserMFAStatus.NOT_CONFIGURED,
      role: UserRole.VIEWER,
      createdAt: new Date("2026-10-01T00:00:00Z"),
      updatedAt: new Date("2026-10-01T00:00:00Z"),
      deletedAt: null,
      lastLoginAt: new Date("2026-10-01T00:00:00Z"),
    },
  }
})

afterAll(async () => {
  Object.assign(globalThis, own)
  Object.assign(onboardingStore, realStore)
  sessionState.value = signedOut
  await window.happyDOM.close()
})

let root: HTMLElement | null = null

afterEach(async () => {
  if (root) await act(() => render(null, root!))
  root?.remove()
  root = null
  selectionStore.groupId.value = null
  await stopOffline()
})

/** Lets the layer read its queues. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) await new Promise((resolve) => setTimeout(resolve, 0))
}

describe("the notes page's offline status", () => {
  it("sits under the notes heading, which starts the page", async () => {
    // A tag made on this device that has not reached the server yet: the status shows.
    const storage = createMemoryStorage()
    await storage.of(1).tagsQueue.putEntry({
      key: "tag-key",
      entityId: "t-1",
      kind: "create",
      baseVersion: 0,
      payload: { groupId: "g-1", name: "Mine", color: "#b91c1c" },
      attempted: false,
      status: "pending",
      queuedAt: "2026-10-01T08:00:00.000Z",
    })
    startOffline(1, { calls: {} as unknown as CallPort, canSend: () => false }, storage)
    await settle()
    selectionStore.groupId.value = "g-1"
    const { hook } = memoryLocation({ path: "/notes" })
    root = window.document.createElement("div") as unknown as HTMLElement
    window.document.body.appendChild(root as never)

    await act(() =>
      render(
        <Router hook={hook}>
          <NotesView />
        </Router>,
        root!,
      )
    )

    const status = root.querySelector("[data-e2e=offline-status]")
    const heading = root.querySelector("h1")
    expect(status).not.toBe(null)
    expect(heading).not.toBe(null)
    expect(heading!.compareDocumentPosition(status!) & 4).toBe(4)
    // The page's own gap spaces it there; the gap it brings above a header would double it.
    expect(status!.classList.contains("mb-8")).toBe(false)
  })
})
