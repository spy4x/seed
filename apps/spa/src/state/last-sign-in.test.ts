import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { createLastSignIn } from "@spy4x/platform/browser/last-sign-in"
import { memoryStorage } from "@spy4x/platform/browser/storage"
import type { SignInMethod } from "@domain/identity"
import { lastSignInHint, rememberSignIn } from "./last-sign-in.ts"

const method = (
  kind: SignInMethod["kind"],
  current: boolean,
  email: string | null,
): SignInMethod => ({ id: 1, kind, email, current, canUnlink: false })

const signedIn = { user: { id: 1 }, isMfaRequired: false }

/** A store over memory, and the raw text it holds. */
function store() {
  const storage = memoryStorage()
  return { kept: createLastSignIn("last", { storage }), raw: () => storage.getItem("last") }
}

describe("the last sign-in of this browser", () => {
  it("remembers the method the session signed in with", async () => {
    const { kept, raw } = store()
    const methods = [
      method("password", false, "ada@example.com"),
      method("google", true, "ada.lovelace@example.com"),
    ]

    await rememberSignIn(signedIn, () => Promise.resolve({ ok: true, methods }), kept)

    expect(lastSignInHint(kept)).toEqual({ method: "google", email: "a***@example.com" })
    expect(raw()).not.toContain("ada.lovelace")
  })

  it("reads back a sign-in by e-mail link, which no linked method lists (#391)", async () => {
    const { kept } = store()
    kept.remember("link", "ada@example.com")

    // The check after sign-in finds no linked method in use and keeps the link.
    await rememberSignIn(signedIn, () => Promise.resolve({ ok: true, methods: [] }), kept)

    expect(lastSignInHint(kept)).toEqual({ method: "link", email: "a***@example.com" })
  })

  it("asks nothing and remembers nothing while nobody is signed in or a code is still owed", async () => {
    const { kept } = store()
    let asked = 0
    const list = () => {
      asked++
      return Promise.resolve({ ok: true, methods: [method("google", true, "ada@example.com")] })
    }

    await rememberSignIn({ user: null, isMfaRequired: false }, list, kept)
    await rememberSignIn({ user: { id: 1 }, isMfaRequired: true }, list, kept)

    expect(asked).toBe(0)
    expect(lastSignInHint(kept)).toBe(null)
  })

  it("keeps what it had when the methods cannot be read", async () => {
    const { kept } = store()
    kept.remember("github", "ada@example.com")

    await rememberSignIn(signedIn, () => Promise.resolve({ ok: false }), kept)
    await rememberSignIn(signedIn, () => Promise.reject(new TypeError("Failed to fetch")), kept)
    await rememberSignIn(
      signedIn,
      () => Promise.resolve({ ok: true, methods: [method("google", false, "ada@example.com")] }),
      kept,
    )

    expect(lastSignInHint(kept)).toEqual({ method: "github", email: "a***@example.com" })
  })

  it("shows nothing for a remembered method this app does not have", () => {
    const { kept } = store()
    kept.remember("facebook", "ada@example.com")

    expect(lastSignInHint(kept)).toBe(null)
  })

  it("shows a password sign-in without an address when none was kept", () => {
    const { kept } = store()
    kept.remember("password", null)

    expect(lastSignInHint(kept)).toEqual({ method: "password", email: null })
  })
})
