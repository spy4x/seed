import { expect } from "@std/expect"
import { afterEach, describe, it } from "@std/testing/bdd"
import { SIGN_UP_OFFLINE } from "@ui/sign-up-code-screen.tsx"
import { SIGN_IN_LINK_MESSAGES } from "@ui/sign-in-link-screen.tsx"
import { linkRequestFailure, tokenOf } from "./SignInLinkViews.tsx"
import { createTranslator } from "@spy4x/platform/universal/i18n"

/** A translator with no catalog: every message is its key, so the test sees which one was said. */
const KEYS = createTranslator({ language: "en", catalogs: [] })
import { forgetSentLink, readSentLink, rememberSentLink } from "../state/sign-in-link.ts"

describe("the sign-in link pages (#391)", () => {
  afterEach(() => forgetSentLink())

  it("reads the token from the fragment only", () => {
    expect(tokenOf("#token=abc.def")).toBe("abc.def")
    expect(tokenOf("#token=")).toBe(null)
    expect(tokenOf("")).toBe(null)
    expect(tokenOf("#other=1")).toBe(null)
  })

  it("says offline, the API's message, or the general failure", () => {
    expect(linkRequestFailure(KEYS, { ok: false, offline: true })).toBe(SIGN_UP_OFFLINE)
    expect(linkRequestFailure(KEYS, { ok: false, error: "Too many links" })).toBe("Too many links")
    expect(linkRequestFailure(KEYS, { ok: false })).toBe(SIGN_IN_LINK_MESSAGES.sendFailed)
  })

  it("keeps the address and the time of the last link for the tab, until forgotten", () => {
    rememberSentLink({ email: "ada@example.com", sentAt: 42 })
    expect(readSentLink()).toEqual({ email: "ada@example.com", sentAt: 42 })

    forgetSentLink()
    expect(readSentLink()).toBe(null)
  })
})
