import { createMemoryReadCache } from "@spy4x/realtime/testing"
import { createLocalReads, type LocalReads } from "../modules.ts"

/** The read copies of a device in memory, whose clock a test sets. */
export function memoryReads(now: () => number = () => 0): LocalReads {
  const cache = createMemoryReadCache(now)
  return createLocalReads(() => cache)
}
