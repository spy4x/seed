import type { Translator } from "@spy4x/platform/universal/i18n"
import { isolate } from "@spy4x/preact-ui/bdi"
import { NOTE_TITLE_MAX_LENGTH } from "@domain/notes"
import { NOTE_PATHS } from "@ui/progressive.tsx"
import { messageText } from "@ui/message.ts"
import type { toasts } from "../state/toasts.ts"
import { type FormErrors, NOTE_MESSAGES, type NoteItem } from "../state/notes.ts"
import type { NotePageActions } from "./shortcuts.ts"

/**
 * The note page's palette commands the person may use now, as the page's own menu offers them:
 * Attach wherever an editor writes (the create page too), Copy link on any open note, readers
 * included, and Duplicate, Delete and, with another group to go to, Move on an open note an editor
 * can change.
 */
export function offeredNoteActions(
  page: { canWrite: boolean; noteOpen: boolean; canMove: boolean },
  run: Required<NotePageActions>,
): NotePageActions {
  const { attach, copyLink, duplicate, move } = run
  if (!page.noteOpen) return page.canWrite ? { attach } : {}
  if (!page.canWrite) return { copyLink }
  return { attach, duplicate, ...page.canMove ? { move } : {}, copyLink, delete: run.delete }
}

/** The toasts a note action shows. */
type Toasts = Pick<typeof toasts, "success" | "error">

/**
 * Copies the address of the note `note.id` and says how it went: who can open it, or that the
 * copy failed. The notes list's "Copy link" and the palette's do this one thing.
 *
 * @param base The page's address, which the note's path is resolved against.
 * @param groupName The note's group, named in the toast; left out, it says "this group".
 */
export async function copyNoteLink(
  t: Translator<string>,
  note: { id: string; groupName?: string },
  ports: { base: string; copy: (text: string) => Promise<boolean>; toasts: Toasts },
): Promise<void> {
  if (await ports.copy(new URL(NOTE_PATHS.note(note.id), ports.base).href)) {
    ports.toasts.success({
      title: t.t(`NotesView.linkCopied`),
      body: note.groupName === undefined
        ? t.t(`NotesView.linkCopiedThisGroup`)
        : t.t(`NotesView.linkCopiedGroup`, { group: isolate(note.groupName) }),
      dataE2E: "note-link-copied",
    })
  } else {
    ports.toasts.error({
      title: t.t(`NotesView.copyFailed`),
      body: t.t(`NotesView.copyFailedHint`),
    })
  }
}

/**
 * The title of a note's copy: "Groceries (copy)" in the person's language, the original title cut
 * short so the whole never passes {@link NOTE_TITLE_MAX_LENGTH} characters (an emoji counts as one,
 * as the API counts).
 */
export function duplicateTitle(t: Translator<string>, title: string): string {
  const characters = Array.from(title)
  const whole = t.t(`NoteEditorView.copyTitle`, { title })
  const over = Array.from(whole).length - NOTE_TITLE_MAX_LENGTH
  if (over <= 0) return whole
  return t.t(`NoteEditorView.copyTitle`, {
    title: characters.slice(0, Math.max(0, characters.length - over)).join(""),
  })
}

/**
 * Makes a copy of the saved note `note` in its own group, with its title (see
 * {@link duplicateTitle}), text and tags but not its files, and opens it. A refusal (the plan's
 * note cap, a lost connection the queue cannot take) shows as an error toast with the store's
 * message, and the page stays.
 */
export async function duplicateNote(
  t: Translator<string>,
  note: Pick<NoteItem, "groupId" | "title" | "body" | "tagIds">,
  ports: {
    create: (input: {
      groupId: string
      id: string
      title: string
      body: string
      tagIds: string[]
    }) => Promise<{ note: NoteItem } | { errors: FormErrors }>
    newId: () => string
    navigate: (to: string) => void
    toasts: Toasts
  },
): Promise<void> {
  const outcome = await ports.create({
    groupId: note.groupId,
    id: ports.newId(),
    title: duplicateTitle(t, note.title),
    body: note.body,
    tagIds: [...note.tagIds],
  })
  if ("errors" in outcome) {
    ports.toasts.error({
      title: t.t(`NoteEditorView.duplicateFailed`),
      body: messageText(t, outcome.errors.title ?? outcome.errors.form ?? NOTE_MESSAGES.create)!,
    })
    return
  }
  ports.toasts.success({
    title: t.t(`NoteEditorView.createdTitle`),
    body: t.t(`NoteEditorView.created`, { title: isolate(outcome.note.title) }),
    dataE2E: "note-duplicated",
  })
  ports.navigate(NOTE_PATHS.note(outcome.note.id))
}
