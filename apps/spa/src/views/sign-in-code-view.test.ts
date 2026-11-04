import { expect } from "@std/expect"
import { afterEach, describe, it } from "@std/testing/bdd"
import { SIGN_UP_OFFLINE } from "@ui/sign-up-code-screen.tsx"
import { MAILED_CODE_COOLDOWN_SECONDS, SIGN_IN_CODE_MESSAGES } from "@ui/sign-in-code-screen.tsx"
import { codeFailure, isProofReturn, readyAtOf } from "./SignInCodeView.tsx"
import { createTranslator } from "@spy4x/platform/universal/i18n"
import {
  forgetSentCode,
  readSentCode,
  rememberSentCode,
  sentCodeFor,
} from "../state/sign-in-code.ts"

/** A translator with no catalog: every message is its key, so the test sees which one was said. */
const KEYS = createTranslator({ language: "en", catalogs: [] })

describe("the sign-in code page (#391, #752)", () => {
  afterEach(() => {
    forgetSentCode()
    forgetSentCode("sign-up")
  })

  it("says offline, the API's message, or the general failure", () => {
    expect(codeFailure(KEYS, { ok: false, offline: true })).toBe(SIGN_UP_OFFLINE)
    expect(codeFailure(KEYS, { ok: false, error: "Too many codes" })).toBe("Too many codes")
    expect(codeFailure(KEYS, { ok: false })).toBe(SIGN_IN_CODE_MESSAGES.sendFailed)
    expect(codeFailure(KEYS, { ok: false }, SIGN_IN_CODE_MESSAGES.checkFailed))
      .toBe(SIGN_IN_CODE_MESSAGES.checkFailed)
  })

  it("waits a minute after a code before offering a new one, and not at all with none sent", () => {
    expect(readyAtOf({ email: "ada@example.com", sentAt: 1_000 }))
      .toBe(1_000 + MAILED_CODE_COOLDOWN_SECONDS * 1000)
    expect(readyAtOf(null)).toBe(undefined)
  })

  it("keeps the address and the time of the last code for the tab, until forgotten", () => {
    rememberSentCode({ email: "ada@example.com", sentAt: 42 })
    expect(readSentCode()).toEqual({ email: "ada@example.com", sentAt: 42 })

    forgetSentCode()
    expect(readSentCode()).toBe(null)
  })

  it("keeps a sign-up code apart from a sign-in code", () => {
    rememberSentCode({ email: "ada@example.com", sentAt: 7 }, "sign-up")
    expect(readSentCode("sign-up")).toEqual({ email: "ada@example.com", sentAt: 7 })
    expect(readSentCode()).toBe(null)

    forgetSentCode("sign-up")
    expect(readSentCode("sign-up")).toBe(null)
  })

  it("keeps the wait of a code sent to the waiting address, however it was typed", () => {
    const kept = { email: " Ada@Example.com ", sentAt: 42 }
    expect(sentCodeFor(kept, "ada@example.com")).toEqual({ email: "ada@example.com", sentAt: 42 })
    expect(sentCodeFor(kept, "bob@example.com")).toEqual({ email: "bob@example.com", sentAt: 0 })
    expect(sentCodeFor(null, "ada@example.com")).toEqual({ email: "ada@example.com", sentAt: 0 })
  })

  it("treats only a return to the profile as the danger zone's proof flow", () => {
    expect(isProofReturn("/profile")).toBe(true)
    expect(isProofReturn("/profile/danger-zone?tab=1")).toBe(true)
    expect(isProofReturn("/notes")).toBe(false)
    expect(isProofReturn("/profiles")).toBe(false)
  })
})
