import { assertCanReadNotes, assertCanWriteNotes, NoteError } from "@domain/notes"
import { attachmentKind } from "../attachments/kind.ts"

/**
 * Files on a note: the first attachment kind. Its operations keep the names `attachment.*` and
 * the field `noteId`, and who may act is decided as for the note itself.
 */
export const noteAttachmentKind = attachmentKind({
  name: `note`,
  prefix: `attachment`,
  recordField: `noteId`,
  table: `note_attachments`,
  records: { table: `notes`, key: `note_id`, title: `title` },
  assertCanRead: assertCanReadNotes,
  assertCanWrite: assertCanWriteNotes,
  recordNotFound: () => new NoteError(`NOTE_NOT_FOUND`, `Note not found`),
})
