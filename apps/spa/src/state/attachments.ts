import { signal } from "@preact/signals"
import { RealtimeRequestError } from "@spy4x/realtime"
import { formatBytes } from "@spy4x/platform/universal/format-number"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { type PlanRefusal, PLANS, readPlanRefusal } from "@domain/billing"
import {
  type Attachment,
  ATTACHMENT_TYPES,
  type AttachmentListResult,
  type AttachmentUsage,
  type SignedAttachmentUpload,
} from "@domain/notes"
import type { KeyedMessage, Message } from "@ui/message.ts"
import { callCommand, callQuery, canCall } from "../modules.ts"

/** Where a row stands: the same words as preact-ui's `AttachmentList`. */
export type AttachmentRowStatus = "uploading" | "waiting" | "checking" | "failed" | "ready"

/** One row of the note's files, in the shape preact-ui's `AttachmentList` draws. */
export interface AttachmentRow {
  /**
   * The row's id, which never changes: the file's id for a file read from the server, a local id
   * for one chosen here, kept after its confirm so the row is not drawn anew and keeps focus.
   */
  id: string
  /** The stored file's id, once the server confirmed it. */
  fileId?: string
  name: string
  size: number
  type: string
  status: AttachmentRowStatus
  /** 0 to 100 while uploading. */
  progress?: number
  /** A short-lived link to an image, for its thumbnail and the lightbox. */
  src?: string
  thumbnailSrc?: string
  /** Why the upload failed, in the danger tone. */
  error?: Message
  /** Who attached a confirmed file: `null` for a former member, absent before it is confirmed. */
  createdByUserId?: number | null
}

/** What the store calls; tests pass fakes, the app passes {@link attachmentsCalls}. */
export interface AttachmentDependencies {
  list(input: { groupId: string; noteId: string }): Promise<AttachmentListResult>
  sign(input: {
    groupId: string
    noteId: string
    name: string
    contentType: string
    size: number
  }): Promise<SignedAttachmentUpload>
  /** PUTs the file to the signed URL, reporting progress from 0 to 100; rejects on failure. */
  put(
    upload: SignedAttachmentUpload,
    file: Blob,
    onProgress: (percent: number) => void,
    signal: AbortSignal,
  ): Promise<void>
  confirm(input: { groupId: string; id: string }): Promise<{ attachment: Attachment }>
  /** Drops a signed upload that will not be confirmed, so it stops counting as waiting. */
  cancel(input: { groupId: string; id: string }): Promise<unknown>
  remove(input: { groupId: string; id: string }): Promise<unknown>
  download(input: { groupId: string; id: string }): Promise<{ url: string }>
  /** Whether a call made now reaches the server. */
  canCall(): boolean
}

/** The rules a browser checks before anything is sent; the server checks them again. */
const DEFAULT_RULES = PLANS[0].attachments

const TYPES: readonly string[] = ATTACHMENT_TYPES

/**
 * "invoice.pdf is not really a PDF", by what the file claims to be: keys of the `app` catalog, one
 * whole sentence each.
 */
const NOT_REALLY: Record<string, string> = {
  "application/pdf": `AttachmentMessages.notReallyPdf`,
  "image/jpeg": `AttachmentMessages.notReallyJpeg`,
  "image/png": `AttachmentMessages.notReallyPng`,
  "image/webp": `AttachmentMessages.notReallyWebp`,
  "image/gif": `AttachmentMessages.notReallyGif`,
}

/** The upload failed, for no reason the API named; a key of the `app` catalog. */
const UPLOAD_FAILED = `AttachmentMessages.uploadFailed`

/** The download link could not be made; a key of the `app` catalog. */
const LINK_EXPIRED = `AttachmentMessages.linkExpired`

/** The sentence the screen shows for a file the server refused, by the API's code. */
function refusalOf(error: unknown, name: string, size: number): Message {
  const details = error instanceof RealtimeRequestError
    ? error.details as { code?: unknown; limit?: unknown } | undefined
    : undefined
  const limit = typeof details?.limit === `number` ? details.limit : null
  switch (details?.code) {
    case `FILE_TYPE`:
      return typeError(name)
    case `FILE_TOO_LARGE`:
      return sizeError(name, size, limit ?? DEFAULT_RULES.maxFileBytes)
    case `NOTE_FULL`:
      return {
        key: `AttachmentMessages.noteFull`,
        values: { count: limit ?? DEFAULT_RULES.maxPerNote, name },
      }
    case `UPLOADS_PENDING`:
      return { key: `AttachmentMessages.pending`, values: { name } }
    case `UPLOAD_BUDGET`:
      return { key: `AttachmentMessages.budget`, values: { name } }
  }
  return error instanceof Error && error.message ? error.message : UPLOAD_FAILED
}

