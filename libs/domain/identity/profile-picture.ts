import { type Type, type } from "arktype"
import type { Command } from "@spy4x/platform/cqrs"
import type { RequestInfo } from "@spy4x/platform/request-info"
import { UUID_PATTERN } from "@spy4x/platform/universal/uuid"
import { type FieldErrors, fieldErrors } from "@spy4x/validation"
import type { Actor, User } from "./+lib.ts"

/**
 * Profile pictures (#228, docs/files.md): a person's own picture in place of their initials. It is
 * uploaded like a note attachment (signed, PUT straight to the store, confirmed), counts against
 * the same waiting uploads and hourly budget. The worker turns it into upright widths with no
 * metadata (#464, docs/files.md), and avatars show the narrowest WebP.
 */

/** The types a picture may be: those a browser shows and whose first bytes the store checks. */
export const PICTURE_TYPES = [`image/jpeg`, `image/png`, `image/webp`, `image/heic`] as const

/** The largest picture taken: 10 MiB, room for a phone's photo. Only its small widths are kept. */
export const PICTURE_MAX_BYTES = 10 * 1024 * 1024

/**
 * The type a picture is uploaded as. A desktop browser that does not know HEIC gives a `.heic` or
 * `.heif` file no type, or `image/heif`; those go as HEIC, and the API still checks the bytes.
 */
export function pictureContentType(file: { name: string; type: string }): string {
  if ((PICTURE_TYPES as readonly string[]).includes(file.type)) return file.type
  return /\.hei[cf]$/i.test(file.name) ? `image/heic` : file.type
}

/** Where a person's picture stands once it is confirmed (#464); `null` while they have none. */
export enum PictureState {
  /** The worker is making its small widths; nothing is shown yet. */
  Preparing = 1,
  /** Its widths are made, and it is shown. */
  Ready = 2,
  /** The worker could not use it (not an image, or too many pixels); nothing is shown. */
  Refused = 3,
}

/**
 * The picture to show for `user`: its id once ready, or `null` while it is prepared, after it was
 * refused, or when there is none, so an `Avatar` shows the initials instead of asking for a picture
 * that is not there.
 */
export function shownPictureId(
  user: { pictureId?: string | null; pictureState?: PictureState | null } | null | undefined,
): string | null {
  if (!user?.pictureId) return null
  return user.pictureState === PictureState.Preparing || user.pictureState === PictureState.Refused
    ? null
    : user.pictureId
}

/** Where a confirmed picture is kept. No browser is ever given a URL to write it. */
export function pictureObjectKey(id: string): string {
  return `pictures/${id}`
}

/** Why a picture was refused or not found. */
export type PictureErrorCode =
  | `INVALID_REQUEST`
  | `FILE_TYPE`
  | `FILE_TOO_LARGE`
  | `FILE_MISSING`
  | `FILE_CONTENT`
  | `UPLOADS_PENDING`
  | `UPLOAD_BUDGET`
  | `UPLOAD_NOT_FOUND`
  | `PICTURE_NOT_FOUND`

export class PictureError extends Error {
  constructor(
    public readonly code: PictureErrorCode,
    message: string,
    /** Each failed field's code and rule, when a schema refused the request. */
    public readonly fields?: FieldErrors,
  ) {
    super(message)
    this.name = `PictureError`
  }
}

/** A signed picture upload: PUT the file to `url` with `headers`, then confirm `id`. */
export interface SignedPictureUpload {
  id: string
  url: string
  headers: { "content-type": string }
}

/** `picture.sign`: the image the browser is about to upload. */
export const pictureSignPayloadSchema = type({
  contentType: `string <= 100`,
  size: `number.integer >= 1`,
  "+": `reject`,
})
/** `picture.confirm` and `picture.cancel`: the upload `picture.sign` answered. */
export const pictureUploadPayloadSchema = type({ id: UUID_PATTERN, "+": `reject` })

/** Validates `value` against `schema`. Throws `PictureError("INVALID_REQUEST")`. */
export function parsePictureRequest<S extends Type<object>>(schema: S, value: unknown): S["infer"] {
  const result = schema(value)
  if (result instanceof type.errors) {
    throw new PictureError(`INVALID_REQUEST`, result.summary, fieldErrors(result))
  }
  return result as S["infer"]
}

export interface PictureSignPayload {
  actor: Actor
  contentType: string
  size: number
  idempotencyKey?: string
}

export class PictureSignCommand implements Command<PictureSignPayload, SignedPictureUpload> {
  __resultType?: SignedPictureUpload
  constructor(public data: PictureSignPayload) {}
}

export interface PictureUploadPayload {
  actor: Actor
  id: string
  request: RequestInfo
  idempotencyKey?: string
}

/** The person's picture becomes the upload's, once its bytes are checked. Answers the person. */
export class PictureConfirmCommand implements Command<PictureUploadPayload, { user: User }> {
  __resultType?: { user: User }
  constructor(public data: PictureUploadPayload) {}
}

/** The person drops an upload they signed, so it stops counting as waiting. */
export class PictureCancelCommand implements Command<PictureUploadPayload, { id: string }> {
  __resultType?: { id: string }
  constructor(public data: PictureUploadPayload) {}
}

export interface PictureRemovePayload {
  actor: Actor
  request: RequestInfo
  idempotencyKey?: string
}

/** The person removes their picture; their initials show again. Answers the person. */
export class PictureRemoveCommand implements Command<PictureRemovePayload, { user: User }> {
  __resultType?: { user: User }
  constructor(public data: PictureRemovePayload) {}
}

/** Where the product serves a picture: `GET /api/pictures/<id>` redirects to the file. */
export const PICTURE_PATH = `/api/pictures`

/** Where the operator area serves any person's picture, on the admin host. */
export const ADMIN_PICTURE_PATH = `/api/admin/users/pictures`

/**
 * The `src` of picture `pictureId` under `base`, or `undefined` when there is none, so an `Avatar`
 * shows the initials.
 */
export function pictureUrl(
  pictureId: string | null | undefined,
  base: string = PICTURE_PATH,
): string | undefined {
  return pictureId ? `${base}/${pictureId}` : undefined
}
