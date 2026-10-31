import { useSignal } from "@preact/signals"
import { useEffect, useRef } from "preact/hooks"
import { copyToClipboard } from "@spy4x/platform/browser/clipboard"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { rangeForPreset } from "@spy4x/preact-ui/date-range"
import { useFormat } from "@spy4x/preact-ui/format"
import {
  type BenchmarkDevice,
  type BenchmarkGroup,
  BenchmarkScreen,
  type BenchmarkScreenProps,
  type BenchmarkStep,
  type BenchmarkStoppedRun,
} from "@ui/benchmark-screen.tsx"
import { filterNotes, NO_NOTE_FILTERS } from "@ui/notes-filter.ts"
import { NotesScreen } from "@ui/notes-screen.tsx"
import type { TagRow } from "@ui/tag-parts.tsx"
import { benchmarkLocalData, callQuery } from "../modules.ts"
import {
  browserRecord,
  type Measures,
  pendingSteps,
  runBenchmark,
  StepFailure,
  stoppedRun as readStoppedRun,
} from "../state/benchmark.ts"
import { benchmarkPageActions } from "../state/demo.ts"
import { emailStore } from "../state/email.ts"
import { groupsStore } from "../state/groups.ts"
import type { NoteItem } from "../state/notes.ts"
import { selectionStore } from "../state/selection.ts"
import { sessionState } from "../state/session.ts"
import type { TagItem } from "../state/tags.ts"

/**
 * `/benchmark` (#440): runs the measures of `BenchmarkScreen` on this device with the SPA's own
 * code: the changes pull and IndexedDB copy of the local-data module (`benchmarkLocalData`), the
 * real notes list and the list's own search and filter. Only in a development build or on the
 * public demo (`benchmarkOpen`).
 */

/** The generator that makes a large group (docs/capacity.md); `M` is 10,000 notes. */
const GENERATOR = `deno task load:group M --member`

/** A frame interval this much over 60 Hz counts the frames it skipped as dropped. */
const FRAME_MS = 1_000 / 60

/** How long the scroll measure scrolls. */
const SCROLL_MS = 2_000

/** What the browser says about this device. */
function readDevice(): BenchmarkDevice {
  const nav = navigator as Navigator & {
    deviceMemory?: number
    connection?: { effectiveType?: string }
  }
  return {
    browser: nav.userAgent,
    cores: nav.hardwareConcurrency || null,
    memory: nav.deviceMemory ?? null,
    connection: nav.connection?.effectiveType ?? null,
  }
}

/** Resolves after the next frame has been painted. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  )
}

/** The live notes of each group as of today, through the overview's own count, one per group. */
async function noteCounts(
  groupIds: readonly string[],
  timeZone: string,
): Promise<Map<string, number>> {
  const today = rangeForPreset(`today`, { now: new Date(), timeZone }).to
  const counts = await Promise.all(groupIds.map(async (groupId) => {
    try {
      const total = await callQuery<{ current: number }>(`note.widget.total`, {
        groupId,
        from: today,
        to: today,
        timeZone,
      })
      return [groupId, total.current] as const
    } catch {
      return null
    }
  }))
  return new Map(counts.filter((entry) => entry !== null))
}

/** Fails a frame measure the tab could not paint, because it left the screen. */
function assertShown(): void {
  if (document.hidden) throw new StepFailure(`hidden`, `The tab was hidden during the measure`)
}

