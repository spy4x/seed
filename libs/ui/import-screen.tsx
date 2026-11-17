/**
 * The pages that bring a file's rows into the current group (`docs/imports.md`): the picker at
 * `/imports/new?kind=` with the person's recent imports, and one import at `/imports/:id` as it
 * stands. Neither names a kind of record: the kind's words and limits come in as an
 * {@link ImportKindView}, so a product's own kind takes the same pages.
 *
 * @module
 */
import type { JSX, RefObject } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { Checkbox } from "@spy4x/preact-ui/checkbox"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { FileInput } from "@spy4x/preact-ui/file-input"
import { useFormat, When } from "@spy4x/preact-ui/format"
import { type ColumnMap, ImportMapper, type ImportPreviewRow } from "@spy4x/preact-ui/import-mapper"
import { Stack } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { Notice } from "@spy4x/preact-ui/notice"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import { SegmentedControl } from "@spy4x/preact-ui/segmented-control"
import { Table } from "@spy4x/preact-ui/table"
import type { Translator } from "@spy4x/platform/universal/i18n"
import {
  type ImportCheckResult,
  type ImportChoices,
  type ImportField,
  type ImportRowReview,
  ImportStatus,
  type ImportSummary,
} from "@domain/imports"
import { useAppText } from "./i18n.ts"
import type { ImportKindView, ImportKindWords, ImportOptions } from "./import-kinds.ts"
import { IMPORT_PATHS, type Navigate, ScreenForm } from "./progressive.tsx"

/** The mapper's root id: a field's select is `import-mapper-<key>`, which the main button focuses. */
export const IMPORT_MAPPER_ID = "import-mapper"

/** The classes of a button alone on its line: full width and 44 px tall on a phone. */
const WIDE = "min-h-11 w-full sm:min-h-9 sm:w-auto"

/** What both pages need to say who may import and whether the network is there. */
interface ImportPageProps {
  kind: ImportKindView
  /** The current group's name, for the viewer's notice. */
  groupName: string
  /** The person may not create the kind's records in this group: a viewer. */
  forbidden?: boolean
  /** The device has no network: nothing can be uploaded, checked or saved. */
  offline?: boolean
  navigate?: Navigate
}

export interface ImportNewScreenProps extends ImportPageProps {
  /** The name of the file being uploaded, or `null`. */
  uploading?: string | null
  /** Why the server refused the last file, in words; `null` when nothing was refused. */
  error?: string | null
  /** The person's imports of this kind in the group, newest first; `null` while they load. */
  recent: readonly ImportSummary[] | null
  /**
   * A file was chosen and passed the kind's type and size; the app uploads it, with `options` for
   * a kind that has them.
   */
  onFile?: (file: File, options?: ImportOptions) => void
  /** The kind's upload options as the person set them; `null` or absent for its `initial`. */
  options?: ImportOptions | null
  onOptions?: (value: ImportOptions) => void
}

/** The controls a person can move focus to: where a file chosen too early sends it. */
const FOCUSABLE = [
  `input:not([type="hidden"]):not(:disabled)`,
  `select:not(:disabled)`,
  `textarea:not(:disabled)`,
  `button:not(:disabled)`,
  `[tabindex]:not([tabindex="-1"])`,
].join(`, `)

/**
 * `/imports/new?kind=`: one file picker that uploads the file it is given at once, with the kind's
 * limits in its hint, and "Your recent imports" under it. The picker refuses a wrong type or an
 * oversized file itself, so the API never sees one. A viewer sees why they cannot import instead.
 * A kind with upload options draws its form above the picker. A file chosen before the form is
 * ready is not uploaded: the picker says to fill in the form, and focus moves into it.
 */
