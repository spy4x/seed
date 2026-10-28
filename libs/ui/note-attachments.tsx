import type { JSX } from "preact"
import { useRef, useState } from "preact/hooks"
import { type AttachmentItem, AttachmentList } from "@spy4x/preact-ui/attachment-list"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { FileInput } from "@spy4x/preact-ui/file-input"
import { useFocusFallback } from "@spy4x/preact-ui/use-focus-after-removal"
import { formatBytes } from "@spy4x/platform/universal/format-number"
import type { PlanRefusal } from "@domain/billing"
import { ATTACHMENT_TYPES, type AttachmentUsage } from "@domain/notes"
import { Rich } from "@spy4x/preact-ui/i18n"
import { PlanRefusalNotice } from "./plan-refusal.tsx"
import type { Navigate } from "./progressive.tsx"
import { useAppText } from "./i18n.ts"
import { type KeyedMessage, type Message, messageText } from "./message.ts"
import { userValue } from "./notes-screen.tsx"

/** The id of the "Attach files" button, which the palette's "Attach files to this note" presses. */
export const ATTACH_BUTTON_ID = "note-attachments-attach"

/** The file types the chooser offers; the browser and the API refuse any other. */
const ACCEPT = ATTACHMENT_TYPES.join(",")

/** An error under the list, in the section's column: one line per refused file. */
const INLINE_ERROR = "mx-0 max-w-none whitespace-pre-line text-left text-sm"

/** Each plan's file rules, for the count before the group's room is read. */
const DEFAULT_PER_NOTE = 10

export interface NoteAttachmentsProps {
  groupId: string
  /** The group's name, which the quota line and the confirmation name. */
  groupName: string
  /** The note's files, in the order shown: `AttachmentList`'s rows. */
  items: readonly AttachmentItem[]
  /** The group's room and its plan's rules; `null` until read. */
  usage: AttachmentUsage | null
  /** Files refused before upload, one sentence each. */
  refusals: readonly Message[]
  /** The group's plan refused a file. */
  plan: PlanRefusal | null
  /** The last finished upload, such as "scan.pdf uploaded", for the status region. */
  announcement: Message
  /** A viewer's page: the list only, with no "Attach files" and no "Remove". */
  readOnly?: boolean
  /** The note is not created yet: a waiting file reads "Uploads when you create the note". */
  creating?: boolean
  /** Files chosen or dropped, refused ones included: the caller checks and words each. */
  onAdd?: (files: File[]) => void
  /** Stops an upload, or forgets a waiting or failed file. */
  onCancel?: (id: string) => void
  onRetry?: (id: string) => void
  /** Removes a confirmed file; resolves to the sentence to show, or `null`. */
  onRemove?: (id: string) => Promise<Message | null>
  /** Downloads a confirmed file; resolves to the sentence to show, or `null`. */
  onDownload?: (id: string) => Promise<Message | null>
  navigate?: Navigate
}

/**
 * The quota line: "Family uses 37 of 100 files and 41 MB of 200 MB.", as a message of the `app`
 * catalog whose `<group>` span is the group's name. A cap the plan does not set is left out.
 * `warn` is true from 90 % of either cap. Sizes are written for `language`, the interface
 * language, as the file rows above write theirs.
 */
export function quotaLine(
  groupName: string,
  usage: AttachmentUsage,
  language: string,
): { message: KeyedMessage; warn: boolean } {
  const bytes = formatBytes(usage.bytes, language)
  const near = (used: number, cap: number | null) => cap !== null && cap > 0 && used >= cap * 0.9
  const warn = near(usage.files, usage.maxFiles) || near(usage.bytes, usage.maxBytes)
  const group = groupName
  if (usage.maxFiles === null) {
    return {
      message: usage.maxBytes === null
        ? { key: `NoteAttachments.quotaNoCaps`, values: { group, count: usage.files, bytes } }
        : {
          key: `NoteAttachments.quotaNoFileCap`,
          values: {
            group,
            count: usage.files,
            bytes,
            maxBytes: formatBytes(usage.maxBytes, language),
          },
        },
      warn,
    }
  }
  return {
    message: usage.maxBytes === null
      ? {
        key: `NoteAttachments.quotaNoByteCap`,
        values: { group, files: usage.files, count: usage.maxFiles, bytes },
      }
      : {
        key: `NoteAttachments.quota`,
        values: {
          group,
          files: usage.files,
          count: usage.maxFiles,
          bytes,
          maxBytes: formatBytes(usage.maxBytes, language),
        },
      },
    warn,
  }
}

/**
 * The note's attachments, under its text: a heading row with the count ("3 of 10") and "Attach
 * files", the files as `AttachmentList` rows, what was refused, and the group's room. Dropping
 * files anywhere on the section attaches them too. A ready file's removal asks first; a waiting or
 * failed one goes at once, as nothing of it is stored. A viewer sees the list only, and nothing
 * when the note has no files.
 */
