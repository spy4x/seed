import type { ComponentChildren, JSX } from "preact"
import { useEffect, useId, useRef, useState } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { CopyButton } from "@spy4x/preact-ui/copy-button"
import { FactList } from "@spy4x/preact-ui/fact-list"
import { Field } from "@spy4x/preact-ui/field"
import { useFormat } from "@spy4x/preact-ui/format"
import { Select, Textarea } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { Notice } from "@spy4x/preact-ui/notice"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import { Progress } from "@spy4x/preact-ui/progress"
import { type RunStep, RunSteps, type RunStepState } from "@spy4x/preact-ui/run-steps"
import type { Formatters } from "@spy4x/time/format"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { useAppText } from "./i18n.ts"
import { ScreenForm } from "./progressive.tsx"

/**
 * The benchmark page (#440): measures one large group on the device the page runs on. Pure: the
 * SPA's `BenchmarkView` runs the measurement and passes each step's state in.
 *
 * @module
 */

/** The measures, in the order a run takes them. */
export const BENCHMARK_STEPS = [
  "download",
  "save",
  "startOffline",
  "firstNotes",
  "scroll",
  "search",
  "filter",
  "memory",
  "storage",
  "clear",
] as const

/** One measure of a run. */
export type BenchmarkStepId = typeof BENCHMARK_STEPS[number]

/**
 * The budget of each measure that has one: milliseconds, except `scroll`, a percentage of frames
 * dropped. A value under its budget is within it.
 */
export const BENCHMARK_BUDGETS: Partial<Record<BenchmarkStepId, number>> = {
  download: 10_000,
  startOffline: 1_000,
  firstNotes: 1_000,
  scroll: 5,
  search: 100,
  filter: 100,
}

/** Whether `value` is within the budget of `step`; `null` for a measure with no budget. */
export function withinBudget(step: BenchmarkStepId, value: number): boolean | null {
  const budget = BENCHMARK_BUDGETS[step]
  return budget === undefined ? null : value < budget
}

/** Why a step failed, which the screen says in plain words. The raw error goes in the JSON. */
export type BenchmarkFailReason = "offline" | "storage" | "server" | "browser" | "hidden"

/** Where one measure stands, with its raw result once done. */
export interface BenchmarkStep {
  id: BenchmarkStepId
  state: RunStepState
  /** Milliseconds, a percentage for `scroll`, bytes for `memory` and `storage`. */
  value?: number
  /** The storage quota in bytes, beside `storage`'s usage. */
  quota?: number
  /** `clear` only: the copy stayed, because it is the group the app has open. */
  kept?: boolean
  /** The download's progress in notes. */
  progress?: { done: number; total: number }
}

/** Where the page stands. */
export type BenchmarkRunState = "idle" | "running" | "done" | "stopped" | "failed"

/** A group the person may measure, with its live notes when known. */
export interface BenchmarkGroup {
  id: string
  name: string
  notes: number | null
}

/** What the browser says about the device; `null` where it does not say. */
export interface BenchmarkDevice {
  browser: string
  cores: number | null
  /** Gigabytes, as `navigator.deviceMemory` rounds them. */
  memory: number | null
  /** `navigator.connection.effectiveType`, such as `4g`. */
  connection: string | null
}

/** A run the tab did not finish, found on the next load. */
export interface BenchmarkStoppedRun {
  step: BenchmarkStepId
  group: string
  /** ISO time the run started. */
  startedAt: string
  /** That run's results line. */
  json: string
}

export interface BenchmarkScreenProps {
  groups: readonly BenchmarkGroup[]
  selectedId: string | null
  onSelect?: (groupId: string) => void
  state: BenchmarkRunState
  /** One per {@link BENCHMARK_STEPS}, in that order. */
  steps: readonly BenchmarkStep[]
  /** The step that failed and why, for the banner. */
  failure?: { step: BenchmarkStepId; reason: BenchmarkFailReason } | null
  /** How long the finished run took, for the summary. */
  durationMs?: number | null
  device: BenchmarkDevice
  /** The results as one JSON line, once a run ends. */
  json?: string | null
  /** The last run, which the tab closed before it finished. */
  stoppedRun?: BenchmarkStoppedRun | null
  /** A message under the form: no group chosen, or no connection. */
  formError?: "noGroup" | "offline" | null
  /** The command that makes a large group, shown while no group has more than 1,000 notes. */
  generatorCommand: string
  /** What the page draws in its test area while it measures: the real notes list. */
  testArea?: ComponentChildren
  onRun?: () => void
  onStop?: () => void
  /** Copies text to the clipboard; `false` when the browser refused. */
  copy?: (text: string) => boolean | Promise<boolean>
  /** Shares the results line; left out where the browser cannot share. */
  onShare?: () => void
  onDismissStopped?: () => void
}

