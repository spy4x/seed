import type { JSX, RefObject } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { Field } from "@spy4x/preact-ui/field"
import { FileInput } from "@spy4x/preact-ui/file-input"
import { Input } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { Notice } from "@spy4x/preact-ui/notice"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import type { PlanRefusal } from "@domain/billing"
import type { GroupFilePart, GroupImportProblem, GroupImportSummary } from "@domain/groups"
import { type Navigate, SCREEN_PATHS, ScreenForm } from "./progressive.tsx"
import { FORM_WIDTH } from "./tag-editor-screen.tsx"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { useAppText } from "./i18n.ts"

/** Where the import page stands: nothing chosen, a file being checked, checked, or refused. */
export type GroupImportState =
  | { step: "choose" }
  | { step: "checking" }
  | { step: "checked"; summary: GroupImportSummary }
  | { step: "refused"; problems: readonly GroupImportProblem[]; total: number }
  /** The file does not fit the plan a new group starts on. */
  | { step: "plan"; refusal: PlanRefusal; notes: number }
  /** The check did not answer: the network, or the server. The same file can be checked again. */
  | { step: "unchecked" }

export interface GroupImportScreenProps {
  state: GroupImportState
  /** The new group's name, prefilled from the file. */
  name: string
  onNameChange?: (name: string) => void
  /** Why the name was refused, or `null`. */
  nameError?: string | null
  /** The import is being written. */
  importing?: boolean
  /** The import stopped: nothing was saved, and the same file can be imported again. */
  importFailed?: boolean
  /** The device has no network: the file cannot be checked or imported. */
  offline?: boolean
  /** The largest file the server takes, in bytes. */
  maxBytes: number
  /**
   * Changes each time the page starts over, so the file picker forgets the file it showed. The app
   * counts its attempts.
   */
  attempt?: number
  /** A file was chosen; `null` when the person removed it. */
  onFile?: (file: File | null) => void
  /** Checks the same file again, after a check that did not answer. */
  onRetryCheck?: () => void
  onChooseAnother?: () => void
  onImport?: () => void
  navigate?: Navigate
}

const FILE_INPUT_ID = "group-import-file"

/** `124 notes`, `1 tag`: a kind this app names in the person's language, else the file's own words. */
function counted(t: Translator<string>, part: GroupFilePart): string {
  if (part.kind === `notes`) return t.t(`GroupImport.notes`, { count: part.count })
  if (part.kind === `tags`) return t.t(`GroupImport.tags`, { count: part.count })
  return `${part.count} ${part.count === 1 ? part.one : part.other}`
}

/**
 * `124 notes, 9 tags, settings` and `124 notes and 9 tags`: the parts of a file as a sentence says
 * them, in the person's language. A `list` ends with "and"; a `unit` list, a run of amounts, does
 * not. `settings` adds the group's settings as the last part.
 */
export function fileContents(
  t: Translator<string>,
  parts: readonly GroupFilePart[],
  type: "list" | "unit",
  settings = false,
): string {
  const words = parts.map((part) => counted(t, part))
  if (settings) words.push(t.t(`GroupImport.settings`))
  const format = new Intl.ListFormat(t.language, {
    style: `long`,
    type: type === `list` ? `conjunction` : `unit`,
  })
  return format.format(words)
}

/**
 * One reason a file was refused, as a sentence. A part of the file that is wrong is named in the
 * server's words, as its other error messages are.
 */
export function problemText(t: Translator<string>, problem: GroupImportProblem): string {
  switch (problem.kind) {
    case "newer_version":
      return t.t(`GroupImport.newerVersion`)
    case "not_export":
      return t.t(`GroupImport.notExport`)
    case "too_large":
      return t.t(`GroupImport.tooLarge`, { size: megabytes(problem.maxBytes) })
    case "invalid":
      return `${problem.where}: ${problem.problem}.`
  }
}

/** Whole megabytes as the hint says them: 5 MiB is "5". */
function megabytes(bytes: number): string {
  return String(Math.round(bytes / (1024 * 1024)))
}

/** What the polite live region says for each step: one sentence, the step's heading. */
function statusOf(t: Translator<string>, state: GroupImportState): string {
  switch (state.step) {
    case "choose":
      return ""
    case "checking":
      return t.t(`GroupImport.checking`)
    case "checked":
      return t.t(`GroupImport.contains`, {
        contents: fileContents(t, state.summary.parts, `unit`, true),
      })
    case "refused":
    case "plan":
      return t.t(`GroupImport.refused`)
    case "unchecked":
      return t.t(`GroupImport.unchecked`)
  }
}

/**
 * `/groups/import`: makes a new group from an export file. The person picks a file, the app has
 * the server check it, the page shows what it holds and the new group's name, and "Import group"
 * creates it. A file the server refuses shows why, with "Choose another file". Each step moves
 * focus to its heading and says it in a polite live region, so a screen reader hears the page
 * change without hunting for it. Existing groups are never touched.
 */