export function NoteAttachments(props: NoteAttachmentsProps): JSX.Element | null {
  const { items, usage, readOnly } = props
  const t = useAppText()
  const [asking, setAsking] = useState<AttachmentItem | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [problem, setProblem] = useState<Message | null>(null)
  const [dragging, setDragging] = useState(false)
  const section = useRef<HTMLElement>(null)
  // One choice arrives as its accepted files, then its refused ones: they are added as one batch,
  // so the refusals of the first half are not cleared by the second.
  const batch = useRef<File[] | null>(null)
  const take = (files: readonly File[]) => {
    if (!batch.current) {
      batch.current = []
      queueMicrotask(() => {
        const chosen = batch.current ?? []
        batch.current = null
        setProblem(null)
        props.onAdd?.(chosen)
      })
    }
    batch.current.push(...files)
  }

  // A control that leaves the section with focus on it, such as the list with its last file, hands
  // focus to "Attach files". Inside the list, the list itself moves focus to the next row first.
  useFocusFallback(
    section,
    () => section.current?.querySelector<HTMLElement>(`#${ATTACH_BUTTON_ID}`),
  )

  if (readOnly && items.length === 0) return null
  const perNote = usage?.maxPerNote ?? DEFAULT_PER_NOTE
  const placed = items.filter((item) => item.status !== "failed").length
  const quota = usage && !readOnly ? quotaLine(props.groupName, usage, t.language) : null
  const attachButton = () => section.current?.querySelector<HTMLElement>(`#${ATTACH_BUTTON_ID}`)

  const download = async (item: AttachmentItem) => {
    const sentence = await props.onDownload?.(item.id)
    setProblem(sentence ?? null)
  }
  const remove = async (item: AttachmentItem) => {
    setAsking(null)
    setRemovingId(item.id)
    const sentence = await props.onRemove?.(item.id)
    setProblem(sentence ?? null)
    if (sentence) setRemovingId(null)
  }
  const dropHandlers = readOnly ? {} : {
    onDragOver: (event: JSX.TargetedDragEvent<HTMLElement>) => {
      if (!event.dataTransfer?.types.includes("Files")) return
      event.preventDefault()
      setDragging(true)
    },
    onDragLeave: (event: JSX.TargetedDragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
    },
    onDrop: (event: JSX.TargetedDragEvent<HTMLElement>) => {
      event.preventDefault()
      setDragging(false)
      const dropped = event.dataTransfer ? Array.from(event.dataTransfer.files) : []
      if (dropped.length > 0) take(dropped)
    },
  }

  return (
    <section
      ref={section}
      aria-labelledby="note-attachments-heading"
      data-e2e="note-attachments"
      class={`flex flex-col gap-3 rounded-lg ${dragging ? "ring-2 ring-focus ring-offset-4" : ""}`}
      {...dropHandlers}
    >
      <div class="flex min-h-11 items-center justify-between gap-3">
        <h2 id="note-attachments-heading" class="text-sm font-medium">
          {t.t(`NoteAttachments.title`)}{" "}
          <span class="font-normal text-muted" data-e2e="note-attachments-count">
            {t.t(`NoteAttachments.count`, { count: placed, max: perNote })}
          </span>
        </h2>
        {!readOnly && (
          <FileInput
            id={ATTACH_BUTTON_ID}
            appearance="button"
            multiple
            accept={ACCEPT}
            label={t.t(`NoteAttachments.attach`)}
            onFiles={take}
            onReject={(refused) => take(refused.map((rejection) => rejection.file))}
          />
        )}
      </div>
      {items.length === 0 && !readOnly
        ? (
          <div
            class={`rounded-lg border-2 border-dashed px-6 py-8 text-center ${
              dragging ? "border-info bg-info-soft" : "border-control"
            }`}
            data-e2e="note-attachments-empty"
          >
            <p class="text-sm">{t.t(`NoteAttachments.empty`)}</p>
            <p class="mt-1 text-sm text-muted">
              {t.t(`NoteAttachments.types`, {
                size: formatBytes(usage?.maxFileBytes ?? 2 * 1024 ** 2, t.language),
              })}
            </p>
          </div>
        )
        : (
          <AttachmentList
            id="note-attachments"
            items={items}
            onDownload={props.onDownload && ((item) => void download(item))}
            onRemove={readOnly ? undefined : (item) => {
              if (item.status === "ready") setAsking(item)
              else props.onCancel?.(item.id)
            }}
            onCancel={readOnly ? undefined : (item) => props.onCancel?.(item.id)}
            onRetry={readOnly ? undefined : (item) => props.onRetry?.(item.id)}
            removingId={removingId}
            focusAfterLast={attachButton}
            labels={props.creating ? { waiting: t.t(`NoteAttachments.waitingCreate`) } : undefined}
          />
        )}
      <ErrorState
        message={props.refusals.map((refusal) => messageText(t, refusal)).join("\n")}
        class={INLINE_ERROR}
        dataE2E="note-attachments-refusals"
      />
      <ErrorState message={messageText(t, problem)} class={INLINE_ERROR} focusOnAppear />
      {props.plan && (
        <PlanRefusalNotice
          groupId={props.groupId}
          refusal={props.plan}
          groupName={props.groupName}
          navigate={props.navigate}
        />
      )}
      {quota && (
        <p
          class={`text-sm ${quota.warn ? "text-warning" : "text-muted"}`}
          data-e2e="note-attachments-quota"
        >
          {quota.warn && <strong class="font-medium">{t.t(`NoteAttachments.almostFull`)}</strong>}
          {quota.warn && " "}
          <Rich
            parts={t.parts(quota.message.key, quota.message.values)}
            tags={{ group: userValue }}
          />
        </p>
      )}
      <p role="status" class="sr-only" data-e2e="note-attachments-status">
        {messageText(t, props.announcement)}
      </p>
      {asking && (
        <ConfirmDialog
          title={t.t(`NoteAttachments.removeTitle`)}
          message={t.t(`NoteAttachments.removeMessage`, {
            name: asking.name,
            group: props.groupName,
          })}
          confirmLabel={t.t(`NoteAttachments.removeConfirm`)}
          cancelLabel={t.t(`NoteAttachments.cancel`)}
          tone="danger"
          dataE2E="note-attachment-remove-dialog"
          onConfirm={() => void remove(asking)}
          onCancel={() => setAsking(null)}
        />
      )}
    </section>
  )
}
