import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { ChallengeOutcome } from "@spy4x/server/auth"
import { MemoryAuthStore } from "@spy4x/server/auth/memory-store"
import { MAILED_CODE_MAX_GUESSES, mailedCodes } from "./mailed-codes.ts"

const NOW = new Date("2026-10-23T10:00:00Z")
const minutesLater = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000)
const UNTIL = minutesLater(10)

const codes = mailedCodes("test.mailed-code")
const ANN = { id: "01900000-0000-7000-8000-000000000001", email: "ann@example.com" }
const ANN_OTHER = { id: "01900000-0000-7000-8000-000000000002", email: "ann@example.com" }
const BOB = { id: "01900000-0000-7000-8000-000000000003", email: "bob@example.com" }

/** A code that is not `code`, of the same shape. */
const other = (code: string) => (code[0] === "A" ? "B" : "A") + code.slice(1)

describe("mailed codes", () => {
  it("makes an 8-character base64url code that works once", async () => {
    const store = new MemoryAuthStore()
    const code = await codes.issue(store, ANN, UNTIL, NOW)

    expect(code).toMatch(/^[A-Za-z0-9_-]{8}$/)
    expect(await codes.attempt(store, ANN, code, NOW)).toBe(ChallengeOutcome.Matched)
    expect(await codes.attempt(store, ANN, code, NOW)).toBe(ChallengeOutcome.Missing)
  })

  it("accepts a code with spaces a mail app added", async () => {
    const store = new MemoryAuthStore()
    const code = await codes.issue(store, ANN, UNTIL, NOW)

    const spaced = ` ${code.slice(0, 4)} ${code.slice(4)}\n`
    expect(await codes.attempt(store, ANN, spaced, NOW)).toBe(ChallengeOutcome.Matched)
  })

  it("refuses a code once it expires", async () => {
    const store = new MemoryAuthStore()
    const code = await codes.issue(store, ANN, UNTIL, NOW)

    expect(await codes.attempt(store, ANN, code, UNTIL)).toBe(ChallengeOutcome.Missing)
  })

  it("refuses a malformed value without counting a guess", async () => {
    const store = new MemoryAuthStore()
    const code = await codes.issue(store, ANN, UNTIL, NOW)

    for (let i = 0; i < MAILED_CODE_MAX_GUESSES + 1; i++) {
      expect(await codes.attempt(store, ANN, "short", NOW)).toBe(ChallengeOutcome.WrongGuess)
    }
    expect(await codes.attempt(store, ANN, code, NOW)).toBe(ChallengeOutcome.Matched)
  })

  it("locks the request out after its wrong guesses, the right code included", async () => {
    const store = new MemoryAuthStore()
    const code = await codes.issue(store, ANN, UNTIL, NOW)

    for (let i = 0; i < MAILED_CODE_MAX_GUESSES; i++) {
      expect(await codes.attempt(store, ANN, other(code), NOW)).toBe(ChallengeOutcome.WrongGuess)
    }
    expect(await codes.attempt(store, ANN, code, NOW)).toBe(ChallengeOutcome.LockedOut)
  })

  it("ends the old code with a new one and keeps the guesses spent", async () => {
    const store = new MemoryAuthStore()
    const first = await codes.issue(store, ANN, UNTIL, NOW)
    for (let i = 0; i < MAILED_CODE_MAX_GUESSES - 1; i++) {
      await codes.attempt(store, ANN, other(first), NOW)
    }
    const second = await codes.issue(store, ANN, UNTIL, minutesLater(1))

    expect(await codes.attempt(store, ANN, first, minutesLater(1))).toBe(
      ChallengeOutcome.WrongGuess,
    )
    expect(await codes.attempt(store, ANN, second, minutesLater(1))).toBe(
      ChallengeOutcome.LockedOut,
    )
  })

  it("binds a code to its request: another request of the address does not take it", async () => {
    const store = new MemoryAuthStore()
    const code = await codes.issue(store, ANN, UNTIL, NOW)
    await codes.issue(store, ANN_OTHER, UNTIL, NOW)

    expect(await codes.attempt(store, ANN_OTHER, code, NOW)).toBe(ChallengeOutcome.WrongGuess)
  })

  it("forgets every code of one address and no other", async () => {
    const store = new MemoryAuthStore()
    const ann = await codes.issue(store, ANN, UNTIL, NOW)
    const annOther = await codes.issue(store, ANN_OTHER, UNTIL, NOW)
    const bob = await codes.issue(store, BOB, UNTIL, NOW)

    await codes.forget(store, ANN.email)

    expect(await codes.attempt(store, ANN, ann, NOW)).toBe(ChallengeOutcome.Missing)
    expect(await codes.attempt(store, ANN_OTHER, annOther, NOW)).toBe(ChallengeOutcome.Missing)
    expect(await codes.attempt(store, BOB, bob, NOW)).toBe(ChallengeOutcome.Matched)
  })
})
