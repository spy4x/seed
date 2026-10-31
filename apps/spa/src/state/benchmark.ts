import {
  BENCHMARK_STEPS,
  type BenchmarkDevice,
  type BenchmarkFailReason,
  type BenchmarkStep,
  type BenchmarkStepId,
  type BenchmarkStoppedRun,
  withinBudget,
} from "@ui/benchmark-screen.tsx"
import { isProxyAnswer, isRefusal, isUnreachable } from "@spy4x/realtime/read-cache"

/**
 * The benchmark's run (#440), apart from the browser: the steps in order, what a failure or a stop
 * leaves, the record a crash leaves behind, and the results line. `BenchmarkView` passes the real
 * measures; a test passes its own.
 *
 * @module
 */

/** What one measure gave: its raw value, or that the browser does not report it. */
export type Measured = { value?: number; quota?: number; kept?: boolean } | "unavailable"

/** What a measure may use while it runs. */
export interface MeasureContext {
  /** Aborts when the person presses Stop. */
  signal: AbortSignal
  /** Reports the download's progress in notes. */
  progress(done: number, total: number): void
}

/** Every measure of a run, by step. */
export type Measures = Record<BenchmarkStepId, (context: MeasureContext) => Promise<Measured>>

/** A failure whose reason the measure knows, such as a tab that left the screen. */
export class StepFailure extends Error {
  constructor(readonly reason: BenchmarkFailReason, message: string) {
    super(message)
    this.name = "StepFailure"
  }
}

/** The steps the rest need: when one fails, the run ends there. */
const NEEDED: ReadonlySet<BenchmarkStepId> = new Set(["download", "save", "startOffline"])

/** The plain-words reason of a step's failure. */
export function failReason(error: unknown, online: boolean): BenchmarkFailReason {
  if (error instanceof StepFailure) return error.reason
  if (!online) return "offline"
  if ((error as { name?: string } | null)?.name === "QuotaExceededError") return "storage"
  if (isUnreachable(error) || isProxyAnswer(error) || isRefusal(error)) return "server"
  return "browser"
}

/** The group a run measures, as the results line names it. */
export interface BenchmarkTarget {
  id: string
  name: string
  notes: number | null
}

/**
 * What the page keeps on this device while a run goes on, written before each step: a tab that
 * runs out of memory leaves it behind, and the next load shows where it stopped.
 */
export interface BenchmarkRecord {
  v: 1
  runId: string
  group: BenchmarkTarget
  startedAt: string
  /** The step that was about to run, or `null` once the run ended. */
  step: BenchmarkStepId | null
  steps: BenchmarkStep[]
  errors: { step: BenchmarkStepId; message: string }[]
  device: BenchmarkDevice
}

/** Where the record lives; the browser's is `localStorage`, which may refuse. */
export interface RecordStore {
  read(): string | null
  write(value: string): void
  remove(): void
}

const RECORD_KEY = `benchmark:run`

/** The record in `localStorage`; a browser that refuses storage keeps none, silently. */
export const browserRecord: RecordStore = {
  read() {
    try {
      return localStorage.getItem(RECORD_KEY)
    } catch {
      return null
    }
  },
  write(value) {
    try {
      localStorage.setItem(RECORD_KEY, value)
    } catch {
      // A private window or a full disk: the run goes on without its crash record.
    }
  },
  remove() {
    try {
      localStorage.removeItem(RECORD_KEY)
    } catch {
      // Nothing was kept.
    }
  },
}

/** `L` of "Load test L: 100,000 notes", the generator's name for a tier's group. */
export function tierOf(name: string): string | null {
  return /^Load test (S|M|L|XL):/.exec(name)?.[1] ?? null
}

/** The unit each measure's raw value is in, as the results line names it. */
const UNITS: Partial<Record<BenchmarkStepId, string>> = {
  scroll: `droppedPercent`,
  memory: `bytes`,
  storage: `bytes`,
}

/**
 * The results as one line of JSON: English keys and raw units (milliseconds, bytes), so lines from
 * different devices and languages compare. It holds the group's name and size, the measures, the
 * device's facts and every error in full; nothing about the person.
 */
