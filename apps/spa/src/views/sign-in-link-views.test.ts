import { expect } from "@std/expect"
import { afterEach, describe, it } from "@std/testing/bdd"
import { SIGN_UP_OFFLINE } from "@ui/sign-up-code-screen.tsx"
import { SIGN_IN_LINK_MESSAGES } from "@ui/sign-in-link-screen.tsx"
import { linkRequestFailure, secondsLeft, tokenOf } from "./SignInLinkViews.tsx"
import { forgetSentLink, readSentLink, rememberSentLink } from "../state/sign-in-link.ts"

describe("the sign-in link pages (#391)", () => {
  afterEach(() => forgetSentLink())

  it("reads the token from the fragment only", () => {
    expect(tokenOf("#token=abc.def")).toBe("abc.def")
    expect(tokenOf("#token=")).toBe(null)
    expect(tokenOf("")).toBe(null)
    expect(tokenOf("#other=1")).toBe(null)
  })

  it("counts the minute before a new link down to zero, never below", () => {
    const sentAt = 1_000_000
    expect(secondsLeft(sentAt, sentAt)).toBe(60)
    expect(secondsLeft(sentAt, sentAt + 15_000)).toBe(45)
    expect(secondsLeft(sentAt, sentAt + 59_500)).toBe(1)
    expect(secondsLeft(sentAt, sentAt + 60_000)).toBe(0)
    expect(secondsLeft(sentAt, sentAt + 600_000)).toBe(0)
  })

  it("says offline, the API's message, or the general failure", () => {
    expect(linkRequestFailure({ ok: false, offline: true })).toBe(SIGN_UP_OFFLINE)
    expect(linkRequestFailure({ ok: false, error: "Too many links" })).toBe("Too many links")
    expect(linkRequestFailure({ ok: false })).toBe(SIGN_IN_LINK_MESSAGES.sendFailed)
  })

  it("keeps the address and the time of the last link for the tab, until forgotten", () => {
    rememberSentLink({ email: "ada@example.com", sentAt: 42 })
    expect(readSentLink()).toEqual({ email: "ada@example.com", sentAt: 42 })

    forgetSentLink()
    expect(readSentLink()).toBe(null)
  })
})
