import { type } from "arktype"
import {
  CONTACT_KINDS,
  type ContactKind,
  contactKind,
  contactValueProblem,
  normalizeContactValue,
} from "@spy4x/platform/universal/contact"
import { hasUnstorableTextCharacters } from "@spy4x/platform/universal/text"
import { UUID_PATTERN } from "@spy4x/platform/universal/uuid"
import type { FieldError, FieldErrors } from "@spy4x/validation"

/**
 * Contact links (#465): the channels the public website names (Telegram, Zalo, WhatsApp,
 * Instagram, Facebook, a phone number, an e-mail address, a web page), which an operator edits in
 * the admin app. The website shows them in its footer and in its Organization structured data.
 * Checking a value and building its link are `@spy4x/platform/universal/contact`'s; this module
 * adds the stored shape, the request bodies, the errors and the audit kinds. The SQL is
 * `libs/server/contact-links/`; the admin module is in `docs/admin-modules.md`.
 *
 * @module
 */

export { CONTACT_KINDS, type ContactKind }

// #region Limits
// Each matches its column in migration `2026_12_06_0001_contact_links.sql`.

/** The longest label, counted in characters as Postgres counts a VARCHAR. */
export const CONTACT_LABEL_MAX_LENGTH = 60

/** The most links the website keeps; a footer with more is noise. */
export const CONTACT_LINKS_MAX = 20

// #endregion

// #region Shapes

/** One link as the admin app reads it. */
export interface ContactLinkRecord {
  id: string
  kind: ContactKind
  /** Normalised and checked: `my_shop` for Telegram, `+84912345678` for a phone. */
  value: string
  /** What the website shows instead of the value, or `null` to show the kind and the value. */
  label: string | null
  /** 0 first. */
  position: number
  createdAt: string
  updatedAt: string
  /** Starts at 1 and grows by one with every change; an edit or a removal must name it. */
  version: number
}

/** The answer of `GET /api/admin/contact-links`: every link, in order. */
export interface AdminContactLinksResponse {
  links: ContactLinkRecord[]
}

/** One link as the public website reads it: no id, no times. */
export interface PublicContactLink {
  kind: ContactKind
  value: string
  label: string | null
}

/** The answer of `GET /api/contact-links`. */
export interface PublicContactLinksResponse {
  links: PublicContactLink[]
}

// #endregion

// #region Errors

export type ContactLinkErrorCode =
  | `LINK_NOT_FOUND`
  | `INVALID_REQUEST`
  | `ID_ALREADY_EXISTS`
  | `TOO_MANY_LINKS`
  | `ORDER_STALE`
  | `VERSION_CONFLICT`

/** The fields of a link's form, as named in the request bodies. */
export type ContactLinkField = `kind` | `value` | `label`

/** A refused contact-link request, with the field it is about when there is one. */
export class ContactLinkError extends Error {
  constructor(
    public readonly code: ContactLinkErrorCode,
    message: string,
    public readonly field: ContactLinkField | null = null,
    /** Why `field` failed, by code, so a screen says it in the person's language (#275). */
    failed?: FieldError,
  ) {
    super(message)
    this.name = `ContactLinkError`
    if (field !== null && failed) this.fields = { [field]: failed }
  }

  /** {@link field} and why it failed, as the API's `fields` names them; absent for none. */
  readonly fields?: FieldErrors
}

/** A write named a version the link has moved past; it carries the current one. */
export class ContactLinkVersionConflictError extends ContactLinkError {
  constructor(public readonly currentVersion: number) {
    super(`VERSION_CONFLICT`, `Someone else changed this link. Reload to see their change.`)
    this.name = `ContactLinkVersionConflictError`
  }
}

// #endregion

// #region Request schemas

const linkFields = {
  kind: contactKind,
  value: `string <= 4000`,
  "label?": `string <= 400 | null`,
} as const

const versionField = { version: `number.integer >= 1` } as const

/** `POST /api/admin/contact-links`: a client-made id, so a retry cannot add a second link. */
export const contactLinkCreateSchema = type({ id: UUID_PATTERN, ...linkFields, "+": `reject` })
export type ContactLinkCreateRequest = typeof contactLinkCreateSchema.infer

/** `POST /api/admin/contact-links/:id`: every field and the version edited. */
export const contactLinkUpdateSchema = type({ ...linkFields, ...versionField, "+": `reject` })
export type ContactLinkUpdateRequest = typeof contactLinkUpdateSchema.infer

/** `POST /api/admin/contact-links/:id/delete`: the version the operator saw. */
export const contactLinkVersionSchema = type({ ...versionField, "+": `reject` })

/** `POST /api/admin/contact-links/order`: every link's id, in the new order. */
export const contactLinkOrderSchema = type({
  ids: type(UUID_PATTERN).array().atMostLength(CONTACT_LINKS_MAX),
  "+": `reject`,
})

// #endregion

// #region Validation

/** A link's fields, normalised and checked, as the repository stores them. */
export interface ContactLinkFields {
  kind: ContactKind
  value: string
  label: string | null
}

/**
 * Normalises and checks a link's fields: the value as {@link normalizeContactValue} leaves it and
 * {@link contactValueProblem} accepts it, the label trimmed, `null` when empty, and at most
 * {@link CONTACT_LABEL_MAX_LENGTH} characters. Throws {@link ContactLinkError} with the field.
 */
export function parseContactLinkFields(
  input: Pick<ContactLinkCreateRequest, `kind` | `value` | `label`>,
): ContactLinkFields {
  const value = normalizeContactValue(input.kind, input.value)
  const label = input.label?.trim() || null
  if (value === ``) {
    throw new ContactLinkError(`INVALID_REQUEST`, `Enter where people reach you.`, `value`, {
      code: `required`,
    })
  }
  const problem = contactValueProblem(input.kind, value)
  if (problem) {
    throw new ContactLinkError(`INVALID_REQUEST`, problem, `value`, { code: `contactValue` })
  }
  if (label !== null && hasUnstorableTextCharacters(label)) {
    throw new ContactLinkError(
      `INVALID_REQUEST`,
      `Remove the NUL or broken character from this field.`,
      `label`,
      { code: `unstorableCharacters` },
    )
  }
  if (label !== null && Array.from(label).length > CONTACT_LABEL_MAX_LENGTH) {
    throw new ContactLinkError(
      `INVALID_REQUEST`,
      `Keep the label to ${CONTACT_LABEL_MAX_LENGTH} characters.`,
      `label`,
      { code: `maxLength`, values: { rule: CONTACT_LABEL_MAX_LENGTH } },
    )
  }
  return { kind: input.kind, value, label }
}

// #endregion

// #region Audit
// Every operator change writes one `audit_events` row on the operator, with the link as its
// entity; the audit log names them (`@ui/admin-audit-screen.tsx`).

/** The `audit_events.entity_type` of a contact link. */
export const CONTACT_LINK_ENTITY = `contact_link`

/** The `audit_events.event_kind` of each operator change. */
export const CONTACT_LINK_AUDIT_KINDS = {
  created: `contact.link_created`,
  updated: `contact.link_updated`,
  deleted: `contact.link_deleted`,
  reordered: `contact.links_reordered`,
} as const

export type ContactLinkAuditKind =
  typeof CONTACT_LINK_AUDIT_KINDS[keyof typeof CONTACT_LINK_AUDIT_KINDS]

// #endregion