/** The page: picks a group, runs the measures and keeps the outcome. */
export function BenchmarkView() {
  const userId = sessionState.value.user?.id ?? null
  const counts = useSignal<Map<string, number>>(new Map())
  const chosen = useSignal<string | null>(null)
  const state = useSignal<BenchmarkScreenProps["state"]>(`idle`)
  const steps = useSignal<readonly BenchmarkStep[]>(pendingSteps())
  const failure = useSignal<BenchmarkScreenProps["failure"]>(null)
  const durationMs = useSignal<number | null>(null)
  const json = useSignal<string | null>(null)
  const formError = useSignal<BenchmarkScreenProps["formError"]>(null)
  const stopped = useSignal<BenchmarkStoppedRun | null>(readStoppedRun(browserRecord))
  const testNotes = useSignal<{ notes: NoteItem[]; tags: TagItem[] } | null>(null)
  const device = useRef(readDevice()).current
  const run = useRef<AbortController | null>(null)

  const format = useFormat()
  const memberships = groupsStore.groups.value
  const groups: BenchmarkGroup[] = memberships.map((group) => ({
    id: group.id,
    name: group.name,
    notes: counts.value.get(group.id) ?? null,
  }))
  const largest = [...groups].sort((a, b) => (b.notes ?? -1) - (a.notes ?? -1))[0]
  const selectedId = chosen.value ?? largest?.id ?? null

  const groupKey = memberships.map((group) => group.id).join()
  useEffect(() => {
    let live = true
    void noteCounts(memberships.map((group) => group.id), format.timeZone).then((read) => {
      if (live) counts.value = read
    })
    return () => {
      live = false
    }
  }, [groupKey, format.timeZone])

  useEffect(() => {
    benchmarkPageActions.value = {
      run: () =>
        document.querySelector<HTMLButtonElement>(
          `[data-e2e="benchmark-run"], [data-e2e="benchmark-run-again"]`,
        )?.click(),
      copy: () => document.querySelector<HTMLButtonElement>(`[data-e2e="benchmark-copy"]`)?.click(),
    }
    return () => {
      benchmarkPageActions.value = null
      run.current?.abort()
    }
  }, [])

  /** The measures of one run of `groupId`, sharing what earlier steps read. */
  function measuresOf(groupId: string, userId: number, total: number | null): Measures {
    // `benchmarkOpen` keeps the page closed without the local-data module.
    const local = benchmarkLocalData
    if (!local) throw new Error(`The benchmark needs the local-data module`)
    const saved = { ms: 0, error: undefined as unknown }
    let downloaded: number | null = null
    let notes: NoteItem[] = []
    let tags: TagItem[] = []
    return {
      async download({ signal, progress }) {
        let rows = 0
        let lastPage = performance.now()
        const start = performance.now()
        await local.pullFresh({
          userId,
          groupId,
          async readPage(group, after) {
            signal.throwIfAborted()
            const page = await callQuery<{ upserts?: { notes?: unknown[] } }>(`group.changes`, {
              groupId: group,
              after,
            })
            rows += page.upserts?.notes?.length ?? 0
            lastPage = performance.now()
            progress(rows, total ?? 0)
            return page
          },
          onSave(ms, error) {
            saved.ms = ms
            saved.error = error
          },
        })
        downloaded = lastPage - start
        return { value: downloaded }
      },
      async save() {
        if (saved.error !== undefined) throw saved.error
        return { value: saved.ms }
      },
      async startOffline() {
        const start = performance.now()
        ;({ notes, tags } = await local.readSaved(userId, groupId))
        return { value: performance.now() - start }
      },
      async firstNotes() {
        const start = performance.now()
        testNotes.value = { notes, tags }
        await nextPaint()
        assertShown()
        return { value: performance.now() - start }
      },
      async scroll({ signal }) {
        const area = document.querySelector<HTMLElement>(`[data-e2e="benchmark-test-area"]`)
        if (!area) throw new Error(`The test area is not on the page`)
        const distance = Math.max(0, area.scrollHeight - area.clientHeight)
        let frames = 0
        let dropped = 0
        const start = performance.now()
        let last = start
        while (performance.now() - start < SCROLL_MS && !signal.aborted) {
          await new Promise((resolve) => requestAnimationFrame(resolve))
          const at = performance.now()
          dropped += Math.max(0, Math.round((at - last) / FRAME_MS) - 1)
          frames++
          last = at
          area.scrollTop = distance * Math.min(1, (at - start) / SCROLL_MS)
          assertShown()
        }
        return { value: frames + dropped === 0 ? 0 : (dropped / (frames + dropped)) * 100 }
      },
      async search() {
        // A word of a note in the middle of the list, so the search finds some notes, not all.
        const sample = notes[Math.floor(notes.length / 2)]?.title ?? ``
        const q = sample.split(/\s+/).find((word) => word.length >= 3) ?? `note`
        const start = performance.now()
        filterNotes(notes, { ...NO_NOTE_FILTERS, q }, { youId: null, knownTagIds: [] })
        return { value: performance.now() - start }
      },
      async filter() {
        const knownTagIds = tags.map((tag) => tag.id)
        const start = performance.now()
        filterNotes(
          notes,
          { ...NO_NOTE_FILTERS, tagIds: knownTagIds.slice(0, 1), sort: `title` },
          { youId: null, knownTagIds },
        )
        return { value: performance.now() - start }
      },
      async memory() {
        const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
        return heap ? { value: heap.usedJSHeapSize } : `unavailable`
      },
      async storage() {
        if (!navigator.storage?.estimate) return `unavailable`
        const estimate = await navigator.storage.estimate()
        return estimate.usage === undefined
          ? `unavailable`
          : { value: estimate.usage, quota: estimate.quota }
      },
      async clear() {
        testNotes.value = null
        notes = []
        // The group the app has open keeps its copy: the app reads it.
        if (groupId === selectionStore.groupId.value) return { kept: true }
        await local.dropCopy(userId, groupId)
        return { kept: false }
      },
    }
  }

  async function start() {
    const group = groups.find((candidate) => candidate.id === selectedId)
    if (!group || userId === null) {
      formError.value = `noGroup`
      return
    }
    if (!navigator.onLine) {
      formError.value = `offline`
      return
    }
    formError.value = null
    stopped.value = null
    failure.value = null
    json.value = null
    steps.value = pendingSteps()
    state.value = `running`
    const controller = new AbortController()
    run.current = controller
    const wake = await navigator.wakeLock?.request(`screen`).catch(() => null) ?? null
    try {
      const outcome = await runBenchmark({
        runId: uuidV7(),
        group,
        device,
        measures: measuresOf(group.id, userId, group.notes),
        signal: controller.signal,
        online: () => navigator.onLine,
        onChange: (next) => steps.value = next,
        store: browserRecord,
      })
      steps.value = outcome.steps
      failure.value = outcome.failure
      durationMs.value = outcome.durationMs
      json.value = outcome.json
      state.value = outcome.state
    } finally {
      testNotes.value = null
      run.current = null
      void wake?.release().catch(() => {})
    }
  }

  const shown = testNotes.value
  const canShare = typeof navigator.share === `function`
  return (
    <BenchmarkScreen
      groups={groups}
      selectedId={selectedId}
      onSelect={(groupId) => {
        chosen.value = groupId
        formError.value = null
      }}
      state={state.value}
      steps={steps.value}
      failure={failure.value}
      durationMs={durationMs.value}
      device={device}
      json={json.value}
      stoppedRun={stopped.value}
      formError={formError.value}
      generatorCommand={`${GENERATOR} ${emailStore.status.value?.email ?? `<your e-mail>`}`}
      testArea={shown && (
        <NotesScreen
          group={{ id: ``, name: ``, canWrite: true }}
          notes={shown.notes}
          tags={shown.tags as TagRow[]}
          loading={false}
          listError={null}
        />
      )}
      onRun={() => void start()}
      onStop={() => run.current?.abort()}
      copy={(text) => copyToClipboard(text)}
      onShare={canShare && json.value !== null
        ? () => void navigator.share({ text: json.value ?? `` }).catch(() => {})
        : undefined}
      onDismissStopped={() => {
        browserRecord.remove()
        stopped.value = null
      }}
    />
  )
}