function typeError(name: string): KeyedMessage {
  return { key: `AttachmentMessages.type`, values: { name } }
}

function sizeError(name: string, size: number, max: number): KeyedMessage {
  return {
    key: `AttachmentMessages.size`,
    values: { name, size: formatBytes(size), max: formatBytes(max) },
  }
}

/** A confirmed file as a row. */
function readyRow(attachment: Attachment): AttachmentRow {
  return {
    id: attachment.id,
    fileId: attachment.id,
    name: attachment.name,
    size: attachment.size,
    type: attachment.contentType,
    status: `ready`,
    createdByUserId: attachment.createdByUserId,
  }
}

/** Whether a row takes one of the note's places: every one but a failed upload. */
const takesPlace = (row: AttachmentRow) => row.status !== `failed`

/**
 * The files of the note that is open: its rows, the group's room and the uploads in flight.
 *
 * An upload is signed, PUT straight to the store with its progress, then confirmed, which checks
 * the stored bytes and the group's caps on the server. A file chosen on a note not created yet, or
 * while the page has no network, waits; {@link AttachmentsStore.flush} sends what waits once the
 * note exists and the network is back. The browser refuses a type, a size or a full note before
 * anything is sent, with the sentence the server would give.
 *
 * It holds one note: an answer for a note the page has left is dropped.
 */
