/**
 * Every import kind the product takes, in one list (`docs/imports.md`). A product adds a kind by
 * writing it with `importKind` and listing it here; the flow's files stay as they are.
 *
 * @module
 */

import { noteImportKind } from "../notes/note-import.ts"
import type { NotesSetup } from "../notes/setup.ts"
import type { ImportKind } from "./import-kind.ts"

/**
 * The kinds the API offers and the jobs run. With the notes off (`NOTES=false`) the notes kind is
 * left out, so no import creates a note and one made before the switch fails when its job runs.
 */
export function importKinds(notes: NotesSetup): readonly ImportKind[] {
  return notes.on ? [noteImportKind] : []
}
