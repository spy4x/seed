/**
 * The notes list wired to the app's stores, in a browser DOM (happy-dom): a new account lands here
 * after sign-in, so the first-steps card sits at the top of the page, above the list's header. The
 * onboarding store's answer is put in place of the server's, and every other read the page starts
 * gets a refusal, so the page never reaches a server.
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
import { type OnboardingStatus, UserMFAStatus, UserRole } from "@domain/identity"
import type { CallPort } from "@spy4x/realtime/calls"
import { startOffline, stopOffline } from "../offline/index.ts"
import { createMemoryStorage } from "../offline/memory-storage.ts"
import { onboardingStore } from "../state/onboarding.ts"
import { selectionStore } from "../state/selection.ts"
import { sessionState } from "../state/session.ts"
import { NotesView } from "./NotesView.tsx"

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

const fresh: OnboardingStatus = {
  steps: {
    emailVerified: false,
    noteCreated: false,
    memberInvited: false,
    notificationsOn: false,
    twoFactorOn: false,
  },
  dismissed: false,
  tourSeen: false,
}

beforeAll(() => {
  // Preact draws into `document`, the router reads `location` and `history`, the library's tour
  // needs the rest (see `libs/ui/onboarding.test.tsx`), and every read the page starts is refused.
  const refuse = () =>
    Promise.resolve(Response.json({ error: { code: "NO", message: "No" } }, { status: 503 }))
  Object.assign(
    globalThis,
    Object.fromEntries(NAMES.map((name) => {
      if (name === "fetch") return [name, refuse]
      // Deno has no media queries: each test that needs a wide screen sets its own answer.
      if (name === "matchMedia") return [name, undefined]
      const value = (window as unknown as Record<string, unknown>)[name]
      return [
        name,
        typeof value === "function" && !/^[A-Z]/.test(name) ? value.bind(window) : value,
      ]
    })),
  )
  // The card reads the server through the socket; here it gets the answer of a new account.
  Object.assign(onboardingStore, {
    status: signal(fresh),
    visible: signal(true),
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

/** Lets the offline layer read its queues. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Draws the page at `/notes` into a fresh root. */
async function mount(): Promise<HTMLElement> {
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
  return root
}

describe("NotesView", () => {
  it("shows the first-steps card under the notes heading, which starts the page", async () => {
    const page = await mount()

    const card = page.querySelector("[data-e2e=onboarding]")
    const heading = page.querySelector("h1")
    expect(card).not.toBe(null)
    expect(heading).not.toBe(null)
    // The page header comes first (AGENTS.md, "One page header"); the card follows it.
    expect(heading!.compareDocumentPosition(card!) & 4).toBe(4)
  })

  it("draws the offline status under the notes heading, which starts the page", async () => {
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

    const page = await mount()

    const status = page.querySelector("[data-e2e=offline-status]")
    const heading = page.querySelector("h1")
    expect(status).not.toBe(null)
    expect(heading).not.toBe(null)
    expect(heading!.compareDocumentPosition(status!) & 4).toBe(4)
    // The page's own gap spaces it there; the gap it brings above a header would double it.
    expect(status!.classList.contains("mb-8")).toBe(false)
  })
})