export function createAttachmentsStore(dependencies: AttachmentDependencies) {
  const groupId = signal<string | null>(null)
  const noteId = signal<string | null>(null)
  const rows = signal<readonly AttachmentRow[]>([])
  const usage = signal<AttachmentUsage | null>(null)
  const loading = signal(false)
  const error = signal<Message | null>(null)
  /** Files refused before upload, one sentence each; cleared by the next choice. */
  const refusals = signal<readonly Message[]>([])
  /** The group's plan refused a file: the notice to show, or `null`. */
  const plan = signal<PlanRefusal | null>(null)
  /** The last finished upload, for one `role="status"` region: "scan.pdf uploaded". */
  const announcement = signal<Message>(``)
  const files = new Map<string, File>()
  const aborts = new Map<string, AbortController>()
  /** The signed upload of each row that has one and is not confirmed yet. */
  const signedUploads = new Map<string, string>()
  let opened = 0
  /** The note {@link created} just named: the page that opens it next keeps its uploads. */
  let adopted: string | null = null

  const update = (id: string, change: Partial<AttachmentRow>) => {
    rows.value = rows.value.map((row) => row.id === id ? { ...row, ...change } : row)
  }
  /** Tells the server a row's signed upload will not be confirmed. */
  const release = (id: string) => {
    const upload = signedUploads.get(id)
    const group = groupId.value
    signedUploads.delete(id)
    if (upload === undefined || group === null) return
    // A cancel that does not arrive costs nothing: the upload stops counting as waiting once its
    // URL has expired.
    void dependencies.cancel({ groupId: group, id: upload }).catch(() => undefined)
  }
  const drop = (id: string) => {
    rows.value = rows.value.filter((row) => row.id !== id)
    files.delete(id)
    aborts.get(id)?.abort()
    aborts.delete(id)
    release(id)
  }
  const isCurrent = (read: number) => read === opened

  /** Fetches a link to every image row that has none, for its thumbnail. */
  async function linkImages(read: number, group: string): Promise<void> {
    const images = rows.value.filter((row) =>
      row.status === `ready` && row.type.startsWith(`image/`) && !row.src
    )
    await Promise.all(images.map(async (row) => {
      try {
        const { url } = await dependencies.download({ groupId: group, id: row.fileId ?? row.id })
        if (isCurrent(read)) update(row.id, { src: url, thumbnailSrc: url })
      } catch {
        // The row stays without its thumbnail; its menu can still download it.
      }
    }))
  }

  /** Shows the files of `note` in `group`, or none for a note not created yet (`null`). */
  async function open(group: string, note: string | null): Promise<void> {
    const keep = note !== null && note === adopted && group === groupId.value
    adopted = null
    if (keep) return
    const read = ++opened
    for (const row of rows.value) drop(row.id)
    groupId.value = group
    noteId.value = note
    rows.value = []
    usage.value = null
    error.value = null
    refusals.value = []
    plan.value = null
    if (note === null) return
    loading.value = true
    try {
      const result = await dependencies.list({ groupId: group, noteId: note })
      if (!isCurrent(read)) return
      rows.value = [...result.attachments.map(readyRow), ...rows.value]
      usage.value = result.usage
      void linkImages(read, group)
    } catch (cause) {
      if (!isCurrent(read)) return
      error.value = cause instanceof Error ? cause.message : `AttachmentMessages.load`
    } finally {
      if (isCurrent(read)) loading.value = false
    }
    await flush()
  }

  /**
   * The new note the open page made was created as `note`: the files chosen for it upload now. Its
   * group's room is read too, for the quota line.
   */
  async function created(note: string): Promise<void> {
    const group = groupId.value
    if (noteId.value !== null || group === null) return
    const read = opened
    noteId.value = note
    adopted = note
    const flushed = flush()
    try {
      const result = await dependencies.list({ groupId: group, noteId: note })
      if (isCurrent(read)) usage.value = result.usage
    } catch {
      // The quota line waits for the next open.
    }
    await flushed
  }

  /**
   * Adds the chosen files: each one the rules refuse is named in {@link refusals}, the rest upload
   * now or wait.
   */
  function add(chosen: readonly File[]): void {
    const rules = usage.value ?? DEFAULT_RULES
    const problems: Message[] = []
    const overflow: string[] = []
    let places = rules.maxPerNote - rows.value.filter(takesPlace).length
    plan.value = null
    for (const file of chosen) {
      if (!TYPES.includes(file.type)) problems.push(typeError(file.name))
      else if (file.size > rules.maxFileBytes || file.size < 1) {
        problems.push(sizeError(file.name, file.size, rules.maxFileBytes))
      } else if (places <= 0) overflow.push(file.name)
      else {
        places--
        const id = uuidV7()
        files.set(id, file)
        rows.value = [...rows.value, {
          id,
          name: file.name,
          size: file.size,
          type: file.type,
          status: `waiting`,
        }]
      }
    }
    if (overflow.length > 0) {
      problems.push({
        key: `AttachmentMessages.overflow`,
        values: { count: overflow.length, max: rules.maxPerNote, names: overflow.join(`, `) },
      })
    }
    refusals.value = problems
    void flush()
  }

  /** Uploads every waiting file, once the note exists and the page can reach the server. */
  async function flush(): Promise<void> {
    if (noteId.value === null || !dependencies.canCall()) return
    const waiting = rows.value.filter((row) => row.status === `waiting`)
    await Promise.all(waiting.map((row) => upload(row.id)))
  }

  /** Sends one waiting or failed row: sign, PUT with progress, confirm. */
  async function upload(id: string): Promise<void> {
    const file = files.get(id)
    const group = groupId.value
    const note = noteId.value
    const read = opened
    if (!file || group === null || note === null) return
    // A retry signs anew: the failed try's upload is let go first.
    release(id)
    const abort = new AbortController()
    aborts.set(id, abort)
    update(id, { status: `uploading`, progress: 0, error: undefined })
    try {
      const signed = await dependencies.sign({
        groupId: group,
        noteId: note,
        name: file.name,
        contentType: file.type,
        size: file.size,
      })
      if (abort.signal.aborted) {
        // Cancelled while it was being signed: no PUT, and the server lets the upload go.
        void dependencies.cancel({ groupId: group, id: signed.id }).catch(() => undefined)
        return
      }
      signedUploads.set(id, signed.id)
      await dependencies.put(signed, file, (progress) => {
        if (isCurrent(read)) update(id, { progress })
      }, abort.signal)
      if (!isCurrent(read) || abort.signal.aborted) return
      update(id, { status: `checking`, progress: undefined })
      const { attachment } = await dependencies.confirm({ groupId: group, id: signed.id })
      if (abort.signal.aborted) {
        // Cancelled during the check, after the server took the confirm: the file it stored goes.
        void dependencies.remove({ groupId: group, id: attachment.id }).catch(() => undefined)
        return
      }
      if (!isCurrent(read)) return
      files.delete(id)
      aborts.delete(id)
      signedUploads.delete(id)
      rows.value = rows.value.map((row) => row.id === id ? { ...readyRow(attachment), id } : row)
      if (usage.value) {
        usage.value = {
          ...usage.value,
          files: usage.value.files + 1,
          bytes: usage.value.bytes + attachment.size,
        }
      }
      announcement.value = { key: `AttachmentMessages.uploaded`, values: { name: attachment.name } }
      void linkImages(read, group)
    } catch (cause) {
      if (!isCurrent(read) || abort.signal.aborted) return
      const refusal = cause instanceof RealtimeRequestError ? readPlanRefusal(cause.details) : null
      if (refusal) {
        plan.value = refusal
        drop(id)
        return
      }
      const code = cause instanceof RealtimeRequestError
        ? (cause.details as { code?: unknown } | undefined)?.code
        : undefined
      if (code === `FILE_CONTENT`) {
        refusals.value = [
          ...refusals.value,
          NOT_REALLY[file.type]
            ? { key: NOT_REALLY[file.type], values: { name: file.name } }
            : typeError(file.name),
        ]
        drop(id)
        return
      }
      update(id, {
        status: `failed`,
        progress: undefined,
        error: cause instanceof RealtimeRequestError
          ? refusalOf(cause, file.name, file.size)
          : undefined,
      })
    }
  }

  /** Stops an upload in flight, or forgets a waiting or failed file. Nothing is kept of it. */
  function cancel(id: string): void {
    const row = rows.value.find((item) => item.id === id)
    if (row && row.status !== `ready`) drop(id)
  }

  /** Sends a failed row again. */
  function retry(id: string): Promise<void> {
    const row = rows.value.find((item) => item.id === id)
    return row?.status === `failed` ? upload(id) : Promise.resolve()
  }

  /**
   * Removes a confirmed file for everyone in the group. Returns `null`, or the sentence to show
   * when the server could not be reached or refused.
   */
  async function remove(id: string): Promise<Message | null> {
    const row = rows.value.find((item) => item.id === id)
    const group = groupId.value
    if (!row || row.status !== `ready` || group === null) return null
    try {
      await dependencies.remove({ groupId: group, id: row.fileId ?? id })
    } catch (cause) {
      const code = cause instanceof RealtimeRequestError
        ? (cause.details as { code?: unknown } | undefined)?.code
        : undefined
      // Someone else removed it a moment ago: the row goes all the same.
      if (code !== `ATTACHMENT_NOT_FOUND`) {
        return { key: `AttachmentMessages.remove`, values: { name: row.name } }
      }
    }
    drop(id)
    if (usage.value) {
      usage.value = {
        ...usage.value,
        files: Math.max(0, usage.value.files - 1),
        bytes: Math.max(0, usage.value.bytes - row.size),
      }
    }
    return null
  }

  /**
   * A fresh five-minute link to a confirmed file. Throws an `Error` whose message the screen shows.
   */
  async function link(id: string): Promise<string> {
    const group = groupId.value
    const row = rows.value.find((item) => item.id === id)
    if (group === null) throw new Error(LINK_EXPIRED)
    try {
      return (await dependencies.download({ groupId: group, id: row?.fileId ?? id })).url
    } catch {
      throw new Error(LINK_EXPIRED)
    }
  }

  return {
    groupId,
    noteId,
    rows,
    usage,
    loading,
    error,
    refusals,
    plan,
    announcement,
    open,
    created,
    add,
    flush,
    cancel,
    retry,
    remove,
    link,
  }
}

