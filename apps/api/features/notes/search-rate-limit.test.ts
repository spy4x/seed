import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { createKvStore, type RateLimitStore } from "@spy4x/platform/rate-limit"
import { createNoteSearchLimit, NOTE_SEARCHES_PER_USER } from "./search-rate-limit.ts"

/** A new in-process store, standing in for Valkey. */
function memoryStore(): RateLimitStore {
  const entries = new Map<string, unknown>()
  return createKvStore({
    backend: {
      get: (key) => Promise.resolve(entries.get(key)),
      set: (key, value) => Promise.resolve(void entries.set(key, value)),
      delete: (key) => Promise.resolve(void entries.delete(key)),
    },
  })
}

describe(`note search limit`, () => {
  it(`refuses a person's search past the budget and keeps another person's budget whole`, async () => {
    const store = memoryStore()
    const allowed = createNoteSearchLimit({ store: () => store })

    for (let i = 0; i < NOTE_SEARCHES_PER_USER; i++) {
      expect(await allowed(1)).toBe(true)
    }

    expect(await allowed(1)).toBe(false)
    expect(await allowed(2)).toBe(true)
  })

  it(`lets the search run while the store is down`, async () => {
    const down = () => Promise.reject(new Error(`valkey is down`))
    const allowed = createNoteSearchLimit({
      store: () => ({ read: down, write: down, delete: down, consume: down, release: down }),
    })

    expect(await allowed(1)).toBe(true)
  })
})
