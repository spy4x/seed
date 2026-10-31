import { type ChangesCopy, createChangesPull } from "@spy4x/realtime/changes"
import type { BenchmarkLocalData } from "../modules.ts"
import { CHANGES_KINDS, type ChangesRows, deviceCopy, openChangesCopy } from "./device-copy.ts"
import { changesLock } from "./index.ts"

/** A changes copy whose `replace` is timed, and whose failure goes to `onSave`, not the pull. */
function timedCopy(
  copy: ChangesCopy<ChangesRows>,
  onSave: (ms: number, error?: unknown) => void,
): ChangesCopy<ChangesRows> {
  return {
    cursor: (groupId) => copy.cursor(groupId),
    read: (kind, groupId) => copy.read(kind, groupId),
    apply: (...args) => copy.apply(...args),
    async replace(...args) {
      const start = performance.now()
      try {
        await copy.replace(...args)
        onSave(performance.now() - start)
      } catch (error) {
        onSave(performance.now() - start, error)
      }
    },
    drop: (groupId) => copy.drop(groupId),
    clear: () => copy.clear(),
  }
}

/**
 * The local data the benchmark page (#440) measures, with this module's own code: the changes pull
 * into an empty copy, and the device copy read back with no network.
 */
export const benchmarkLocalData: BenchmarkLocalData = {
  async pullFresh({ userId, groupId, readPage, onSave }) {
    const copy = openChangesCopy(userId)
    // From nothing, as a device that never opened the group: a full read, then one write.
    await copy.drop(groupId)
    const pull = createChangesPull({
      kinds: CHANGES_KINDS,
      copy: timedCopy(copy, onSave),
      lock: changesLock(userId),
      fetch: readPage,
    })
    await pull(groupId)
  },
  async readSaved(userId, groupId) {
    // A fresh connection to the saved copy, and no network: what a cold start offline reads.
    const copy = deviceCopy({
      copy: openChangesCopy(userId),
      fetch: () => Promise.reject(new Error(`The benchmark reads the device only`)),
    })
    return { notes: await copy.notes.readNotes(groupId), tags: await copy.tags.readTags(groupId) }
  },
  dropCopy: (userId, groupId) => openChangesCopy(userId).drop(groupId),
}