export function ImportNewScreen(props: ImportNewScreenProps): JSX.Element {
  const { kind, offline = false, uploading = null, recent } = props
  const t = useAppText()
  const format = useFormat()
  const words = kind.words(t)
  const types = listOf(t, kind.limits.accept)
  const size = megabytes(kind.limits.maxBytes)
  const mine = recent?.filter((item) => item.kind === kind.limits.id) ?? []
  const options = kind.options
  const value = props.options ?? options?.initial ?? {}
  const ready = options ? options.ready(value) : true
  const limits = t.t(`Import.fileHint`, { types, size, rows: format.number(kind.limits.maxRows) })
  const form = useRef<HTMLDivElement>(null)
  // A file was chosen before the options were ready; the picker says so until they are.
  const [early, setEarly] = useState(false)
  // Each refusal draws a fresh picker, so it lists no file and the same file can be chosen again.
  const [picks, setPicks] = useState(0)
  const onFiles = (files: readonly File[]) => {
    const file = files[0]
    if (!file) return
    if (!ready) {
      setEarly(true)
      setPicks((count) => count + 1)
      form.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
      return
    }
    setEarly(false)
    props.onFile?.(file, options ? value : undefined)
  }
  return (
    <Stack gap="xl">
      <PageHeader
        title={words.title}
        titleDataE2E="import-title"
        back={{ href: kind.href, label: words.goTo }}
        navigate={props.navigate}
      />
      <Stack class="max-w-xl">
        {props.forbidden ? <Viewer {...props} words={words} /> : (
          <>
            {offline && <Offline />}
            {options && (
              <div ref={form} class="flex flex-col gap-4" data-e2e="import-options">
                {options.render({
                  value,
                  onChange: (next) => props.onOptions?.(next),
                  disabled: uploading !== null || offline,
                })}
              </div>
            )}
            <FileInput
              key={picks}
              id="import-file"
              name="file"
              accept={kind.limits.accept.join(`,`)}
              maxSize={kind.limits.maxBytes}
              label={t.t(`Import.file`)}
              hint={limits}
              error={early && !ready ? t.t(`Import.optionsFirst`) : props.error ?? undefined}
              disabled={uploading !== null || offline}
              previews={false}
              labels={{
                browse: t.t(`Import.browse`),
                tooLarge: (name) => t.t(`Import.tooLarge`, { name, size }),
                wrongType: (name) => t.t(`Import.wrongType`, { name, types }),
              }}
              onFiles={onFiles}
            />
            <p role="status" aria-live="polite" class="text-sm text-muted" data-e2e="import-upload">
              {uploading !== null && t.t(`Import.uploading`, { file: uploading })}
            </p>
          </>
        )}
        {mine.length > 0 && (
          <section aria-labelledby="import-recent" class="mt-6" data-e2e="import-recent">
            <h2 id="import-recent" class="text-base font-semibold text-foreground">
              {t.t(`Import.recent`)}
            </h2>
            <ul class="mt-3 divide-y divide-subtle overflow-hidden rounded-lg border border-subtle bg-surface">
              {mine.map((item) => (
                <li key={item.id}>
                  <Link
                    href={IMPORT_PATHS.import(item.id)}
                    navigate={props.navigate}
                    class="flex min-h-11 flex-col gap-1 px-4 py-3 hover:bg-subtle focus-visible:outline-2 focus-visible:outline-focus sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                    data-e2e="import-recent-item"
                  >
                    <bdi class="min-w-0 truncate font-medium text-foreground">{item.fileName}</bdi>
                    <span class="flex shrink-0 gap-2 text-sm text-muted">
                      <span>{statusWord(t, item.status)}</span>
                      <span aria-hidden="true">·</span>
                      <When at={item.createdAt} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </Stack>
    </Stack>
  )
}

export interface ImportScreenProps extends ImportPageProps {
  /** The import as the server last said it is, or `null` while the first read runs. */
  summary: ImportSummary | null
  /** Which column each field reads, as the person set it. */
  mapping: ColumnMap
  onMap?: (key: string, column: number | null) => void
  /** The server's check of every row with `mapping`, or `null` before the first one answers. */
  check: ImportCheckResult | null
  /** A check is running for a changed mapping. */
  checking?: boolean
  /** The save was asked for and has not answered yet. */
  committing?: boolean
  /** The undo was asked for and has not answered yet. */
  undoing?: boolean
  /** Why the last save or undo failed, in words, shown over the buttons; `null` for none. */
  error?: string | null
  /** Saves the rows with `mapping`. Called only with every required field mapped. */
  onCommit?: () => void
  /** Undoes the batch, once the person confirmed it. */
  onUndo?: () => void
  /** Opens the list with the removed records shown, after an undo. */
  onShowRemoved?: () => void
  /** The person's values for the review's choice fields, by row: only those unlike the review's. */
  choices?: ImportChoices
  /** Rows to save despite an overridable skip. */
  keep?: readonly number[]
  /** The person set choice field `field` of `row` to `value`. */
  onChoose?: (row: number, field: string, value: string) => void
  /** The person ticked or cleared "Import anyway" on `row`. */
  onKeep?: (row: number, on: boolean) => void
}

/**
 * `/imports/:id`: one import as it stands, each status under the file line. Reading shows a
 * skeleton; a ready import shows the column mapper with the check's problems on its preview rows,
 * the refused rows further down the file, and "Import N notes"; a save in progress says the person
 * can leave; a saved one offers "Go to notes" and an undo behind a confirmation. Each step moves
 * focus to its heading and says it in a polite live region.
 */
export function ImportScreen(props: ImportScreenProps): JSX.Element {
  const { kind, summary } = props
  const t = useAppText()
  const words = kind.words(t)
  const heading = useRef<HTMLHeadingElement>(null)
  const status = summary === null ? null : stepOf(summary)
  const first = useRef(true)
  useEffect(() => {
    // The page's first step is the page itself; only a change of step moves focus.
    if (status === null) return
    if (first.current) {
      first.current = false
      return
    }
    heading.current?.focus()
  }, [status])
  const title = summary === null ? `` : headingOf(t, words, summary, props.check, props.keep ?? [])
  return (
    <Stack gap="xl">
      <PageHeader
        title={words.title}
        titleDataE2E="import-title"
        subtitle={summary === null
          ? undefined
          : <bdi data-e2e="import-file">{summary.fileName}</bdi>}
        back={{ href: kind.href, label: words.goTo }}
        navigate={props.navigate}
      />
      <p role="status" aria-live="polite" class="sr-only" data-e2e="import-status">{title}</p>
      {summary === null
        ? <LoadingSkeleton rows={4} />
        : (
          <Stack data-e2e="import-step" data-status={ImportStatus[summary.status].toLowerCase()}>
            <h2
              ref={heading}
              tabIndex={-1}
              class="text-lg font-semibold text-foreground outline-none"
              data-e2e="import-heading"
            >
              {title}
            </h2>
            {props.offline && <Offline />}
            {props.forbidden
              ? <Viewer {...props} words={words} />
              : <Step {...props} summary={summary} words={words} heading={heading} />}
          </Stack>
        )}
    </Stack>
  )
}

/**
 * `/imports/:id` for an import the server does not have: removed after a day unsaved, of another
 * group, or never there. Its kind is unknown, so it names none.
 */
export function ImportGoneScreen(): JSX.Element {
  const t = useAppText()
  return (
    <Stack gap="xl" data-e2e="import-gone">
      <PageHeader title={t.t(`Import.gone`)} titleDataE2E="import-title" />
      <p class="text-muted">{t.t(`Import.goneText`)}</p>
    </Stack>
  )
}

/** `/imports/:id` while the import is read: its kind, and so its title, are not known yet. */
export function ImportLoadingScreen(): JSX.Element {
  const t = useAppText()
  return (
    <Stack gap="xl" data-e2e="import-loading">
      <PageHeader title={t.t(`Import.title`)} titleDataE2E="import-title" />
      <LoadingSkeleton rows={4} />
    </Stack>
  )
}

/** The step a status shows: a failure before a save and one at the save are different steps. */
function stepOf(summary: ImportSummary): string {
  if (summary.status !== ImportStatus.FAILED) return ImportStatus[summary.status]
  return summary.commitRequestedAt === null ? `READ_FAILED` : `SAVE_FAILED`
}

/** The heading of each step, which the live region says too. */
function headingOf(
  t: Translator<string>,
  words: ImportKindWords,
  summary: ImportSummary,
  check: ImportCheckResult | null,
  keep: readonly number[],
): string {
  switch (summary.status) {
    case ImportStatus.READING:
      return t.t(`Import.reading`, { file: summary.fileName })
    case ImportStatus.READY:
      return t.t(`Import.match`)
    case ImportStatus.FAILED:
      return summary.commitRequestedAt === null
        ? t.t(`Import.readFailed`)
        : t.t(`Import.saveFailed`)
    case ImportStatus.COMMITTING:
      // After a reload the last check is gone, and the server keeps no count until the save ends.
      return check ? words.committing(toSave(check, keep)) : words.committingUncounted
    case ImportStatus.COMMITTED:
      return words.committed(summary.savedCount ?? 0)
    case ImportStatus.UNDONE:
      return t.t(`Import.undone`)
  }
}

/** What the page shows under the heading for one status. */
function Step(
  props: ImportScreenProps & {
    summary: ImportSummary
    words: ImportKindWords
    heading: RefObject<HTMLHeadingElement>
  },
): JSX.Element {
  const { summary, words, kind } = props
  const t = useAppText()
  const another = (label: string) => (
    <div>
      <Button
        href={IMPORT_PATHS.new(summary.kind)}
        navigate={props.navigate}
        variant="secondary"
        class={WIDE}
        data-e2e="import-another"
      >
        {label}
      </Button>
    </div>
  )
  switch (summary.status) {
    case ImportStatus.READING:
      return <LoadingSkeleton rows={3} />
    case ImportStatus.READY:
      return <Ready {...props} />
    case ImportStatus.FAILED:
      return (
        <>
          <Notice tone="danger" live={false}>
            <span data-e2e="import-failure">{summary.failure}</span>
          </Notice>
          {another(
            summary.commitRequestedAt === null
              ? t.t(`Import.chooseAnother`)
              : t.t(`Import.importAnother`),
          )}
        </>
      )
    case ImportStatus.COMMITTING:
      return <p class="text-muted">{t.t(`Import.leave`)}</p>
    case ImportStatus.COMMITTED:
      return <Committed {...props} />
    case ImportStatus.UNDONE:
      return (
        <>
          <p class="text-muted" data-e2e="import-undone">{words.undone(summary.savedCount ?? 0)}</p>
          <div>
            <Button
              type="button"
              class={WIDE}
              data-e2e="import-show-removed"
              onClick={props.onShowRemoved}
            >
              {words.showRemoved}
            </Button>
          </div>
          <p>
            <Link
              href={IMPORT_PATHS.new(kind.limits.id)}
              navigate={props.navigate}
              class="inline-flex min-h-11 items-center text-sm text-link underline sm:min-h-9"
            >
              {t.t(`Import.importAnother`)}
            </Link>
          </p>
        </>
      )
  }
}

/** A saved import: how many rows went in, "Go to" and the confirmed undo. */
function Committed(
  props: ImportScreenProps & {
    summary: ImportSummary
    words: ImportKindWords
  },
): JSX.Element {
  const { summary, words, undoing = false } = props
  const t = useAppText()
  const [confirming, setConfirming] = useState(false)
  const saved = summary.savedCount ?? 0
  const left = summary.errorCount ?? 0
  return (
    <>
      {left > 0 && (
        <p class="text-muted" data-e2e="import-left-out">
          {t.t(`Import.leftOut`, { count: left })}
        </p>
      )}
      <ActionError error={props.error} />
      <div class="flex flex-col gap-2 sm:flex-row">
        <Button href={props.kind.href} navigate={props.navigate} class={WIDE} data-e2e="import-go">
          {words.goTo}
        </Button>
        <Button
          type="button"
          variant="secondary"
          class={WIDE}
          busy={undoing}
          busyLabel={t.t(`Import.undoing`)}
          disabled={props.offline}
          data-e2e="import-undo"
          onClick={() => setConfirming(true)}
        >
          {t.t(`Import.undo`)}
        </Button>
      </div>
      {confirming && (
        <ConfirmDialog
          title={words.undoTitle(saved)}
          message={words.undoText(props.kind.restoreDays)}
          confirmLabel={words.undoConfirm(saved)}
          cancelLabel={t.t(`Import.cancel`)}
          tone="danger"
          dataE2E="import-undo-dialog"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            props.onUndo?.()
          }}
        />
      )}
    </>
  )
}

/**
 * A read import: the mapper, the check's line, the review's rows when the kind has a review, the
 * refused rows past the preview, and the main button. The button is never disabled: with a required
 * field unmapped it moves focus to that field, and with no row to save it says why.
 */
function Ready(
  props: ImportScreenProps & { summary: ImportSummary; words: ImportKindWords },
): JSX.Element {
  const { summary, words, check, mapping, committing = false, keep = [] } = props
  const t = useAppText()
  const format = useFormat()
  const [noValid, setNoValid] = useState(false)
  const noValidRef = useRef<HTMLDivElement>(null)
  const form = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (noValid) noValidRef.current?.focus()
  }, [noValid])
  // A new check or a kept row changes the count: the message waits for the next press.
  useEffect(() => setNoValid(false), [check, props.keep])
  const preview = summary.preview
  const offset = preview?.columns ? 1 : 0
  const sample = preview?.sample ?? []
  const errorsOf = new Map(check?.rows.map((row) => [row.row, row.errors]) ?? [])
  const fields = summary.fields.map((field) => ({
    key: field.key,
    label: words.field(field.key, field.label),
    required: field.required,
  }))
  const rows: ImportPreviewRow[] = sample.map((cells, index) => ({
    line: index + 1 + offset,
    values: Object.fromEntries(
      fields.map((field) => {
        const column = mapping[field.key]
        return [field.key, column === null || column === undefined ? `` : cells[column] ?? ``]
      }),
    ),
    errors: errorsOf.get(index + 1),
  }))
  const further = check?.rows.filter((row) => row.row > sample.length) ?? []
  const more = check ? check.withErrors - check.rows.length : 0
  const total = summary.rowCount ?? check?.rowCount ?? 0
  return (
    <ScreenForm
      pending={committing}
      onSubmit={() => {
        const missing = fields.find((field) => field.required && mapping[field.key] == null)
        if (missing) {
          form.current?.querySelector<HTMLElement>(`#${IMPORT_MAPPER_ID}-${missing.key}`)?.focus()
          return
        }
        if (check && toSave(check, keep) === 0) {
          setNoValid(true)
          noValidRef.current?.focus()
          return
        }
        props.onCommit?.()
      }}
    >
      <div ref={form} class="flex flex-col gap-6">
        <ImportMapper
          id={IMPORT_MAPPER_ID}
          header={preview?.columns ?? null}
          sample={sample}
          fields={fields}
          value={mapping}
          onChange={(key, column) => props.onMap?.(key, column)}
          preview={rows}
          rowCount={total}
          pending={props.checking}
        />
        <p class="text-sm text-muted" data-e2e="import-check">
          {check &&
            t.t(`Import.checked`, { valid: format.number(check.valid), count: check.rowCount })}
        </p>
        {check?.reviews && (
          <ReviewRows
            {...props}
            reviews={check.reviews}
            fields={summary.fields}
            offset={offset}
            keep={keep}
          />
        )}
        {(further.length > 0 || more > 0) && (
          <section aria-labelledby="import-further" data-e2e="import-further">
            <h3 id="import-further" class="text-base font-semibold text-foreground">
              {t.t(`Import.further`)}
            </h3>
            <RefusedRows t={t} rows={further} offset={offset} more={more} />
          </section>
        )}
        <ActionError error={props.error} />
        {noValid && (
          <div ref={noValidRef} tabIndex={-1} class="outline-none" data-e2e="import-no-valid">
            <Notice tone="danger" live={false}>
              {check?.valid === 0 ? t.t(`Import.noValid`) : t.t(`Import.allSkipped`)}
            </Notice>
          </div>
        )}
        <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="submit"
            class={WIDE}
            busy={committing}
            busyLabel={t.t(`Import.committing`)}
            disabled={props.offline}
            data-e2e="import-submit"
          >
            {words.submit(check ? toSave(check, keep) : total)}
          </Button>
        </div>
      </div>
    </ScreenForm>
  )
}

/** How many reviewed rows the table shows at first, and how many more each press adds. */
export const IMPORT_REVIEW_PAGE = 50

/**
 * The rows a save writes: the valid ones, less those the review skips, plus the overridable skips
 * the person kept.
 */
export function toSave(check: ImportCheckResult, keep: readonly number[]): number {
  const skipped = check.reviews?.filter((review) => !willSave(review, keep)).length ?? 0
  return check.valid - skipped
}

/** Whether a save writes this reviewed row: not skipped, or skipped overridably and kept. */
function willSave(review: ImportRowReview, keep: readonly number[]): boolean {
  return review.skip === null || (review.overridable && keep.includes(review.row))
}

type ReviewFilter = `all` | `import` | `skipped`

/**
 * Smaller than `sm`, the table becomes one card per row: the header is read by screen readers
 * only, and each cell is a line of its own with its column's name before it. Each card is the
 * library Card's `pc-card` with its `shadow-raised`. A stopgap until preact-components' `Table`
 * has a card mode of its own.
 */
const STACKED = [
  `mt-3 min-h-0`,
  `max-sm:bg-transparent max-sm:ring-0 max-sm:[&_table]:block max-sm:[&_table]:divide-y-0`,
  `max-sm:[&_thead]:sr-only max-sm:[&_tbody]:flex max-sm:[&_tbody]:flex-col max-sm:[&_tbody]:gap-3`,
  `max-sm:[&_tbody]:divide-y-0 max-sm:[&_tbody]:bg-transparent`,
  `max-sm:[&_tbody_tr]:flex max-sm:[&_tbody_tr]:flex-col max-sm:[&_tbody_tr]:gap-3`,
  `max-sm:[&_tbody_tr]:pc-card max-sm:[&_tbody_tr]:shadow-raised max-sm:[&_tbody_tr]:p-4`,
  `max-sm:[&_tbody_td]:p-0 max-sm:[&_tbody_th]:p-0`,
].join(` `)

/** A row's line number: the row's header, and where "Show more" puts focus. */
const LINE_HEADER = `text-start font-medium tabular-nums focus-visible:outline-hidden ` +
  `focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset max-sm:font-semibold`

/** A column's name before its value in a phone's card; the header names it from `sm`. */
function CardLabel({ children }: { children: string }): JSX.Element {
  return <span aria-hidden="true" class="text-sm text-muted sm:hidden">{children}</span>
}

/**
 * "Check the rows": what the kind's review said of each valid row, under the mapper. A summary of
 * how many rows a save writes and skips, a filter, and the rows 50 at a time. Each row shows its
 * line, its mapped values, whether it is saved or why it is skipped, "Import anyway" on a skip the
 * person may override, and the kind's control for each choice field. "Show more" moves focus to the
 * first row it adds.
 */
function ReviewRows(
  props: ImportScreenProps & {
    reviews: readonly ImportRowReview[]
    fields: readonly ImportField[]
    offset: number
    keep: readonly number[]
    words: ImportKindWords
  },
): JSX.Element {
  const { reviews, fields, offset, keep, words, kind, mapping } = props
  const t = useAppText()
  const disabled = props.committing === true || props.offline === true
  const [filter, setFilter] = useState<ReviewFilter>(`all`)
  const [shown, setShown] = useState(IMPORT_REVIEW_PAGE)
  const table = useRef<HTMLDivElement>(null)
  const focusRow = useRef<number | null>(null)
  useEffect(() => {
    if (focusRow.current === null) return
    table.current?.querySelector<HTMLElement>(`#import-review-line-${focusRow.current}`)?.focus()
    focusRow.current = null
  }, [shown])
  const columns = fields.filter((field) => !field.choice && mapping[field.key] != null)
  const choiceFields = fields.filter((field) => field.choice)
  const saved = reviews.filter((review) => willSave(review, keep)).length
  const listed = filter === `all`
    ? reviews
    : reviews.filter((review) => (review.skip === null) === (filter === `import`))
  const visible = listed.slice(0, shown)
  const left = listed.length - visible.length
  const label = (field: ImportField) => words.field(field.key, field.label)
  return (
    <section aria-labelledby="import-review" class="flex flex-col gap-3" data-e2e="import-review">
      <h3 id="import-review" class="text-base font-semibold text-foreground">
        {t.t(`Import.review`)}
      </h3>
      <p class="text-sm text-muted" data-e2e="import-review-summary">
        {t.t(`Import.toImport`, { count: saved })}
        <span aria-hidden="true">{` · `}</span>
        {t.t(`Import.skipped`, { count: reviews.length - saved })}
      </p>
      <SegmentedControl<ReviewFilter>
        ariaLabel={t.t(`Import.filter`)}
        class="self-start"
        value={filter}
        onChange={(value) => {
          setFilter(value)
          setShown(IMPORT_REVIEW_PAGE)
        }}
        options={[
          { value: `all`, label: t.t(`Import.filterAll`) },
          { value: `import`, label: t.t(`Import.filterToImport`) },
          { value: `skipped`, label: t.t(`Import.filterSkipped`) },
        ]}
      />
      {visible.length === 0
        ? <p class="text-sm text-muted" data-e2e="import-review-none">{t.t(`Import.reviewNone`)}</p>
        : (
          <div ref={table}>
            <Table
              class={STACKED}
              caption={t.t(`Import.reviewTable`)}
              captionClass="sr-only"
              rowDataE2E="import-review-row"
              headerSlot={
                <>
                  <th scope="col" class="text-start">{t.t(`Import.line`)}</th>
                  {columns.map((field) => (
                    <th key={field.key} scope="col" class="text-start">{label(field)}</th>
                  ))}
                  <th scope="col" class="text-start">{t.t(`Import.status`)}</th>
                  {choiceFields.map((field) => (
                    <th key={field.key} scope="col" class="min-w-40 text-start">{label(field)}</th>
                  ))}
                </>
              }
              bodyKeys={visible.map((review) => review.row)}
              bodySlots={visible.map((review) => {
                const line = review.row + offset
                const kept = keep.includes(review.row)
                const saving = willSave(review, keep)
                return (
                  <>
                    <th
                      scope="row"
                      id={`import-review-line-${review.row}`}
                      tabIndex={-1}
                      class={LINE_HEADER}
                      data-e2e="import-review-line"
                    >
                      <span aria-hidden="true" class="sm:hidden">{`${t.t(`Import.line`)} `}</span>
                      {line}
                    </th>
                    {columns.map((field) => (
                      <td
                        key={field.key}
                        class="max-sm:flex max-sm:justify-between max-sm:gap-4"
                      >
                        <CardLabel>{label(field)}</CardLabel>
                        <bdi class="max-sm:text-end">
                          {review.cells[mapping[field.key] as number] ?? ``}
                        </bdi>
                      </td>
                    ))}
                    <td>
                      <div class="flex flex-col gap-2">
                        <div class="max-sm:flex max-sm:justify-between max-sm:gap-4">
                          <CardLabel>{t.t(`Import.status`)}</CardLabel>
                          <span
                            class={review.skip === null
                              ? `text-muted max-sm:text-end`
                              : `font-medium text-foreground max-sm:text-end`}
                            data-e2e="import-review-status"
                          >
                            {review.skip ?? t.t(`Import.willImport`)}
                          </span>
                        </div>
                        {review.skip !== null && review.overridable && (
                          <Checkbox
                            id={`import-keep-${review.row}`}
                            checked={kept}
                            disabled={disabled}
                            aria-label={t.t(`Import.keepLine`, { line })}
                            labelClass="min-h-11 w-full sm:min-h-9 sm:w-auto"
                            data-e2e="import-keep"
                            onChange={(event) =>
                              props.onKeep?.(review.row, event.currentTarget.checked)}
                          >
                            {t.t(`Import.keep`)}
                          </Checkbox>
                        )}
                      </div>
                    </td>
                    {choiceFields.map((field) => {
                      const suggestion = review.suggestions[field.key]
                      const control = saving
                        ? kind.review?.choice?.(field.key, {
                          row: review,
                          value: props.choices?.[review.row]?.[field.key] ?? suggestion ?? ``,
                          suggestion,
                          onChange: (value) => props.onChoose?.(review.row, field.key, value),
                          disabled,
                          id: `import-choice-${review.row}-${field.key}`,
                          label: t.t(`Import.choiceLine`, { field: label(field), line }),
                        })
                        : undefined
                      // A skipped row, or a field with neither a control nor a suggestion, shows
                      // an empty cell, and no line at all in a phone's card.
                      const shows = saving && (control != null || !!suggestion)
                      return (
                        <td key={field.key} class={shows ? `` : `max-sm:hidden`}>
                          {shows && (
                            // From `sm`, a kind's control is as wide as its longest value, so the
                            // column grows to it instead of cutting the chosen value.
                            <div class="flex flex-col gap-1 sm:[&_select]:w-auto">
                              <CardLabel>{label(field)}</CardLabel>
                              {control ?? <bdi data-e2e="import-suggestion">{suggestion}</bdi>}
                            </div>
                          )}
                        </td>
                      )
                    })}
                  </>
                )
              })}
            />
          </div>
        )}
      {left > 0 && (
        <div>
          <Button
            type="button"
            variant="secondary"
            class={WIDE}
            data-e2e="import-review-more"
            onClick={() => {
              focusRow.current = listed[visible.length].row
              setShown(shown + IMPORT_REVIEW_PAGE)
            }}
          >
            {t.t(`Import.showMore`, { count: Math.min(left, IMPORT_REVIEW_PAGE) })}
          </Button>
        </div>
      )}
    </section>
  )
}

/**
 * The rows the check refused past the preview, as Line and Problem, and "and N more" when the
 * check stopped listing them. Local here: a list of problems by line, beside the library's mapper.
 */
export function RefusedRows(
  { t, rows, offset, more }: {
    t: Translator<string>
    rows: readonly { row: number; errors: readonly string[] }[]
    /** 1 when the file's first row names the columns, so line numbers count as a spreadsheet's. */
    offset: number
    /** How many refused rows the check did not list. */
    more: number
  },
): JSX.Element {
  return (
    <>
      {rows.length > 0 && (
        <Table
          // The library holds a table 300 px tall for a list; a few refused rows need no room.
          class="mt-3 min-h-0"
          caption={t.t(`Import.further`)}
          captionClass="sr-only"
          headerSlot={
            <>
              <th scope="col" class="text-start">{t.t(`Import.line`)}</th>
              <th scope="col" class="text-start">{t.t(`Import.problem`)}</th>
            </>
          }
          bodyKeys={rows.map((row) => row.row)}
          bodySlots={rows.map((row) => (
            <>
              <th scope="row" class="text-start font-normal tabular-nums" data-e2e="import-line">
                {row.row + offset}
              </th>
              <td data-e2e="import-problem">{row.errors.join(` `)}</td>
            </>
          ))}
        />
      )}
      {more > 0 && (
        <p class="mt-2 text-sm text-muted" data-e2e="import-more">
          {t.t(`Import.more`, { count: more })}
        </p>
      )}
    </>
  )
}

/** The notice of a member who may not import the kind. */
function Viewer(props: ImportPageProps & { words: ImportKindWords }): JSX.Element {
  const t = useAppText()
  return (
    <div data-e2e="import-viewer">
      <Notice tone="warning" live={false} title={props.words.viewerTitle}>
        {t.t(`Import.viewer`, { group: props.groupName })}
      </Notice>
    </div>
  )
}

function Offline(): JSX.Element {
  const t = useAppText()
  return (
    <div data-e2e="import-offline">
      <Notice live={false}>{t.t(`Import.offline`)}</Notice>
    </div>
  )
}

/** A status as the recent list says it. */
function statusWord(t: Translator<string>, status: ImportStatus): string {
  switch (status) {
    case ImportStatus.READING:
      return t.t(`Import.statusReading`)
    case ImportStatus.READY:
      return t.t(`Import.statusReady`)
    case ImportStatus.FAILED:
      return t.t(`Import.statusFailed`)
    case ImportStatus.COMMITTING:
      return t.t(`Import.statusCommitting`)
    case ImportStatus.COMMITTED:
      return t.t(`Import.statusCommitted`)
    case ImportStatus.UNDONE:
      return t.t(`Import.statusUndone`)
  }
}

/** `.csv or .txt`: the endings a kind takes, as a sentence lists choices. */
function listOf(t: Translator<string>, endings: readonly string[]): string {
  return new Intl.ListFormat(t.language, { type: `disjunction` }).format(endings)
}

/** Whole megabytes as the hint says them: 2 MiB is "2". */
function megabytes(bytes: number): string {
  return String(Math.round(bytes / (1024 * 1024)))
}

/** Why the last save or undo failed, over the buttons, said at once. */
function ActionError({ error }: { error?: string | null }): JSX.Element | null {
  if (!error) return null
  return (
    <div data-e2e="import-error">
      <Notice tone="danger" urgent>{error}</Notice>
    </div>
  )
}
