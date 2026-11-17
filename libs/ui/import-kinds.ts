/**
 * The kinds of file the import pages take, with the words each one needs: the pages themselves name
 * no kind of record. A product that adds a kind on the server (`docs/imports.md`, "Add a kind")
 * adds a case here with its limits from `libs/domain` and its own catalog keys.
 *
 * @module
 */
import type { ComponentChildren } from "preact"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { canMutateNotes, type GroupRole } from "@domain/groups"
import type { ImportKindLimits, ImportRowReview } from "@domain/imports"
import { NOTE_IMPORT_KIND, NOTE_RESTORE_DAYS } from "@domain/notes"
import { NOTE_PATHS } from "./progressive.tsx"

/** Every sentence of the import pages that names the kind's records, in the person's language. */
export interface ImportKindWords {
  /** The page's title: "Import notes". */
  title: string
  /** The main button while the columns are matched: "Import 18 notes". */
  submit(count: number): string
  /** The heading while the save runs: "Importing 18 notes…". */
  committing(count: number): string
  /** The same heading when the count is not known, after a reload: "Importing the notes…". */
  committingUncounted: string
  /** The heading once saved: "18 notes imported". */
  committed(count: number): string
  /** The undo confirmation's title. */
  undoTitle(count: number): string
  /** The undo confirmation's text, given how many days a removed record can be restored. */
  undoText(days: number): string
  /** The undo confirmation's button. */
  undoConfirm(count: number): string
  /** The line once undone: "18 notes moved to deleted notes." */
  undone(count: number): string
  /** Where the records went after an undo: "Show deleted notes". */
  showRemoved: string
  /** The main action once saved: "Go to notes". */
  goTo: string
  /** A member who may not create the records: "You can't import notes here". */
  viewerTitle: string
  /** A field's name in the person's language, or the server's label for a field it lacks. */
  field(key: string, label: string): string
}

/** An upload's options as the API takes them: field keys to text (`docs/imports.md`). */
export type ImportOptions = Record<string, string>

/**
 * The kind's own form above the file picker, such as the account a statement belongs to. A file
 * chosen before `ready` holds is not uploaded; the upload sends the value as its `options`.
 */
export interface ImportKindOptions {
  /** The value before the person touched the form. */
  initial: ImportOptions
  /** The form's fields, each with its own label. `disabled` while a file uploads or offline. */
  render(props: {
    value: ImportOptions
    onChange(value: ImportOptions): void
    disabled: boolean
  }): ComponentChildren
  /** Whether `value` is complete enough to upload with. */
  ready(value: ImportOptions): boolean
}

/** What a choice control of one reviewed row is given. */
export interface ImportChoiceProps {
  /** The reviewed row: its number, cells, skip and suggestions. */
  row: ImportRowReview
  /** The value the save will use: the person's choice, or else the suggestion, or else empty. */
  value: string
  /** What the review proposed for this field, if anything. */
  suggestion: string | undefined
  onChange(value: string): void
  disabled: boolean
  /** The control's `id`, unique on the page. */
  id: string
  /** The control's accessible name, naming the field and the line: "Category, line 12". */
  label: string
}

/** How a kind with a review draws its choice fields in the "Check the rows" table. */
export interface ImportKindReview {
  /**
   * The control for choice field `field` of one row. Full width and 44 px tall on a phone
   * (`min-h-11 w-full sm:min-h-9 sm:w-auto`). Without it, the suggestion shows as text.
   */
  choice?(field: string, props: ImportChoiceProps): ComponentChildren
}

/** One kind the pages take: the files it takes, who may import it, and its words. */
export interface ImportKindView {
  limits: ImportKindLimits
  /** Whether a member with `role` may import it, as the server's kind decides. */
  canCreate(role: GroupRole): boolean
  /** How many days a record the undo removed can be restored. */
  restoreDays: number
  /** Where "Go to" leads once saved. */
  href: string
  words(t: Translator<string>): ImportKindWords
  /** The kind's upload options; a kind without them uploads with none. */
  options?: ImportKindOptions
  /** How the kind draws its review's choices; the review shows whenever the check has one. */
  review?: ImportKindReview
}

/** The notes kind's words, every key written out so the catalog check finds it. */
function noteWords(t: Translator<string>): ImportKindWords {
  const fields: Record<string, string> = {
    title: t.t(`ImportNotes.fieldTitle`),
    body: t.t(`ImportNotes.fieldBody`),
  }
  return {
    title: t.t(`ImportNotes.title`),
    submit: (count) => t.t(`ImportNotes.submit`, { count }),
    committing: (count) => t.t(`ImportNotes.committing`, { count }),
    committingUncounted: t.t(`ImportNotes.committingUncounted`),
    committed: (count) => t.t(`ImportNotes.committed`, { count }),
    undoTitle: (count) => t.t(`ImportNotes.undoTitle`, { count }),
    undoText: (days) => t.t(`ImportNotes.undoText`, { count: days }),
    undoConfirm: (count) => t.t(`ImportNotes.undoConfirm`, { count }),
    undone: (count) => t.t(`ImportNotes.undone`, { count }),
    showRemoved: t.t(`ImportNotes.showRemoved`),
    goTo: t.t(`ImportNotes.goTo`),
    viewerTitle: t.t(`ImportNotes.viewerTitle`),
    field: (key, label) => fields[key] ?? label,
  }
}

/**
 * The kind with id `kind`, or `null` for a kind this app does not take: one the server lacks, or
 * the notes while the product turns them off (`notes` false).
 */
export function importKindView(
  kind: string | null,
  notes: boolean,
): ImportKindView | null {
  if (kind === NOTE_IMPORT_KIND.id && notes) {
    return {
      limits: NOTE_IMPORT_KIND,
      canCreate: canMutateNotes,
      restoreDays: NOTE_RESTORE_DAYS,
      href: NOTE_PATHS.list,
      words: noteWords,
    }
  }
  return null
}