/** A group with more notes than this is large enough to measure. */
export const LARGE_GROUP = 1_000

/** Where each measure's words live. */
const STEP_LABELS: Record<BenchmarkStepId, string> = {
  download: `Benchmark.stepDownload`,
  save: `Benchmark.stepSave`,
  startOffline: `Benchmark.stepStartOffline`,
  firstNotes: `Benchmark.stepFirstNotes`,
  scroll: `Benchmark.stepScroll`,
  search: `Benchmark.stepSearch`,
  filter: `Benchmark.stepFilter`,
  memory: `Benchmark.stepMemory`,
  storage: `Benchmark.stepStorage`,
  clear: `Benchmark.stepClear`,
}

const HINTS: Record<BenchmarkStepId, string> = {
  download: `Benchmark.budgetDownload`,
  save: `Benchmark.noBudget`,
  startOffline: `Benchmark.budgetSecond`,
  firstNotes: `Benchmark.budgetSecond`,
  scroll: `Benchmark.budgetScroll`,
  search: `Benchmark.budgetFast`,
  filter: `Benchmark.budgetFast`,
  memory: `Benchmark.noBudget`,
  storage: `Benchmark.noBudget`,
  clear: `Benchmark.noBudget`,
}

const FAILURES: Record<BenchmarkFailReason, string> = {
  offline: `Benchmark.failOffline`,
  storage: `Benchmark.failStorage`,
  server: `Benchmark.failServer`,
  browser: `Benchmark.failBrowser`,
  hidden: `Benchmark.failHidden`,
}

/** The name of one measure, in the person's language. */
export function stepLabel(t: Translator<string>, step: BenchmarkStepId): string {
  return t.t(STEP_LABELS[step])
}

/** `1.2 s` from a second up, `85 ms` under it, and `0.4 ms` under ten. */
function duration(t: Translator<string>, format: Formatters, ms: number): string {
  return ms >= 1_000
    ? t.t(`Benchmark.seconds`, { value: format.number(ms / 1_000, { maximumFractionDigits: 1 }) })
    : t.t(`Benchmark.milliseconds`, {
      value: format.number(ms, { maximumFractionDigits: ms < 10 ? 1 : 0 }),
    })
}

/** `48 MB`, in the region's own unit words. */
function size(format: Formatters, bytes: number): string {
  const megabytes = bytes / 1_000_000
  return megabytes >= 1_000
    ? format.number(megabytes / 1_000, {
      style: "unit",
      unit: "gigabyte",
      maximumFractionDigits: 1,
    })
    : format.number(megabytes, { style: "unit", unit: "megabyte", maximumFractionDigits: 0 })
}

/** A done step's result as the row shows it. */
function shownValue(
  t: Translator<string>,
  format: Formatters,
  step: BenchmarkStep,
): string | undefined {
  if (step.id === "clear") return t.t(step.kept ? `Benchmark.kept` : `Benchmark.cleared`)
  if (step.value === undefined) return undefined
  if (step.id === "scroll") {
    return t.t(`Benchmark.framesDropped`, {
      percent: format.number(step.value, { maximumFractionDigits: 1 }),
    })
  }
  if (step.id === "memory") return size(format, step.value)
  if (step.id === "storage") {
    return step.quota === undefined ? size(format, step.value) : t.t(`Benchmark.storageOf`, {
      size: size(format, step.value),
      quota: size(format, step.quota),
    })
  }
  return duration(t, format, step.value)
}

/** The rows of the Measurements list. */
function runSteps(
  t: Translator<string>,
  format: Formatters,
  steps: readonly BenchmarkStep[],
): RunStep[] {
  return steps.map((step) => {
    const within = step.value === undefined ? null : withinBudget(step.id, step.value)
    return {
      id: step.id,
      label: stepLabel(t, step.id),
      state: step.state,
      hint: t.t(HINTS[step.id]),
      value: shownValue(t, format, step),
      verdict: within === null
        ? undefined
        : within
        ? { label: t.t(`Benchmark.within`), tone: "success" as const }
        : { label: t.t(`Benchmark.over`), tone: "danger" as const },
      progress: step.progress && step.progress.total > 0
        ? {
          value: step.progress.done,
          max: step.progress.total,
          label: t.t(`Benchmark.notesProgress`, {
            done: format.number(step.progress.done),
            total: format.number(step.progress.total),
          }),
        }
        : undefined,
      detail: step.state === "unavailable" ? t.t(`Benchmark.unavailableDetail`) : undefined,
    }
  })
}

