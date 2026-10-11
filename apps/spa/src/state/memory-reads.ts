import type { ReadCache } from "@spy4x/realtime/read-cache"
import { createLocalReads, type LocalReads } from "../modules.ts"

/**
 * A `ReadCache` in memory, for the tests: Deno has no IndexedDB. It keeps the one rule of the
 * IndexedDB cache the stores rely on, that nothing is saved after `clear`. `entries` is the device:
 * a second cache over the same map finds what the first one saved.
 */
export function createMemoryReadCache(
  now: () => number = () => 0,
  entries: Map<string, { value: unknown; savedAt: number }> = new Map(),
): ReadCache {
  let cleared = false
  return {
    get: <T>(key: string) =>
      Promise.resolve(entries.get(key) as { value: T; savedAt: number } | undefined),
    set(key, value) {
      const savedAt = now()
      if (!cleared) entries.set(key, { value: structuredClone(value), savedAt })
      return Promise.resolve(savedAt)
    },
    clear() {
      cleared = true
      entries.clear()
      return Promise.resolve()
    },
  }
}

/** The read copies of a device in memory, whose clock a test sets. */
export function memoryReads(now: () => number = () => 0): LocalReads {
  const cache = createMemoryReadCache(now)
  return createLocalReads(() => cache)
}