export function resultsLine(
  record: BenchmarkRecord,
  end: { durationMs?: number; stoppedAt?: BenchmarkStepId },
): string {
  const measures: Record<string, unknown> = {}
  for (const step of record.steps) {
    const entry: Record<string, unknown> = { state: step.state }
    if (step.value !== undefined) {
      entry[UNITS[step.id] ?? `ms`] = Math.round(step.value * 10) / 10
      const within = withinBudget(step.id, step.value)
      if (within !== null) entry.withinBudget = within
    }
    if (step.quota !== undefined) entry.quotaBytes = step.quota
    if (step.kept !== undefined) entry.kept = step.kept
    measures[step.id] = entry
  }
  return JSON.stringify({
    v: 1,
    runId: record.runId,
    startedAt: record.startedAt,
    ...(end.durationMs === undefined ? {} : { durationMs: Math.round(end.durationMs) }),
    ...(end.stoppedAt === undefined ? {} : { stoppedAt: end.stoppedAt }),
    group: { name: record.group.name, notes: record.group.notes, tier: tierOf(record.group.name) },
    measures,
    device: {
      userAgent: record.device.browser,
      cores: record.device.cores,
      memoryGb: record.device.memory,
      connection: record.device.connection,
    },
    errors: record.errors,
  })
}

/** Every step not started yet. */
export function pendingSteps(): BenchmarkStep[] {
  return BENCHMARK_STEPS.map((id) => ({ id, state: "pending" }))
}

/**
 * The run a closed tab left behind, or `null`: a record that is unreadable, or of a run that ended,
 * is removed.
 */
export function stoppedRun(store: RecordStore): BenchmarkStoppedRun | null {
  const text = store.read()
  if (text === null) return null
  try {
    const record = JSON.parse(text) as BenchmarkRecord
    if (record.v !== 1 || record.step === null || !BENCHMARK_STEPS.includes(record.step)) {
      throw new Error(`no unfinished run`)
    }
    return {
      step: record.step,
      group: record.group.name,
      startedAt: record.startedAt,
      json: resultsLine(record, { stoppedAt: record.step }),
    }
  } catch {
    store.remove()
    return null
  }
}

/** How a run ended. */
export interface BenchmarkOutcome {
  state: "done" | "stopped" | "failed"
  steps: BenchmarkStep[]
  failure: { step: BenchmarkStepId; reason: BenchmarkFailReason } | null
  durationMs: number
  json: string
}

/** What {@link runBenchmark} takes. */
export interface RunOptions {
  runId: string
  group: BenchmarkTarget
  device: BenchmarkDevice
  measures: Measures
  signal: AbortSignal
  online(): boolean
  /** Called with the steps after every change. */
  onChange(steps: readonly BenchmarkStep[]): void
  store: RecordStore
  now?: () => number
  startedAt?: Date
}

/**
 * Runs every measure in order. Before each one the record is written, so a tab that dies mid-step
 * leaves it. A stop marks the running step stopped and leaves the rest not measured. A failed step
 * keeps the others' results; when the download, the save or the offline start fails, the steps
 * after it have nothing to measure and stay not measured.
 */
export async function runBenchmark(options: RunOptions): Promise<BenchmarkOutcome> {
  const now = options.now ?? (() => performance.now())
  const started = now()
  const record: BenchmarkRecord = {
    v: 1,
    runId: options.runId,
    group: options.group,
    startedAt: (options.startedAt ?? new Date()).toISOString(),
    step: null,
    steps: pendingSteps(),
    errors: [],
    device: options.device,
  }
  const set = (index: number, step: BenchmarkStep) => {
    record.steps = record.steps.map((old, at) => at === index ? step : old)
    options.onChange(record.steps)
  }
  let failure: BenchmarkOutcome["failure"] = null
  let ended: BenchmarkOutcome["state"] = "done"
  for (const [index, id] of BENCHMARK_STEPS.entries()) {
    if (options.signal.aborted) {
      ended = "stopped"
      break
    }
    record.step = id
    options.store.write(JSON.stringify(record))
    set(index, { id, state: "running" })
    try {
      const measured = await options.measures[id]({
        signal: options.signal,
        progress: (done, total) => set(index, { id, state: "running", progress: { done, total } }),
      })
      if (options.signal.aborted) throw options.signal.reason
      set(
        index,
        measured === "unavailable"
          ? { id, state: "unavailable" }
          : { id, state: "done", ...measured },
      )
    } catch (error) {
      if (options.signal.aborted) {
        set(index, { id, state: "stopped" })
        ended = "stopped"
        break
      }
      const reason = failReason(error, options.online())
      record.errors.push({ step: id, message: String((error as Error)?.stack ?? error) })
      set(index, { id, state: "failed" })
      failure ??= { step: id, reason }
      ended = "failed"
      if (NEEDED.has(id)) break
    }
  }
  const durationMs = now() - started
  record.step = null
  options.store.remove()
  const stoppedAt = record.steps.find((step) => step.state === "stopped")?.id
  return {
    state: ended,
    steps: record.steps,
    failure,
    durationMs,
    json: resultsLine(record, { durationMs, stoppedAt }),
  }
}