/** The line that sums a finished run up. */
function summaryOf(
  t: Translator<string>,
  format: Formatters,
  state: BenchmarkRunState,
  steps: readonly BenchmarkStep[],
  durationMs: number | null,
): string {
  const done = steps.filter((step) => step.state === "done" || step.state === "unavailable")
  if (state !== "done") {
    return t.t(`Benchmark.partialSummary`, { count: done.length, total: steps.length })
  }
  const budgeted = steps.filter((step) => BENCHMARK_BUDGETS[step.id] !== undefined)
  const within = budgeted.filter((step) =>
    step.state === "done" && step.value !== undefined && withinBudget(step.id, step.value)
  )
  return t.t(`Benchmark.doneSummary`, {
    duration: duration(t, format, durationMs ?? 0),
    count: within.length,
    total: budgeted.length,
  })
}

/** The button classes of the page: 44 px tall on a phone, the usual height from `sm`. */
const TOUCH = "min-h-11 w-full sm:min-h-9 sm:w-auto"

/**
 * `/benchmark`: pick a group, run, watch each measure fill in, then copy the results as one line.
 *
 * The list of measures keeps every row from start to end, so nothing shifts while a run goes on.
 * Running, Stop is the only button and takes focus; done, focus moves to the summary. One polite
 * live region says which step runs, and the summary at the end; progress ticks are not announced.
 * A Run the app refuses moves focus to what it says: the group field, or the offline warning.
 */
