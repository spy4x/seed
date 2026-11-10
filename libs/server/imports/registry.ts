/**
 * Every import kind the product takes, in one list (`docs/imports.md`). A product adds a kind by
 * writing it with `importKind` and listing it here; the flow's files stay as they are.
 *
 * @module
 */

import { noteImportKind } from "../notes/note-import.ts"
import type { ImportKind } from "./import-kind.ts"

export const IMPORT_KINDS: readonly ImportKind[] = [noteImportKind]
