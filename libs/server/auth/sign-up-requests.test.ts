import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { ChallengeOutcome } from "@spy4x/server/auth"
import { MemoryAuthStore } from "@spy4x/server/auth/memory-store"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import {
  accountUsing,
  attemptSignUpCode,
  issueSignUpCode,
  SIGN_UP_MAX_GUESSES,
  SIGN_UP_TTL_MINUTES,
  signUpExpiry,
} from "./sign-up-requests.ts"

const NOW = new Date("2026-10-17T10:00:00Z")
const minutesLater = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000)
const REQUEST = { id: "019a0000-0000-7000-8000-000000000001", email: "ann@example.com" }
const OTHER = { id: "019a0000-0000-7000-8000-000000000002", email: "ann@example.com" }

describe("sign-up codes", () => {
  it("matches the issued code once, with surrounding whitespace ignored", async () => {
    const store = new MemoryAuthStore()
    const code = await issueSignUpCode(store, REQUEST, NOW)

    expect(code).toMatch(/^[A-Za-z0-9_-]{8}$/)
    expect(await attemptSignUpCode(store, REQUEST, ` ${code}\n`, NOW))
      .toBe(ChallengeOutcome.Matched)
    expect(await attemptSignUpCode(store, REQUEST, code, NOW)).toBe(ChallengeOutcome.Missing)
  })

  it("refuses a code issued for another sign-up of the same address", async () => {
    const store = new MemoryAuthStore()
    await issueSignUpCode(store, REQUEST, NOW)
    const code = await issueSignUpCode(store, OTHER, NOW)

    expect(await attemptSignUpCode(store, REQUEST, code, NOW)).toBe(ChallengeOutcome.WrongGuess)
  })

  it("refuses the code once it has expired", async () => {
    const store = new MemoryAuthStore()
    const code = await issueSignUpCode(store, REQUEST, NOW)

    const late = minutesLater(SIGN_UP_TTL_MINUTES)
    expect(await attemptSignUpCode(store, REQUEST, code, late)).toBe(ChallengeOutcome.Missing)
  })

  it("locks the sign-up after its guesses, and a new code buys no more", async () => {
    const store = new MemoryAuthStore()
    await issueSignUpCode(store, REQUEST, NOW)
    for (let guess = 0; guess < SIGN_UP_MAX_GUESSES; guess++) {
      expect(await attemptSignUpCode(store, REQUEST, "wrong-00", NOW))
        .toBe(ChallengeOutcome.WrongGuess)
    }
    const code = await issueSignUpCode(store, REQUEST, minutesLater(1))

    expect(await attemptSignUpCode(store, REQUEST, code, minutesLater(1)))
      .toBe(ChallengeOutcome.LockedOut)
  })

  it("ends a sign-up the code lifetime after it was asked for", () => {
    expect(signUpExpiry(NOW)).toEqual(minutesLater(SIGN_UP_TTL_MINUTES))
  })
})

describe("accountUsing", () => {
  it("finds nothing for an address no account uses", async () => {
    expect(await accountUsing(new MemoryAuthStore(), "ann@example.com")).toBe(null)
  })

  it("finds the account whose password signs in with the address, proven or not", async () => {
    const store = new MemoryAuthStore()
    const { user } = await store.createUserWithKey({
      method: PASSWORD_METHOD,
      subject: "ann@example.com",
      email: "ann@example.com",
      secret: "hash",
      provenAt: null,
    })

    expect(await accountUsing(store, "ann@example.com"))
      .toEqual({ userId: user.id, password: true, providers: [] })
  })

  it("finds an account with no password that owns the address, and its providers in link order", async () => {
    const store = new MemoryAuthStore()
    const { user } = await store.createUserWithKey({
      method: "github",
      subject: "1",
      email: "ann@example.com",
      secret: null,
      provenAt: NOW,
    })
    await store.addKey(user.id, {
      method: "google",
      subject: "2",
      email: "ann@example.com",
      secret: null,
      provenAt: NOW,
    })

    expect(await accountUsing(store, "ann@example.com"))
      .toEqual({ userId: user.id, password: false, providers: ["github", "google"] })
  })

  it("ignores a provider account that only claims the address unproven", async () => {
    const store = new MemoryAuthStore()
    await store.createUserWithKey({
      method: "github",
      subject: "1",
      email: "ann@example.com",
      secret: null,
      provenAt: null,
    })

    expect(await accountUsing(store, "ann@example.com")).toBe(null)
  })
})