export function GroupImportScreen(props: GroupImportScreenProps): JSX.Element {
  const { state, navigate, offline = false, importing = false, maxBytes } = props
  const t = useAppText()
  const heading = useRef<HTMLHeadingElement>(null)
  const picker = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (state.step !== "choose") heading.current?.focus()
  }, [state.step])
  // "Choose another file" starts a new attempt: focus goes to the new, empty picker.
  const first = useRef(props.attempt ?? 0)
  useEffect(() => {
    if ((props.attempt ?? 0) === first.current) return
    picker.current?.querySelector<HTMLInputElement>("input[type=file]")?.focus()
  }, [props.attempt])
  const status = statusOf(t, state)
  return (
    <Stack gap="xl">
      <PageHeader
        title={t.t(`GroupImport.title`)}
        titleDataE2E="group-import-title"
        back={{ href: SCREEN_PATHS.groups, label: t.t(`GroupImport.back`) }}
        navigate={navigate}
      />
      <Stack class={FORM_WIDTH}>
        <p class="text-muted">
          {t.t(`GroupImport.intro`)}
        </p>
        {offline && (
          <div data-e2e="group-import-offline">
            <Notice title={t.t(`GroupImport.offlineTitle`)}>{t.t(`GroupImport.offline`)}</Notice>
          </div>
        )}
        <div ref={picker}>
          <FileInput
            // A new attempt is a new picker, so the file the last one showed goes with it.
            key={props.attempt ?? 0}
            id={FILE_INPUT_ID}
            name="file"
            accept=".json,application/json"
            // No size limit here: the app checks the size, so the refusal is said once, in the
            // notice below.
            label={t.t(`GroupImport.file`)}
            hint={t.t(`GroupImport.fileHint`, { size: megabytes(maxBytes) })}
            disabled={importing}
            previews={false}
            labels={{
              browse: t.t(`GroupImport.browse`),
              wrongType: () => t.t(`GroupImport.notExport`),
            }}
            onFiles={(files) => props.onFile?.(files[0] ?? null)}
          />
        </div>
        <p role="status" aria-live="polite" class="sr-only" data-e2e="group-import-status">
          {status}
        </p>
        {state.step !== "choose" && (
          <Step {...props} heading={heading} status={status} offline={offline} />
        )}
      </Stack>
    </Stack>
  )
}

/** What the page shows under the picker for one step, its heading first. */
function Step(
  props: GroupImportScreenProps & {
    heading: RefObject<HTMLHeadingElement>
    status: string
    offline: boolean
  },
): JSX.Element | null {
  const { state, heading, status, offline, importing = false } = props
  const t = useAppText()
  // The heading is the step's title and where focus goes; the live region above has said it, so
  // the notices under it are no live regions of their own.
  const title = (
    <h2
      ref={heading}
      tabIndex={-1}
      class="text-base font-semibold text-foreground outline-none"
      data-e2e="group-import-heading"
    >
      {status}
    </h2>
  )
  const chooseAnother = (
    <div>
      <Button
        type="button"
        variant="secondary"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        data-e2e="group-import-choose-another"
        onClick={props.onChooseAnother}
      >
        {t.t(`GroupImport.chooseAnother`)}
      </Button>
    </div>
  )
  switch (state.step) {
    case "checking":
      return <div data-e2e="group-import-checking">{title}</div>
    case "unchecked":
      return (
        <Stack data-e2e="group-import-unchecked">
          {title}
          <Notice
            tone="danger"
            live={false}
            action={
              <Button
                size="sm"
                variant="secondary"
                disabled={offline}
                data-e2e="group-import-retry"
                onClick={props.onRetryCheck}
              >
                {t.t(`GroupImport.retry`)}
              </Button>
            }
          >
            {t.t(`GroupImport.uncheckedHint`)}
          </Notice>
        </Stack>
      )
    case "refused": {
      const shown = state.problems.slice(0, 5)
      const more = state.total - shown.length
      return (
        <Stack data-e2e="group-import-refused">
          {title}
          <Notice tone="danger" live={false}>
            {
              // One reason reads as a sentence; a list of one draws a lone bullet.
              shown.length === 1 && more <= 0
                ? <p data-e2e="group-import-problem">{problemText(t, shown[0])}</p>
                : (
                  <ul class="list-disc space-y-1 pl-4">
                    {shown.map((problem, index) => (
                      <li key={index} data-e2e="group-import-problem">
                        {problemText(t, problem)}
                      </li>
                    ))}
                    {more > 0 && (
                      <li data-e2e="group-import-more">
                        {t.t(`GroupImport.more`, { count: more })}
                      </li>
                    )}
                  </ul>
                )
            }
          </Notice>
          {chooseAnother}
        </Stack>
      )
    }
    case "plan":
      return (
        <Stack>
          {title}
          <div data-e2e="plan-refusal" data-entitlement={state.refusal.entitlement}>
            <Notice tone="warning" live={false} title={t.t(`GroupImport.planTitle`)}>
              {t.t(`GroupImport.plan`, { count: state.refusal.limit ?? 0, notes: state.notes })}
            </Notice>
          </div>
          {chooseAnother}
        </Stack>
      )
    case "checked":
      return (
        <ScreenForm pending={importing} onSubmit={() => props.onImport?.()}>
          <Stack>
            <div data-e2e="group-import-checked">{title}</div>
            {
              // Offline, the offline notice says why; "Try again" would only fail again.
              props.importFailed && !offline && (
                <div data-e2e="group-import-failed">
                  <Notice tone="danger" urgent>
                    {t.t(`GroupImport.failed`)}
                  </Notice>
                </div>
              )
            }
            <Field
              id="group-import-name"
              label={t.t(`GroupImport.name`)}
              error={props.nameError}
              required
            >
              <Input
                name="name"
                data-e2e="group-import-name"
                autocomplete="off"
                maxLength={100}
                value={props.name}
                onInput={(event) => props.onNameChange?.(event.currentTarget.value)}
                required
              />
            </Field>
            <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                type="submit"
                class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                busy={importing}
                busyLabel={t.t(`GroupImport.importing`)}
                disabled={offline}
                data-e2e="group-import-submit"
              >
                {t.t(`GroupImport.submit`)}
              </Button>
            </div>
          </Stack>
        </ScreenForm>
      )
    case "choose":
      return null
  }
}
