import { signal } from "@preact/signals"
import type { SignedInDevice } from "@domain/identity"
import { type LocalReads, noLocalReads } from "../modules.ts"
import { listSessions } from "./auth.ts"
import { READ_KEYS } from "./read-keys.ts"
import { ReadRefused } from "@spy4x/realtime/read-cache"

/** The read of the signed-in devices: `listSessions`, or a test's stand-in. */
export type DevicesList = typeof listSessions

/**
 * The devices the person is signed in on, for the profile page. The list last read is kept on the
 * device and shown when the server is unreachable, marked with its time: a device signed in or out
 * since then is not in it.
 */
export function createDevicesStore(
  list: DevicesList = listSessions,
  device: LocalReads = noLocalReads,
) {
  /** This device first; `null` until a read or the device's copy answers. */
  const sessions = signal<readonly SignedInDevice[] | null>(null)
  /** Why the list could not be read, or a sign-out failed; empty when the server gave no reason. */
  const error = signal<string | null>(null)
  /** When the list shown was taken from the server, while it is the device's copy; else `null`. */
  const savedAt = signal<number | null>(null)
  let reads = 0

  /** Reads the list again; a failure sets `error` and keeps the list shown. */
  async function load(): Promise<void> {
    const read = ++reads
    const show = (found: readonly SignedInDevice[], copyTakenAt: number | null) => {
      sessions.value = found
      savedAt.value = copyTakenAt
    }
    try {
      const answer = await device.through(
        READ_KEYS.devices,
        async () => {
          const result = await list()
          if (!result.ok) throw new ReadRefused(result.error, result.status ?? 0, result.code)
          return result.sessions
        },
        (copy) => {
          if (read !== reads) return false
          if (copy && sessions.value !== null) return false
          if (copy) return show(copy.value, copy.savedAt)
          sessions.value = null
          savedAt.value = null
        },
      )
      if (read !== reads) return
      show(answer.value, answer.fresh ? null : answer.savedAt)
      error.value = null
    } catch (cause) {
      if (read !== reads) return
      // An unreachable server with no copy gives no reason: the page shows its own wording.
      error.value = cause instanceof ReadRefused ? String(cause.failure) : ""
    }
  }

  return { sessions, error, savedAt, load }
}

export type DevicesStore = ReturnType<typeof createDevicesStore>
