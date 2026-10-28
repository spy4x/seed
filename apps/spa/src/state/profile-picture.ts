import { signal } from "@preact/signals"
import { RealtimeRequestError } from "@spy4x/realtime"
import { formatBytes } from "@spy4x/platform/universal/format-number"
import type { FileRejection } from "@spy4x/preact-ui/file-input"
import {
  PICTURE_MAX_BYTES,
  pictureContentType,
  type SignedPictureUpload,
  type User,
} from "@domain/identity"
import { callCommand } from "../modules.ts"
import type { KeyedMessage } from "@ui/message.ts"
import { putWithProgress } from "./attachments.ts"
import { sessionState } from "./session.ts"

/** What the picture store needs from the outside. Injected so tests need no socket or store. */
export interface PictureDependencies {
  sign(input: { contentType: string; size: number }): Promise<SignedPictureUpload>
  /** PUTs the file to the signed URL; rejects on failure. */
  put(upload: SignedPictureUpload, file: File): Promise<void>
  confirm(input: { id: string }): Promise<{ user: User }>
  cancel(input: { id: string }): Promise<{ id: string }>
  remove(): Promise<{ user: User }>
  /** Whether the browser believes it is online. */
  online(): boolean
  /** A local URL that shows `file` before it is uploaded, and its release. */
  preview(file: File): string
  release(url: string): void
  /** The person the server answered; the session takes it, so every avatar follows at once. */
  setUser(user: User): void
}

const NETWORK: KeyedMessage = { key: `ProfilePicture.network` }
const OFFLINE: KeyedMessage = { key: `ProfilePicture.offline` }
const REMOVE_FAILED: KeyedMessage = { key: `ProfilePicture.removeFailed` }

/**
 * A file name inside a sentence, between Unicode isolates: the plain-text `<bdi>`, so a name in
 * another script keeps its own direction in an Arabic sentence and the other way round.
 */
function isolated(name: string): string {
  return `\u2068${name}\u2069`
}

function typeError(name: string): KeyedMessage {
  return { key: `ProfilePicture.type`, values: { name: isolated(name) } }
}

function sizeError(name: string, size: number): KeyedMessage {
  return {
    key: `ProfilePicture.size`,
    values: { name: isolated(name), size: formatBytes(size), max: formatBytes(PICTURE_MAX_BYTES) },
  }
}

/** The server's refusal of `file`, in the row's words, by their key in `app`. */
function refusalOf(error: unknown, file: File): KeyedMessage {
  const code = error instanceof RealtimeRequestError
    ? (error.details as { code?: unknown } | undefined)?.code
    : undefined
  switch (code) {
    case `FILE_TYPE`:
      return typeError(file.name)
    case `FILE_TOO_LARGE`:
      return sizeError(file.name, file.size)
    case `FILE_CONTENT`:
      return { key: `ProfilePicture.content`, values: { name: isolated(file.name) } }
    case `UPLOADS_PENDING`:
      return { key: `ProfilePicture.pending` }
    case `UPLOAD_BUDGET`:
      return { key: `ProfilePicture.budget` }
  }
  return NETWORK
}

/**
 * The Account section's profile picture (#228). A chosen image shows in the row at once, is signed,
 * PUT straight to the store and confirmed; the answer is the person, which the session takes. A
 * refusal brings the previous picture back. A signed upload that is not confirmed is cancelled on
 * the server, so it stops counting as waiting.
 */
export function createPictureStore(dependencies: PictureDependencies) {
  const status = signal<`idle` | `uploading` | `removing`>(`idle`)
  const error = signal<KeyedMessage | null>(null)
  /** What a screen reader hears once a change went through; `null` while there is nothing new. */
  const announcement = signal<KeyedMessage | null>(null)
  /** The chosen image while it uploads; `null` otherwise. */
  const preview = signal<string | null>(null)

  function refuse(message: KeyedMessage): void {
    announcement.value = null
    error.value = message
  }

  async function choose(file: File): Promise<void> {
    if (status.value !== `idle`) return
    if (!dependencies.online()) return refuse(OFFLINE)
    error.value = null
    announcement.value = null
    status.value = `uploading`
    const shown = dependencies.preview(file)
    preview.value = shown
    let signed: SignedPictureUpload | null = null
    try {
      signed = await dependencies.sign({ contentType: pictureContentType(file), size: file.size })
      await dependencies.put(signed, file)
      const { user } = await dependencies.confirm({ id: signed.id })
      signed = null
      dependencies.setUser(user)
      announcement.value = { key: `ProfilePicture.saved` }
    } catch (cause) {
      refuse(refusalOf(cause, file))
    } finally {
      // Its failure only leaves the upload waiting until it expires.
      if (signed) await dependencies.cancel({ id: signed.id }).catch(() => {})
      preview.value = null
      dependencies.release(shown)
      status.value = `idle`
    }
  }

  /** The browser refused the file before anything was sent. */
  function reject(rejection: FileRejection): void {
    const { file } = rejection
    refuse(
      rejection.reason === `too-large` ? sizeError(file.name, file.size) : typeError(file.name),
    )
  }

  async function remove(): Promise<void> {
    if (status.value !== `idle`) return
    error.value = null
    announcement.value = null
    status.value = `removing`
    try {
      const { user } = await dependencies.remove()
      dependencies.setUser(user)
      announcement.value = { key: `ProfilePicture.removed` }
    } catch {
      refuse(REMOVE_FAILED)
    } finally {
      status.value = `idle`
    }
  }

  return { status, error, announcement, preview, choose, reject, remove }
}

export type PictureStore = ReturnType<typeof createPictureStore>

/** The picture operations over the app's calls port, and the browser's PUT. */
export const pictureCalls: PictureDependencies = {
  sign: (input) => callCommand(`picture.sign`, input),
  put: (upload, file) => putWithProgress(upload, file, () => {}, new AbortController().signal),
  confirm: (input) => callCommand(`picture.confirm`, input),
  cancel: (input) => callCommand(`picture.cancel`, input),
  remove: () => callCommand(`picture.remove`, undefined),
  online: () => navigator.onLine,
  preview: (file) => URL.createObjectURL(file),
  release: (url) => URL.revokeObjectURL(url),
  setUser: (user) => sessionState.value = { ...sessionState.value, user },
}
