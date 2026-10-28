import { useEffect, useState } from "preact/hooks"
import { createOnlineStatus } from "@spy4x/preact-signals/online"
import { ConflictChooser, type ConflictItem } from "@spy4x/preact-system/conflict-chooser"
import { SyncStatus } from "@spy4x/preact-system/sync-status"
import { Button } from "@spy4x/preact-ui/button"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { colorName } from "@ui/tag-parts.tsx"
import { useAppText } from "@ui/i18n.ts"
import { type Message, messageText } from "@ui/message.ts"
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
  /**
   * What the queue kept about the conflict: a key of the `app` catalog, or the server's own words
   * for a refusal. An entry queued before the keys holds English, shown as it is.
   */
  message: Message | null
  mine: string
  theirs: string
  canKeepMine: boolean
}

function noteView(t: Translator<string>, entry: NoteEntry): ConflictView {
  const server = entry.conflict?.server
  return {
    kind: "note",
    seq: entry.seq!,
    label: entry.kind === "delete"
      ? t.t(`OfflineStatus.deletedNote`)
      : entry.payload.title || t.t(`OfflineStatus.untitledNote`),
    reason: entry.conflict?.reason ?? "version",
    message: entry.conflict?.message ?? null,
    mine: entry.kind === "delete"
      ? t.t(`OfflineStatus.youDeletedNote`)
      : `${entry.payload.title}\n${entry.payload.body}`.trim(),
    theirs: server ? `${server.title}\n${server.body}`.trim() : t.t(`OfflineStatus.noteGone`),
    // A server that no longer has the note has nothing to keep mine against.
    canKeepMine: Boolean(server),
  }
}

function tagView(t: Translator<string>, entry: TagEntry): ConflictView {
  const server = entry.conflict?.server
  return {
    kind: "tag",
    seq: entry.seq!,
    label: entry.kind === "delete"
      ? t.t(`OfflineStatus.deletedTag`)
      : entry.payload.name
      ? t.t(`OfflineStatus.tag`, { name: entry.payload.name })
      : t.t(`OfflineStatus.tagNoName`),
    reason: entry.conflict?.reason ?? "version",
    message: entry.conflict?.message ?? null,
    mine: entry.kind === "delete"
      ? t.t(`OfflineStatus.youDeletedTag`)
      : `${entry.payload.name} (${colorName(entry.payload.color)})`,
    theirs: server ? `${server.name} (${colorName(server.color)})` : t.t(`OfflineStatus.tagGone`),
    canKeepMine: Boolean(server),
  }
}

/**
 * What happened, as the queue kept it, then both sides of one conflict, and a way to keep this
 * person's text before choosing. The chooser shows this in place of its own explanation.
 */
function Sides({ view }: { view: ConflictView }) {
  const t = useAppText()
  // The entry's seq when the copy worked, its negative when the browser refused.
  const [copied, setCopied] = useState(0)
  const said = messageText(t, view.message)
  return (
    <div class="mt-2 grid gap-3 sm:grid-cols-2" data-e2e={`${view.kind}-sync-conflict`}>
      {said && <p class="text-sm sm:col-span-2" data-e2e="conflict-message">{said}</p>}
      <div>
        <h3 class="text-sm font-semibold">{t.t(`OfflineStatus.mine`)}</h3>
        <p class="whitespace-pre-wrap text-sm" data-e2e="conflict-mine" translate={false}>
          {view.mine}
        </p>
      </div>
      <div>
        <h3 class="text-sm font-semibold">{t.t(`OfflineStatus.theirs`)}</h3>
        <p class="whitespace-pre-wrap text-sm" data-e2e="conflict-theirs" translate={false}>
          {view.theirs}
        </p>
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
          {t.t(`OfflineStatus.copy`)}
        </Button>
        {copied === view.seq && (
          <span role="status" class="text-sm">{t.t(`OfflineStatus.copied`)}</span>
        )}
        {copied === -view.seq && (
          <span role="status" class="text-sm">{t.t(`OfflineStatus.copyFailed`)}</span>
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
  { groupId, onResolved, underHeader = false }: {
    groupId: string
    onResolved: () => void
    /**
     * Drawn under the page header, inside a page whose own gap spaces it (Notes). Left out, it sits
     * above the header and brings its own gap.
     */
    underHeader?: boolean
  },
) {
  const t = useAppText()
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
    ...tagEntries.filter((entry) => entry.status === "conflict").map((entry) => tagView(t, entry)),
    ...entries.filter((entry) => entry.status === "conflict").map((entry) => noteView(t, entry)),
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
    // Above the page's header, as the shell's banner does, a section gap (`Page`'s gap-8) keeps a
    // conflict card off the header. Under it, the page's own gap does.
    <section
      class={underHeader ? "w-full" : "mb-8 w-full"}
      aria-label={t.t(`OfflineStatus.sync`)}
      data-e2e="offline-status"
    >
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
          {t.t(`OfflineStatus.held`, { count: held })}
        </p>
      )}
      {notices.map((message, index) => (
        <p key={index} class="mt-2 text-sm" role="status" data-e2e="sync-notice">
          {messageText(t, message)}{" "}
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
            {t.t(`OfflineStatus.dismiss`)}
          </Button>
        </p>
      ))}
      {conflicts.length > 0 && (
        <ConflictChooser
          conflicts={items}
          onKeepMine={(id) => choose(id, "keepMine")}
          onUseTheirs={(id) => choose(id, "useTheirs")}
          labels={{ useTheirs: { version: t.t(`OfflineStatus.useServers`) } }}
        />
      )}
    </section>
  )
}
