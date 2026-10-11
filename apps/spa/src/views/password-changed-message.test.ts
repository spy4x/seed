import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { passwordChangedMessage } from "./password-changed-message.ts"

describe("passwordChangedMessage", () => {
  it("says how many API tokens the change revoked, one or several", () => {
    expect(passwordChangedMessage(false, 1)).toBe(
      "Your API token was revoked. Use the new password next time you sign in.",
    )
    expect(passwordChangedMessage(true, 3)).toBe(
      "Every other device was signed out. Your 3 API tokens were revoked. " +
        "Use the new password next time you sign in.",
    )
  })

  it("says nothing about tokens when the person had none", () => {
    expect(passwordChangedMessage(true, 0)).toBe(
      "Every other device was signed out. Use the new password next time you sign in.",
    )
    expect(passwordChangedMessage(false, 0)).toBe("Use the new password next time you sign in.")
  })
})