export type AttachmentsStore = ReturnType<typeof createAttachmentsStore>

/**
 * PUTs `file` to a signed URL with `XMLHttpRequest`, the one browser API that reports upload
 * progress. Rejects on a network failure, an answer other than 2xx, or `signal`.
 */
export function putWithProgress(
  upload: SignedAttachmentUpload,
  file: Blob,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open(`PUT`, upload.url)
    request.setRequestHeader(`content-type`, upload.headers[`content-type`])
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
    }
    request.onload = () =>
      request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(UPLOAD_FAILED))
    request.onerror = () => reject(new Error(UPLOAD_FAILED))
    request.onabort = () => reject(new DOMException(`Upload canceled`, `AbortError`))
    signal.addEventListener(`abort`, () => request.abort(), { once: true })
    request.send(file)
  })
}

/** The attachment operations over the app's calls port, and the browser's PUT. */
export const attachmentsCalls: AttachmentDependencies = {
  list: (input) => callQuery(`attachment.list`, input),
  sign: (input) => callCommand(`attachment.sign`, input),
  put: putWithProgress,
  confirm: (input) => callCommand(`attachment.confirm`, input),
  cancel: (input) => callCommand(`attachment.cancel`, input),
  remove: (input) => callCommand(`attachment.remove`, input),
  download: (input) => callQuery(`attachment.download`, input),
  canCall,
}

/** The files of the note the page shows. */
export const attachmentsStore = createAttachmentsStore(attachmentsCalls)
