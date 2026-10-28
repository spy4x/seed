import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { createTranslator } from "@spy4x/platform/universal/i18n"
import app from "@i18n/app/en.json" with { type: "json" }
import { passwordChangedMessage } from "./password-changed-message.ts"

const EN = createTranslator({ language: "en", catalogs: [{ source: app }] })

describe("passwordChangedMessage", () => {
  it("says how many API tokens the change revoked, one or several", () => {
    expect(passwordChangedMessage(EN, false, 1)).toBe(
      "Your API token was revoked. Use the new password next time you sign in.",
    )
    expect(passwordChangedMessage(EN, true, 3)).toBe(
      "Every other device was signed out. Your 3 API tokens were revoked. " +
        "Use the new password next time you sign in.",
    )
  })

  it("says nothing about tokens when the person had none", () => {
    expect(passwordChangedMessage(EN, true, 0)).toBe(
      "Every other device was signed out. Use the new password next time you sign in.",
    )
    expect(passwordChangedMessage(EN, false, 0)).toBe("Use the new password next time you sign in.")
  })
})
