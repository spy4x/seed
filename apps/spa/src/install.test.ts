import { expect } from "@std/expect"
import { afterAll, beforeAll, describe, it } from "@std/testing/bdd"
import { installLocalStorage } from "@spy4x/platform/browser/testing"
import type { InstallPromptStore } from "@spy4x/preact-signals/install-prompt"

/** The key and the text the app wrote before the library kept the flag. */
const OLD_KEY = `install-prompt-dismissed`
const OLD_TEXT = `1`

describe("the app's install store", () => {
  const browser = installLocalStorage({ [OLD_KEY]: OLD_TEXT })
  let install: InstallPromptStore

  beforeAll(async () => {
    // The store reads the flag once, when the module loads: that is the page load.
    install = (await import("./install.ts")).install
  })

  afterAll(() => browser.restore())

  it("does not ask a person again who said Not now before this change", () => {
    expect(install.dismissed.value).toBe(true)
  })

  it("keeps a Not now in the browser's localStorage, as the same key and text", () => {
    browser.kept.removeItem(OLD_KEY)

    void install.dismiss()

    expect(browser.kept.getItem(OLD_KEY)).toBe(OLD_TEXT)
  })
})
