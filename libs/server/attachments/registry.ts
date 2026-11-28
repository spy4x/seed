/**
 * Every attachment kind the product serves, in one list (docs/attachments-and-pictures.md). A
 * product adds a kind by writing it with `attachmentKind`, giving it a migration, and listing it
 * here; the handlers, the plan's caps, the clean-up, the admin's files list and the data export
 * take it from this list.
 *
 * @module
 */

import { noteAttachmentKind } from "../notes/attachment-kind.ts"
import type { NotesSetup } from "../notes/setup.ts"
import { type AttachmentKind, attachmentKindList } from "./kind.ts"

/**
 * The kinds the API serves and the worker reads. With the notes off (`NOTES=false`) the notes'
 * kind is left out, so `attachment.*` is refused as unknown; any other kind still works.
 */
export function attachmentKinds(notes: NotesSetup): readonly AttachmentKind[] {
  return attachmentKindList(notes.on ? [noteAttachmentKind] : [])
}
