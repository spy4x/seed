import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { MemoryAuthStore } from "@spy4x/server/auth/memory-store"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import {
  consumePasswordReset,
  issuePasswordReset,
  PASSWORD_RESET_TTL_MINUTES,
  passwordResetLink,
} from "./password-reset.ts"

const NOW = new Date("2026-10-02T10:00:00Z")
const minutesLater = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000)

/** A store with one address account (`ann@example.com`) and one older username account. */
async function storeWithAccounts(): Promise<MemoryAuthStore> {
  const store = new MemoryAuthStore()
  await store.createUserWithKey({
    method: PASSWORD_METHOD,
    subject: "ann@example.com",
    email: "ann@example.com",
    secret: "hash",
    provenAt: null,
  })
  await store.createUserWithKey({
    method: PASSWORD_METHOD,
    subject: "bob@example.com",
    email: null,
    secret: "hash",
    provenAt: null,
  })
  return store
}

describe("issuePasswordReset", () => {
  it("issues a code for the account that signs in with the address, matched after normalising", async () => {
    const store = await storeWithAccounts()

    const issued = await issuePasswordReset(store, "  ANN@example.com ", NOW)

    expect(issued?.email).toBe("ann@example.com")
    expect(issued?.code).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(issued?.expiresAt).toEqual(minutesLater(PASSWORD_RESET_TTL_MINUTES))
  })

  it("issues nothing for an address no account signs in with", async () => {
    const store = await storeWithAccounts()

    expect(await issuePasswordReset(store, "nobody@example.com", NOW)).toBe(null)
    expect(await consumePasswordReset(store, "nobody@example.com", "anything", NOW)).toBe(false)
  })

  it("issues nothing for an older username account whose username looks like an address", async () => {
    const store = await storeWithAccounts()

    expect(await issuePasswordReset(store, "bob@example.com", NOW)).toBe(null)
  })

  it("issues nothing for an account whose sign-in record is marked deleted", async () => {
    const store = await storeWithAccounts()
    const key = (await store.findKey(PASSWORD_METHOD, "ann@example.com"))!
    const findUser = store.findUser.bind(store)
    store.findUser = async (id) => {
      const user = await findUser(id)
      return user && id === key.userId ? { ...user, deletedAt: NOW } : user
    }

    expect(await issuePasswordReset(store, "ann@example.com", NOW)).toBe(null)
    // No code was stored either: a reset code only ever exists for a live account.
    expect(await consumePasswordReset(store, "ann@example.com", "anything", NOW)).toBe(false)
  })

  it("issues nothing for a value that is not an address", async () => {
    const store = await storeWithAccounts()

    expect(await issuePasswordReset(store, "ann", NOW)).toBe(null)
  })
})

describe("consumePasswordReset", () => {
  it("accepts the code once, so the same link never works twice", async () => {
    const store = await storeWithAccounts()
    const issued = (await issuePasswordReset(store, "ann@example.com", NOW))!

    expect(await consumePasswordReset(store, issued.email, issued.code, minutesLater(1))).toBe(true)
    expect(await consumePasswordReset(store, issued.email, issued.code, minutesLater(2))).toBe(
      false,
    )
  })

  it(`refuses the code once ${PASSWORD_RESET_TTL_MINUTES} minutes have passed`, async () => {
    const store = await storeWithAccounts()
    const issued = (await issuePasswordReset(store, "ann@example.com", NOW))!

    const late = minutesLater(PASSWORD_RESET_TTL_MINUTES)
    expect(await consumePasswordReset(store, issued.email, issued.code, late)).toBe(false)
  })

  it("accepts the code just before it expires", async () => {
    const store = await storeWithAccounts()
    const issued = (await issuePasswordReset(store, "ann@example.com", NOW))!

    const justInTime = new Date(minutesLater(PASSWORD_RESET_TTL_MINUTES).getTime() - 1)
    expect(await consumePasswordReset(store, issued.email, issued.code, justInTime)).toBe(true)
  })

  it("refuses an older link once a newer one is issued for the address", async () => {
    const store = await storeWithAccounts()
    const first = (await issuePasswordReset(store, "ann@example.com", NOW))!
    const second = (await issuePasswordReset(store, "ann@example.com", minutesLater(1)))!

    expect(await consumePasswordReset(store, first.email, first.code, minutesLater(2))).toBe(false)
    expect(await consumePasswordReset(store, second.email, second.code, minutesLater(2))).toBe(
      true,
    )
  })

  it("refuses another address's code, and an empty one", async () => {
    const store = await storeWithAccounts()
    const issued = (await issuePasswordReset(store, "ann@example.com", NOW))!

    expect(await consumePasswordReset(store, "bob@example.com", issued.code, NOW)).toBe(false)
    expect(await consumePasswordReset(store, issued.email, "", NOW)).toBe(false)
    expect(await consumePasswordReset(store, issued.email, undefined, NOW)).toBe(false)
  })
})

describe("passwordResetLink", () => {
  it("points at the app's reset page with the address and the code, encoded", () => {
    const link = passwordResetLink("https://app.example.com", {
      email: "ann+test@example.com",
      userId: 1,
      code: "abc_-123",
      expiresAt: NOW,
    })

    const url = new URL(link)
    expect(url.origin + url.pathname).toBe("https://app.example.com/reset-password")
    expect(url.searchParams.get("email")).toBe("ann+test@example.com")
    expect(url.searchParams.get("code")).toBe("abc_-123")
  })
})
