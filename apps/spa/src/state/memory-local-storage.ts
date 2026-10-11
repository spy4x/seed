import { memoryStorage } from "@spy4x/platform/browser/storage"

/**
 * Puts the library's in-memory storage in place of the runtime's `localStorage` for one test, and
 * gives it and the way back. Deno's own is a getter on `globalThis` that a plain assignment does
 * not replace, and it keeps its values on disk from one run to the next.
 */
export function installLocalStorage(): { kept: ReturnType<typeof memoryStorage>; restore(): void } {
  const kept = memoryStorage()
  const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: kept })
  return {
    kept,
    restore() {
      if (real) Object.defineProperty(globalThis, "localStorage", real)
      else delete (globalThis as { localStorage?: unknown }).localStorage
    },
  }
}
