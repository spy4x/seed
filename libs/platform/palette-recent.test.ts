import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import { memoryStorage } from "@spy4x/platform/browser/storage"
import { createPaletteRecent, PALETTE_RECENT_KEY } from "./palette-recent.ts"

it("forgets the recent picks it kept, and leaves the device's other keys", () => {
  const storage = memoryStorage()
  storage.setItem(PALETTE_RECENT_KEY, `["go-notes"]`)
  storage.setItem(`theme`, `dark`)
  const recent = createPaletteRecent(storage)
  expect(recent.storage()).toBe(storage)

  recent.forget()

  expect(storage.getItem(PALETTE_RECENT_KEY)).toBe(null)
  expect(storage.getItem(`theme`)).toBe(`dark`)
})
