import { useEffect, useState } from "preact/hooks"
import { createOnlineStatus } from "@spy4x/preact-signals/online"
import { ConflictChooser, type ConflictItem } from "@spy4x/preact-system/conflict-chooser"
import { SyncStatus } from "@spy4x/preact-system/sync-status"
import { Button } from "@spy4x/preact-ui/button"
import { colorName } from "@ui/tag-parts.tsx"
import { activeLayer } from "./index.ts"
import type { NoteEntry } from "./notes-cache.ts"
import type { TagEntry } from "./tags-cache.ts"

const network = createOnlineStatus()

/** One conflict, in the words of the aggregate it is about. */
interface ConflictView {
  /** `note` or `tag`: the queue it came from, and the first part of its id. */
  kind: "note" | "tag"
  seq: number
  label: string
  reason: "version" | "gone" | "rejected"
  mine: string
  theirs: string
  canKeepMine: boolean
}

function noteView(entry: NoteEntry): ConflictView {
  const server = entry.conflict?.server
  return {
    kind: "note",
    seq: entry.seq!,
    label: entry.kind === "delete" ? "Deleted note" : entry.payload.title || "Untitled note",
    reason: entry.conflict?.reason ?? "version",
    mine: entry.kind === "delete"
      ? "You deleted this note."
      : `${entry.payload.title}\n${entry.payload.body}`.trim(),
    theirs: server
      ? `${server.title}\n${server.body}`.trim()
      : "The note is no longer in this group.",
    // A server that no longer has the note has nothing to keep mine against.
    canKeepMine: Boolean(server),
  }
}

function tagView(entry: TagEntry): ConflictView {
  const server = entry.conflict?.server
  return {
    kind: "tag",
    seq: entry.seq!,
    label: entry.kind === "delete"
      ? "Deleted tag"
      : `Tag ${entry.payload.name || "without a name"}`,
    reason: entry.conflict?.reason ?? "version",
    mine: entry.kind === "delete"
      ? "You deleted this tag."
      : `${entry.payload.name} (${colorName(entry.payload.color)})`,
    theirs: server
      ? `${server.name} (${colorName(server.color)})`
      : "The tag is no longer in this group.",
    canKeepMine: Boolean(server),
  }
}

/** Both sides of one conflict, and a way to keep this person's text before choosing. */
function Sides({ view }: { view: ConflictView }) {
  // The entry's seq when the copy worked, its negative when the browser refused.
  const [copied, setCopied] = useState(0)
  return (
    <div class="mt-2 grid gap-3 sm:grid-cols-2" data-e2e={`${view.kind}-sync-conflict`}>
      <div>
        <h3 class="text-sm font-semibold">Your version</h3>
        <p class="whitespace-pre-wrap text-sm" data-e2e="conflict-mine">{view.mine}</p>
      </div>
      <div>
        <h3 class="text-sm font-semibold">Server's version</h3>
        <p class="whitespace-pre-wrap text-sm" data-e2e="conflict-theirs">{view.theirs}</p>
      </div>
      <div class="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          data-e2e="conflict-copy"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(view.mine)
              setCopied(view.seq)
            } catch (_denied) {
              setCopied(-view.seq)
            }
          }}
        >
          Copy my text
        </Button>
        {copied === view.seq && <span role="status" class="text-sm">Copied.</span>}
        {copied === -view.seq && (
          <span role="status" class="text-sm">Could not copy: select the text above.</span>
        )}
      </div>
    </div>
  )
}

/**
 * Whether this group's notes and tags writes have reached the server, and the ones the server did
 * not take, each with both sides and a choice. Notes held back by a tag in conflict, and tags the
 * layer took off queued notes, are named too. Nothing here changes a note until the person picks: a conflict
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
  const tagEntries = layer.tagEntries.value.filter((entry) => entry.payload.groupId === groupId)
  const pending = [...entries, ...tagEntries].filter((entry) => entry.status === "pending").length
  const conflicts = [
    ...tagEntries.filter((entry) => entry.status === "conflict").map(tagView),
    ...entries.filter((entry) => entry.status === "conflict").map(noteView),
  ]
  // Notes that wait for the person's choice about a tag they name.
  const held = layer.collections.waiting().filter((w) => w.onPerson).length
  const notices = layer.notices.value
  if (
    pending === 0 && conflicts.length === 0 && held === 0 && notices.length === 0 &&
    network.online.value
  ) return null

  const items: ConflictItem[] = conflicts.map((view) => ({
    id: `${view.kind}:${view.seq}`,
    label: view.label,
    reason: view.reason,
    message: <Sides view={view} />,
    canKeepMine: view.canKeepMine,
  }))
  const choose = (id: string, choice: "keepMine" | "useTheirs") => {
    const [kind, seq] = id.split(":")
    const entry = kind === "tag"
      ? tagEntries.find((candidate) => String(candidate.seq) === seq)
      : entries.find((candidate) => String(candidate.seq) === seq)
    if (!entry) return
    const outbox = kind === "tag" ? layer.tags.outbox : layer.notes.outbox
    return outbox[choice](entry as never).then(onResolved)
  }

  return (
    // It sits above the page's header, as the shell's banner does: a section gap (`Page`'s gap-8)
    // keeps a conflict card off the header.
    <section class="mb-8 w-full" aria-label="Sync" data-e2e="offline-status">
      <SyncStatus
        online={network.online.value}
        pending={pending}
        syncing={runner?.running}
        failed={(runner?.failures ?? 0) > 0 && runner?.lastError != null}
        onRetry={() => void layer.runner.kick()}
        labels={{ synced: "" }}
        class="data-[sync-state=waiting]:text-muted"
      />
      {held > 0 && (
        <p class="mt-2 text-sm" role="status" data-e2e="sync-waiting">
          {held === 1 ? "A note is" : `${held} notes are`}{" "}
          waiting for your choice about a tag below. Nothing is lost.
        </p>
      )}
      {notices.map((message) => (
        <p key={message} class="mt-2 text-sm" role="status" data-e2e="sync-notice">
          {message}{" "}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-e2e="sync-notice-dismiss"
            onClick={() =>
              layer.notices.value = layer.notices.value.filter((m) =>
                m !== message
              )}
          >
            Dismiss
          </Button>
        </p>
      ))}
      {conflicts.length > 0 && (
        <ConflictChooser
          conflicts={items}
          onKeepMine={(id) => choose(id, "keepMine")}
          onUseTheirs={(id) => choose(id, "useTheirs")}
          labels={{ useTheirs: { version: "Use the server's" } }}
        />
      )}
    </section>
  )
}
