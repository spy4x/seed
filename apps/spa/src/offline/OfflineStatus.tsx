import { useEffect, useState } from "preact/hooks"
import { createOnlineStatus } from "@spy4x/preact-signals/online"
import { ConflictChooser, type ConflictItem } from "@spy4x/preact-system/conflict-chooser"
import { SyncStatus } from "@spy4x/preact-system/sync-status"
import { Button } from "@spy4x/preact-ui/button"
import { activeLayer } from "./index.ts"
import type { NoteEntry } from "./notes-cache.ts"

const network = createOnlineStatus()

/** What the server holds now, in a conflict: its text, or that the note is gone. */
function serverSide(entry: NoteEntry): string {
  const server = entry.conflict?.server
  return server ? `${server.title}\n${server.body}`.trim() : "The note is no longer in this group."
}

/** What this person wrote, in a conflict. */
function mySide(entry: NoteEntry): string {
  return entry.kind === "delete"
    ? "You deleted this note."
    : `${entry.payload.title}\n${entry.payload.body}`.trim()
}

/** Both sides of one conflict, and a way to keep this person's text before choosing. */
function Sides({ entry }: { entry: NoteEntry }) {
  // The entry's seq when the copy worked, its negative when the browser refused.
  const [copied, setCopied] = useState(0)
  return (
    <div class="mt-2 grid gap-3 sm:grid-cols-2" data-e2e="note-sync-conflict">
      <div>
        <h3 class="text-sm font-semibold">Your version</h3>
        <p class="whitespace-pre-wrap text-sm" data-e2e="conflict-mine">{mySide(entry)}</p>
      </div>
      <div>
        <h3 class="text-sm font-semibold">Server's version</h3>
        <p class="whitespace-pre-wrap text-sm" data-e2e="conflict-theirs">{serverSide(entry)}</p>
      </div>
      <div class="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          data-e2e="conflict-copy"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(mySide(entry))
              setCopied(entry.seq!)
            } catch (_denied) {
              setCopied(-entry.seq!)
            }
          }}
        >
          Copy my text
        </Button>
        {copied === entry.seq && <span role="status" class="text-sm">Copied.</span>}
        {copied === -entry.seq! && (
          <span role="status" class="text-sm">Could not copy: select the text above.</span>
        )}
      </div>
    </div>
  )
}

/**
 * Whether this group's notes writes have reached the server, and the ones the server did not take,
 * each with both sides and a choice. Nothing here changes a note until the person picks: a conflict
 * never overwrites the other side on its own. `onResolved` runs after a choice so the list can
 * reread. The words and the keyboard behaviour come from `SyncStatus` and `ConflictChooser`.
 */
export function OfflineStatus(
  { groupId, onResolved }: { groupId: string; onResolved: () => void },
) {
  const layer = activeLayer.value
  const [runner, setRunner] = useState(() => layer?.runner.getState())
  useEffect(() => {
    setRunner(layer?.runner.getState())
    const stop = network.watch()
    const unsubscribe = layer?.runner.subscribe(setRunner)
    return () => {
      stop()
      unsubscribe?.()
    }
  }, [layer])
  if (!layer) return null
  const entries = layer.entries.value.filter((entry) => entry.payload.groupId === groupId)
  const pending = entries.filter((entry) => entry.status === "pending").length
  const conflicts = entries.filter((entry) => entry.status === "conflict")
  if (pending === 0 && conflicts.length === 0 && network.online.value) return null

  const items: ConflictItem[] = conflicts.map((entry) => ({
    id: String(entry.seq),
    label: entry.kind === "delete" ? "Deleted note" : entry.payload.title || "Untitled note",
    reason: entry.conflict?.reason ?? "version",
    message: <Sides entry={entry} />,
    // A server that no longer has the note has nothing to keep mine against.
    canKeepMine: Boolean(entry.conflict?.server),
  }))
  const choose = (id: string, choice: "keepMine" | "useTheirs") => {
    const entry = conflicts.find((candidate) => String(candidate.seq) === id)
    if (!entry) return
    return layer.notes.outbox[choice](entry).then(onResolved)
  }

  return (
    <section class="mx-auto mb-4 w-full max-w-3xl px-4" aria-label="Sync" data-e2e="offline-status">
      <SyncStatus
        online={network.online.value}
        pending={pending}
        syncing={runner?.running}
        failed={(runner?.failures ?? 0) > 0 && runner?.lastError != null}
        onRetry={() =>
          void layer.runner.kick()}
        labels={{ synced: "" }}
        class="data-[sync-state=waiting]:text-muted"
      />
      {conflicts.length > 0 && (
        <ConflictChooser
          conflicts={items}
          onKeepMine={(id) => choose(id, "keepMine")}
          onUseTheirs={(id) =>
            choose(id, "useTheirs")}
          labels={{ useTheirs: { version: "Use the server's" } }}
        />
      )}
    </section>
  )
}