export function BenchmarkScreen(props: BenchmarkScreenProps): JSX.Element {
  const { state, steps, groups, selectedId, json = null, stoppedRun = null } = props
  const t = useAppText()
  const format = useFormat()
  const measuresId = useId()
  const progressId = useId()
  const stopButton = useRef<HTMLButtonElement>(null)
  const summary = useRef<HTMLParagraphElement>(null)
  const stoppedNotice = useRef<HTMLDivElement>(null)
  const results = useRef<HTMLTextAreaElement>(null)
  const groupSelect = useRef<HTMLSelectElement>(null)
  const offlineWarning = useRef<HTMLDivElement>(null)
  const runButton = useRef<HTMLButtonElement>(null)
  const runAgainButton = useRef<HTMLButtonElement>(null)
  const hadStoppedRun = useRef(false)
  // Counts presses of Run, so a second refused press moves focus again with the same error.
  const [presses, setPresses] = useState(0)
  const running = state === "running"
  const ended = state === "done" || state === "stopped" || state === "failed"

  useEffect(() => {
    if (running) stopButton.current?.focus()
    else if (ended) summary.current?.focus()
  }, [state])
  useEffect(() => {
    // Dismissed, the warning takes its focused button with it: Run is the next thing to do.
    if (stoppedRun) stoppedNotice.current?.focus()
    else if (hadStoppedRun.current) (runButton.current ?? runAgainButton.current)?.focus()
    hadStoppedRun.current = stoppedRun !== null
  }, [stoppedRun !== null])
  useEffect(() => {
    if (props.formError === "offline") offlineWarning.current?.focus()
    else if (props.formError === "noGroup") groupSelect.current?.focus()
  }, [props.formError, presses])

  const run = () => {
    setPresses((count) => count + 1)
    props.onRun?.()
  }

  const current = steps.findIndex((step) => step.state === "running")
  const currentLabel = current >= 0 ? stepLabel(t, steps[current].id) : null
  const stopped = steps.find((step) => step.state === "stopped")
  const summaryText = ended ? summaryOf(t, format, state, steps, props.durationMs ?? null) : null
  const stepText = currentLabel === null ? "" : t.t(`Benchmark.stepOf`, {
    n: current + 1,
    total: steps.length,
    measure: currentLabel,
  })
  const largest = Math.max(0, ...groups.map((group) => group.notes ?? 0))
  const counted = groups.length > 0 && groups.every((group) => group.notes !== null)
  const options = [...groups]
    .sort((a, b) => (b.notes ?? -1) - (a.notes ?? -1))
    .map((group) => ({
      value: group.id,
      label: group.notes === null
        ? group.name
        : `${group.name} · ${t.t(`GroupImport.notes`, { count: group.notes })}`,
    }))

  /** Copies the line; where the browser refuses, selects it so the person can copy it by hand. */
  const copyResults = async (text: string) => {
    const copied = await (props.copy?.(text) ?? false)
    if (!copied) results.current?.select()
    return copied
  }

  // Shown under the form before a run and above "Run again" after one: Run checks the
  // connection first, so either button can be the one that finds it gone.
  const offlineNotice = props.formError === "offline" && (
    <div ref={offlineWarning} tabIndex={-1} class="outline-none" data-e2e="benchmark-offline">
      <Notice tone="warning" live={false}>{t.t(`Benchmark.offline`)}</Notice>
    </div>
  )
  const copyAction = json !== null && (
    <CopyButton
      textToCopy={json}
      title={t.t(`Benchmark.copy`)}
      copyLabel={t.t(`Benchmark.copy`)}
      copiedLabel={t.t(`Benchmark.resultsCopied`)}
      failedLabel={t.t(`Benchmark.copyFailed`)}
      copy={copyResults}
      class={TOUCH}
      data-e2e="benchmark-copy"
    />
  )

  return (
    <Stack gap="xl">
      <PageHeader
        title={t.t(`Benchmark.title`)}
        subtitle={t.t(`Benchmark.subtitle`)}
        action={running && (
          <Button
            ref={stopButton}
            variant="secondary"
            class={TOUCH}
            onClick={props.onStop}
            data-e2e="benchmark-stop"
          >
            {t.t(`Benchmark.stop`)}
          </Button>
        )}
      />
      <p role="status" aria-live="polite" class="sr-only" data-e2e="benchmark-status">
        {summaryText ?? stepText}
      </p>

      {stoppedRun && (
        <div
          ref={stoppedNotice}
          tabIndex={-1}
          class="outline-none"
          data-e2e="benchmark-last-stopped"
        >
          <Notice
            tone="warning"
            live={false}
            title={t.t(`Benchmark.lastStoppedTitle`, { measure: stepLabel(t, stoppedRun.step) })}
          >
            <p>
              {t.t(`Benchmark.lastStoppedBody`, {
                group: stoppedRun.group,
                time: format.dateTime(stoppedRun.startedAt),
              })}
            </p>
            {/* Under the text, not in Notice's action slot: that never wraps on a phone. */}
            <div class="mt-3 flex flex-col gap-2 sm:flex-row">
              <CopyButton
                textToCopy={stoppedRun.json}
                title={t.t(`Benchmark.copyThatRun`)}
                copyLabel={t.t(`Benchmark.copyThatRun`)}
                copiedLabel={t.t(`Benchmark.resultsCopied`)}
                failedLabel={t.t(`Benchmark.copyFailed`)}
                copy={props.copy}
                class={TOUCH}
                data-e2e="benchmark-copy-stopped"
              />
              <Button
                variant="ghost"
                class={TOUCH}
                onClick={props.onDismissStopped}
                data-e2e="benchmark-dismiss-stopped"
              >
                {t.t(`Benchmark.dismiss`)}
              </Button>
            </div>
          </Notice>
        </div>
      )}

      {!running && counted && largest <= LARGE_GROUP && (
        <div data-e2e="benchmark-no-large-group">
          <Notice title={t.t(`Benchmark.noLargeTitle`)} live={false}>
            <Stack gap="sm">
              <p>{t.t(`Benchmark.noLargeBody`)}</p>
              <code class="block rounded-md bg-surface-muted px-3 py-2 font-mono text-sm break-all">
                {props.generatorCommand}
              </code>
              <div>
                <CopyButton
                  textToCopy={props.generatorCommand}
                  title={t.t(`Benchmark.copyCommand`)}
                  copyLabel={t.t(`Benchmark.copyCommand`)}
                  copiedLabel={t.t(`Benchmark.commandCopied`)}
                  failedLabel={t.t(`Benchmark.copyFailed`)}
                  copy={props.copy}
                  class={TOUCH}
                  data-e2e="benchmark-copy-command"
                />
              </div>
              <p class="text-sm text-muted">{t.t(`Benchmark.noLargeFoot`)}</p>
            </Stack>
          </Notice>
        </div>
      )}

      {running
        ? (
          <Stack gap="sm" data-e2e="benchmark-running">
            <Progress
              id={progressId}
              label={stepText}
              value={Math.max(0, current)}
              max={steps.length}
              showValue={false}
            />
          </Stack>
        )
        : ended
        ? (
          <Stack data-e2e="benchmark-ended">
            <p
              ref={summary}
              tabIndex={-1}
              class="text-lg font-medium text-foreground outline-none"
              data-e2e="benchmark-summary"
            >
              {summaryText}
            </p>
            {state === "stopped" && stopped && (
              <p class="text-sm text-muted">
                {t.t(`Benchmark.stoppedAt`, { measure: stepLabel(t, stopped.id) })}
              </p>
            )}
            {props.failure && (
              <div data-e2e="benchmark-failure" data-reason={props.failure.reason}>
                <Notice
                  tone="danger"
                  live={false}
                  title={t.t(`Benchmark.failed`, { measure: stepLabel(t, props.failure.step) })}
                >
                  <p>{t.t(FAILURES[props.failure.reason])}</p>
                  <p>{t.t(`Benchmark.othersKept`)}</p>
                </Notice>
              </div>
            )}
            {offlineNotice}
            <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {copyAction}
              {props.onShare && (
                <Button
                  variant="ghost"
                  class={TOUCH}
                  onClick={props.onShare}
                  data-e2e="benchmark-share"
                >
                  {t.t(`Benchmark.share`)}
                </Button>
              )}
              <Button
                ref={runAgainButton}
                variant="secondary"
                class={TOUCH}
                onClick={run}
                data-e2e="benchmark-run-again"
              >
                {t.t(`Benchmark.runAgain`)}
              </Button>
            </div>
            {json !== null && (
              <Field id="benchmark-json" label={t.t(`Benchmark.jsonLabel`)}>
                <Textarea
                  ref={results}
                  rows={3}
                  readOnly
                  value={json}
                  class="font-mono text-sm break-all"
                  onFocus={(event) => event.currentTarget.select()}
                  data-e2e="benchmark-json"
                />
              </Field>
            )}
          </Stack>
        )
        : (
          <ScreenForm onSubmit={run}>
            <Stack>
              <Field
                id="benchmark-group"
                label={t.t(`Benchmark.groupLabel`)}
                hint={t.t(`Benchmark.groupHint`)}
                error={props.formError === "noGroup" ? t.t(`Benchmark.chooseGroup`) : null}
              >
                <Select
                  ref={groupSelect}
                  name="group"
                  options={options}
                  placeholder={t.t(`Benchmark.groupPlaceholder`)}
                  value={selectedId ?? ""}
                  onChange={(event) => props.onSelect?.(event.currentTarget.value)}
                  data-e2e="benchmark-group"
                />
              </Field>
              {offlineNotice}
              <div>
                <Button ref={runButton} type="submit" class={TOUCH} data-e2e="benchmark-run">
                  {t.t(`Benchmark.run`)}
                </Button>
              </div>
              <p class="text-sm text-muted">{t.t(`Benchmark.keepInFront`)}</p>
            </Stack>
          </ScreenForm>
        )}

      {running && (
        // The real notes list is drawn here for the paint and scroll measures. Its space is kept
        // for the whole run, so nothing below moves; nothing in it can be reached or pressed.
        <Card class="h-80 overflow-y-auto" data-e2e="benchmark-test-area" inert>
          {props.testArea}
        </Card>
      )}

      <section class="flex flex-col gap-2" aria-labelledby={measuresId}>
        <h2 id={measuresId} class="text-lg font-semibold text-foreground">
          {t.t(`Benchmark.measurements`)}
        </h2>
        <div data-e2e="benchmark-steps">
          <RunSteps
            steps={runSteps(t, format, steps)}
            labels={{ pending: t.t(`Benchmark.notMeasured`) }}
            aria-labelledby={measuresId}
          />
        </div>
      </section>

      <section class="flex flex-col gap-2" aria-labelledby={`${measuresId}-device`}>
        <h2 id={`${measuresId}-device`} class="text-lg font-semibold text-foreground">
          {t.t(`Benchmark.deviceHeading`)}
        </h2>
        <FactList facts={deviceFacts(t, format, props.device)} />
      </section>
    </Stack>
  )
}

/** The "This device" rows; what the browser does not report says so. */
function deviceFacts(t: Translator<string>, format: Formatters, device: BenchmarkDevice) {
  const unknown = t.t(`Benchmark.notReported`)
  return [
    { id: "browser", label: t.t(`Benchmark.browser`), value: device.browser || unknown },
    {
      id: "cores",
      label: t.t(`Benchmark.cores`),
      value: device.cores === null ? unknown : format.number(device.cores),
    },
    {
      id: "memory",
      label: t.t(`Benchmark.memory`),
      value: device.memory === null
        ? unknown
        : format.number(device.memory, { style: "unit", unit: "gigabyte" }),
    },
    { id: "connection", label: t.t(`Benchmark.connection`), value: device.connection ?? unknown },
  ]
}
