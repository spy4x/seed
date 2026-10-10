import { computed, signal } from "@preact/signals"
import { ConnectionLostError, RealtimeRequestError } from "@spy4x/realtime"
import { type PlanRefusal, readPlanRefusal } from "@domain/billing"
import { apiRead } from "./realtime-call.ts"
import { callCommand, callQuery, canCall, currentLayer, offlineNotes } from "../modules.ts"

/** A note as the API sends it: dates are ISO strings, the sequence a decimal string. */
export interface NoteItem {
  id: string
  groupId: string
  title: string
  body: string
  version: number
  changeSequence: string
  createdByUserId: number | null
  updatedByUserId: number | null
  createdAt: string
  updatedAt: string
}

/** The note a person just deleted and may still take back: the Undo toast is shown for it. */
export interface UndoOffer {
  id: string
  title: string
  /** When the offer ends, in milliseconds since the epoch. */
  until: number
}

/** How long Undo is offered after a delete, in milliseconds. */
export const UNDO_MS = 10_000

/** One page of a group's notes. */
export interface NotePage {
  notes: NoteItem[]
  nextCursor: string | null
}

/** What the notes store needs from the outside. Injected so tests need no network. */
export interface NotesDependencies {
  /** Reads one page of a group's notes, over REST: the same read at start-up and after a push. */
  fetchPage(groupId: string, cursor: string | null, deleted?: boolean): Promise<NotePage>
  /** Reads one note over the socket. */
  get(groupId: string, id: string): Promise<{ note: NoteItem }>
  /**
   * The group of a note, found by its id alone. Rejects with `NOTE_NOT_FOUND` for a note that does
   * not exist and for one in a group the person is not in. Reads only: it never changes the
   * selected group.
   */
  locate?(id: string): Promise<{ groupId: string }>
  create(input: { groupId: string; id: string; title: string; body: string }): Promise<
    { note: NoteItem }
  >
  update(
    input: { groupId: string; id: string; title: string; body: string; version: number },
  ): Promise<{ note: NoteItem }>
  delete(input: { groupId: string; id: string; version: number }): Promise<unknown>
  /** Brings a deleted note back. Needs the server: it is never queued. */
  restore(input: { groupId: string; id: string }): Promise<{ note: NoteItem }>
  /** Moves the notes to another group, all or none. Needs the server: it is never queued. */
  move(input: { groupId: string; toGroupId: string; noteIds: string[] }): Promise<
    { notes: NoteItem[] }
  >
  newId(): string
  /** What the device already holds of a group's notes, shown before the read answers. */
  readLocal?(groupId: string): Promise<readonly NoteItem[]>
}

interface Draft {
  title: string
  body: string
}

interface FormErrors {
  title: string | null
  form: string | null
  /** The group's plan refused the write: the screen shows an upgrade prompt for it. */
  plan?: PlanRefusal | null
}

interface Edit extends Draft {
  id: string
  version: number
  conflict: boolean
  /** The note as the edit started from it, to tell what the person changed. */
  base: Draft
}

const NO_ERRORS: FormErrors = { title: null, form: null }
const EMPTY_DRAFT: Draft = { title: "", body: "" }
const PAGE_LIMIT = 100
/** More pages than a group has notes in this template: a stop for a cursor loop. */
const MAX_PAGES = 20

export const NOTE_MESSAGES = {
  titleRequired: "Enter a title",
  conflict: "Someone changed this note since you opened it.",
  deleteConflict: "Someone changed that note, so it was not deleted.",
  gone: "This note was deleted.",
  load: "Could not load the notes",
  create: "Could not add the note",
  save: "Could not save the note",
  delete: "Could not delete the note",
  move: "Could not move the notes",
  moveOffline: "Moving notes needs a connection. Try again when you are back online.",
  moveNone: "Tick the notes you want to move.",
  moveUnsaved: "Save or discard your changes before moving the note.",
  restore: "Could not restore the note",
  restoreOffline: "Restoring a note needs a connection. Try again when you are back online.",
  restoreGone: "That note is no longer in the deleted notes.",
  moveGone: "A note you ticked is no longer here, so nothing was moved.",
} as const

function describe(error: unknown, fallback: string): string {
  return error instanceof RealtimeRequestError ? error.message : fallback
}

/** What the group's plan refused, read from the socket's `forbidden` details, or `null`. */
function planRefusal(error: unknown): PlanRefusal | null {
  return error instanceof RealtimeRequestError ? readPlanRefusal(error.details) : null
}

/** The note code of a refused call (`VERSION_CONFLICT`, `NOTE_NOT_FOUND`), or `null`. */
function noteCode(error: unknown): string | null {
  if (!(error instanceof RealtimeRequestError)) return null
  const code = (error.details as { code?: unknown } | undefined)?.code
  return typeof code === "string" ? code : null
}

/**
 * The notes screen's state: one group's notes, the create form, the note being edited and what
 * is in flight.
 *
 * Like the groups store, the list is always a full read of the server's answer, so the read after
 * a push and the read at start-up are one piece of code. The store's own writes do not move the
 * group's cursor: another member's change may have taken the sequence just before this one, and
 * moving past it would drop that change's hint. The hint of this tab's own write therefore costs
 * one extra read, which is the price of never missing a change.
 */
export function createNotesStore(dependencies: NotesDependencies) {
  const groupId = signal<string | null>(null)
  const notes = signal<readonly NoteItem[]>([])
  const loading = signal(false)
  const listError = signal<string | null>(null)
  const draftId = signal(dependencies.newId())
  const draft = signal<Draft>(EMPTY_DRAFT)
  const createErrors = signal<FormErrors>(NO_ERRORS)
  const creating = signal(false)
  const editing = signal<Edit | null>(null)
  const editErrors = signal<FormErrors>(NO_ERRORS)
  const saving = signal(false)
  const deleting = signal<string | null>(null)
  const moving = signal(false)
  /** The "Show deleted" filter is on: the list shows the deleted notes instead. */
  const showDeleted = signal(false)
  /** The group's deleted notes, newest first. Read only while `showDeleted` is on. */
  const deletedNotes = signal<readonly NoteItem[]>([])
  const deletedLoading = signal(false)
  /** The note being restored. */
  const restoring = signal<string | null>(null)
  /** Why the last restore failed, and the plan's refusal when the notes limit caused it. */
  const restoreError = signal<FormErrors>(NO_ERRORS)
  /** The note just deleted: the screen offers Undo for it until dismissed or taken. */
  const undo = signal<UndoOffer | null>(null)
  /** The notes list is on screen: an Undo that ends while it is not moves no focus. */
  const listShown = signal(false)
  /**
   * How the last Undo ended, for the screen to move focus: to the restored note's row, or to the
   * list's "More actions" when it failed. The screen clears it once focus has moved.
   */
  const undoOutcome = signal<{ id: string; restored: boolean } | null>(null)
  /** The refusal of the last move, shown beside the move button. */
  const moveError = signal<string | null>(null)
  /** The open note is not in the open group: it is gone, or it is in another group. */
  const missing = signal(false)
  /** The open note is in another of the person's groups, with this id. Set with `missing`. */
  const elsewhere = signal<string | null>(null)
  /** The note the page was last asked to open: a late answer about another note is dropped. */
  let openId: string | null = null
  /** The person typed text that no save or create has taken yet. */
  const unsaved = computed(() => {
    const edit = editing.value
    if (edit) {
      return edit.conflict || edit.title !== edit.base.title || edit.body !== edit.base.body
    }
    return draft.value.title !== "" || draft.value.body !== ""
  })
  let inFlight: Promise<void> | null = null
  let queued: Promise<void> | null = null

  async function readPages(forGroup: string, deleted: boolean): Promise<NoteItem[]> {
    const all: NoteItem[] = []
    let cursor: string | null = null
    for (let page = 0; page < MAX_PAGES; page++) {
      const result: NotePage = await dependencies.fetchPage(forGroup, cursor, deleted)
      all.push(...result.notes)
      cursor = result.nextCursor
      if (cursor === null) break
    }
    return all
  }

  async function readAll(forGroup: string): Promise<void> {
    const all = await readPages(forGroup, false)
    // The person may have opened another group while this read ran.
    if (groupId.value === forGroup) notes.value = all
    if (showDeleted.value) await readDeleted(forGroup)
  }

  async function readDeleted(forGroup: string): Promise<void> {
    const all = await readPages(forGroup, true)
    if (groupId.value === forGroup) deletedNotes.value = all
  }

  function start(): Promise<void> {
    const forGroup = groupId.value
    if (!forGroup) return Promise.resolve()
    loading.value = true
    inFlight = readAll(forGroup).finally(() => {
      inFlight = null
      loading.value = false
    })
    return inFlight
  }

  /**
   * Reads the open group's notes. A read already running may have started before the change that
   * asked for this one, so exactly one more read is queued behind it, shared by every call made
   * meanwhile. Rejects when the read fails.
   */
  function refresh(): Promise<void> {
    if (!inFlight) return start()
    queued ??= inFlight.catch(() => {}).then(() => {
      queued = null
      return start()
    })
    return queued
  }

  /** Reads and shows a failure under the list instead of rejecting. */
  async function load(): Promise<void> {
    listError.value = null
    try {
      await refresh()
    } catch (cause) {
      listError.value = describe(cause, NOTE_MESSAGES.load)
    }
  }

  /**
   * Turns the deleted notes' list on or off. Turning it on reads them from the server; a failure
   * shows under the list and leaves the filter on, with the list empty.
   */
  async function setShowDeleted(on: boolean): Promise<void> {
    showDeleted.value = on
    restoreError.value = NO_ERRORS
    if (!on) return
    const forGroup = groupId.value
    if (!forGroup) return
    deletedLoading.value = true
    listError.value = null
    try {
      await readDeleted(forGroup)
    } catch (cause) {
      listError.value = describe(cause, NOTE_MESSAGES.load)
    } finally {
      deletedLoading.value = false
    }
  }

  /** Shows what the device holds while the read runs, unless the read answered first. */
  async function showLocal(forGroup: string): Promise<void> {
    const local = await dependencies.readLocal?.(forGroup).catch(() => undefined)
    if (local && groupId.value === forGroup && loading.value && notes.value.length === 0) {
      notes.value = local
    }
  }

  /** Shows a group's notes, and the edit form of `noteId` when one is given. */
  async function open(nextGroupId: string, noteId: string | null): Promise<void> {
    if (groupId.value !== nextGroupId) {
      reset()
      groupId.value = nextGroupId
      openId = noteId
      void showLocal(nextGroupId)
      await load()
    } else openId = noteId
    if (noteId === null) {
      editing.value = null
      editErrors.value = NO_ERRORS
      missing.value = false
      elsewhere.value = null
      return
    }
    if (editing.value?.id === noteId) return
    editErrors.value = NO_ERRORS
    moveError.value = null
    missing.value = false
    elsewhere.value = null
    const known = notes.value.find((note) => note.id === noteId)
    if (known) {
      editing.value = toEdit(known)
      return
    }
    await reloadLatest(noteId)
  }

  /** The person's other group that holds the note, or `null` when there is none or it cannot be told. */
  async function locateElsewhere(noteId: string): Promise<string | null> {
    try {
      const found = await dependencies.locate?.(noteId)
      return found && found.groupId !== groupId.value ? found.groupId : null
    } catch (_error) {
      return null
    }
  }

  /** Rereads the edited note and starts the edit again from it, dropping what was typed. */
  async function reloadLatest(noteId = editing.value?.id): Promise<void> {
    const forGroup = groupId.value
    if (!forGroup || !noteId) return
    const stale = () => groupId.value !== forGroup || openId !== noteId
    try {
      const { note } = await dependencies.get(forGroup, noteId)
      editing.value = toEdit(note)
      editErrors.value = NO_ERRORS
      notes.value = notes.value.map((existing) => existing.id === note.id ? note : existing)
    } catch (cause) {
      // The person moved on while the read ran: the answer belongs to the earlier page.
      if (stale()) return
      editing.value = null
      if (noteCode(cause) === "NOTE_NOT_FOUND") {
        const other = await locateElsewhere(noteId)
        if (stale()) return
        elsewhere.value = other
        missing.value = true
      } else listError.value = describe(cause, NOTE_MESSAGES.load)
    }
  }

  /** Creates the note from the draft. Resolves the note once created, `null` when it was not. */
  async function create(): Promise<NoteItem | null> {
    const forGroup = groupId.value
    if (!forGroup || creating.value) return null
    const title = draft.value.title.trim()
    if (!title) {
      createErrors.value = { title: NOTE_MESSAGES.titleRequired, form: null }
      return null
    }
    creating.value = true
    createErrors.value = NO_ERRORS
    try {
      const { note } = await dependencies.create({
        groupId: forGroup,
        id: draftId.value,
        title,
        body: draft.value.body,
      })
      notes.value = [note, ...notes.value.filter((existing) => existing.id !== note.id)]
      draft.value = EMPTY_DRAFT
      draftId.value = dependencies.newId()
      return note
    } catch (cause) {
      createErrors.value = {
        title: null,
        form: describe(cause, NOTE_MESSAGES.create),
        plan: planRefusal(cause),
      }
      return null
    } finally {
      creating.value = false
    }
  }

  /** Saves the edit. Resolves `true` once saved, `false` when it was refused or failed. */
  async function save(): Promise<boolean> {
    const forGroup = groupId.value
    const edit = editing.value
    if (!forGroup || !edit || saving.value) return false
    const title = edit.title.trim()
    if (!title) {
      editErrors.value = { title: NOTE_MESSAGES.titleRequired, form: null }
      return false
    }
    saving.value = true
    editErrors.value = NO_ERRORS
    try {
      const { note } = await dependencies.update({
        groupId: forGroup,
        id: edit.id,
        title,
        body: edit.body,
        version: edit.version,
      })
      notes.value = notes.value.map((existing) => existing.id === note.id ? note : existing)
      editing.value = null
      return true
    } catch (cause) {
      const code = noteCode(cause)
      if (code === "VERSION_CONFLICT") {
        editing.value = { ...edit, conflict: true }
        editErrors.value = { title: null, form: NOTE_MESSAGES.conflict }
      } else {
        editErrors.value = {
          title: null,
          form: code === "NOTE_NOT_FOUND"
            ? NOTE_MESSAGES.gone
            : describe(cause, NOTE_MESSAGES.save),
        }
      }
      return false
    } finally {
      saving.value = false
    }
  }

  /** Drops what was typed into the create form, and starts a new note's id. */
  function discardDraft(): void {
    draft.value = EMPTY_DRAFT
    draftId.value = dependencies.newId()
    createErrors.value = NO_ERRORS
  }

  /** Deletes the note at the version the person saw. Resolves `true` once deleted, `false` when it was refused or failed. */
  async function remove(note: Pick<NoteItem, "id" | "version">): Promise<boolean> {
    const forGroup = groupId.value
    if (!forGroup || deleting.value) return false
    deleting.value = note.id
    listError.value = null
    const title = (notes.value.find((existing) => existing.id === note.id)?.title ??
      (editing.value?.id === note.id ? editing.value.base.title : null)) ?? ""
    try {
      await dependencies.delete({ groupId: forGroup, id: note.id, version: note.version })
      notes.value = notes.value.filter((existing) => existing.id !== note.id)
      editing.value = null
      undo.value = { id: note.id, title, until: Date.now() + UNDO_MS }
      restoreError.value = NO_ERRORS
      return true
    } catch (cause) {
      const code = noteCode(cause)
      listError.value = code === "VERSION_CONFLICT"
        ? NOTE_MESSAGES.deleteConflict
        : describe(cause, NOTE_MESSAGES.delete)
      // The page of this note offers the latest version; the list is read again.
      const edit = editing.value
      if (code === "VERSION_CONFLICT" && edit?.id === note.id) {
        editing.value = { ...edit, conflict: true }
      }
      if (code === "VERSION_CONFLICT" || code === "NOTE_NOT_FOUND") await refresh().catch(() => {})
      return false
    } finally {
      deleting.value = null
    }
  }

  /**
   * Brings a deleted note back. Resolves `true` once restored, `false` when it was refused or
   * failed (the reason is in `restoreError`). It needs the server and is never queued: a restore
   * made offline would be a write the person cannot see settle.
   */
  async function restore(id: string): Promise<boolean> {
    const forGroup = groupId.value
    if (!forGroup || restoring.value) return false
    restoring.value = id
    restoreError.value = NO_ERRORS
    try {
      const { note } = await dependencies.restore({ groupId: forGroup, id })
      deletedNotes.value = deletedNotes.value.filter((existing) => existing.id !== id)
      if (undo.value?.id === id) undo.value = null
      if (groupId.value === forGroup) {
        notes.value = [note, ...notes.value.filter((existing) => existing.id !== id)]
      }
      return true
    } catch (cause) {
      const code = noteCode(cause)
      restoreError.value = {
        title: null,
        form: code === "NOTE_NOT_FOUND"
          ? NOTE_MESSAGES.restoreGone
          : cause instanceof RealtimeRequestError
          ? describe(cause, NOTE_MESSAGES.restore)
          : NOTE_MESSAGES.restoreOffline,
        plan: planRefusal(cause),
      }
      // The deleted list is stale: another member restored or purged it first.
      if (code === "NOTE_NOT_FOUND") {
        if (undo.value?.id === id) undo.value = null
        if (showDeleted.value) await readDeleted(forGroup).catch(() => {})
      }
      return false
    } finally {
      restoring.value = null
    }
  }

  /** Takes back the delete the Undo toast offers. */
  async function undoDelete(): Promise<boolean> {
    const offer = undo.value
    if (!offer) return false
    undo.value = null
    const forGroup = groupId.value
    const restored = await restore(offer.id)
    // A person who switched group, or left the list, is somewhere else: focus must not follow.
    if (listShown.value && groupId.value === forGroup) {
      undoOutcome.value = { id: offer.id, restored }
    }
    return restored
  }

  function clearUndoOutcome(): void {
    undoOutcome.value = null
  }

  function dismissUndo(): void {
    undo.value = null
  }

  /**
   * Moves notes of the open group to another, all or none. Resolves `true` once moved, `false` when
   * it was refused or failed (the reason is in `moveError`). It needs the server and is never
   * queued: a move made offline would be a write the person cannot see settle.
   */
  async function move(toGroupId: string, noteIds: readonly string[]): Promise<boolean> {
    const forGroup = groupId.value
    if (!forGroup || moving.value) return false
    if (noteIds.length === 0) {
      moveError.value = NOTE_MESSAGES.moveNone
      return false
    }
    // Moving closes the note's page, which would drop what was typed: the person decides first.
    if (editing.value && unsaved.value && noteIds.includes(editing.value.id)) {
      moveError.value = NOTE_MESSAGES.moveUnsaved
      return false
    }
    moving.value = true
    moveError.value = null
    try {
      await dependencies.move({ groupId: forGroup, toGroupId, noteIds: [...noteIds] })
      const moved = new Set(noteIds)
      notes.value = notes.value.filter((existing) => !moved.has(existing.id))
      if (editing.value && moved.has(editing.value.id)) editing.value = null
      return true
    } catch (cause) {
      const code = noteCode(cause)
      moveError.value = code === "NOTE_NOT_FOUND"
        ? NOTE_MESSAGES.moveGone
        : cause instanceof RealtimeRequestError
        ? describe(cause, NOTE_MESSAGES.move)
        : NOTE_MESSAGES.moveOffline
      // The list is stale: another member changed it first.
      if (code === "NOTE_NOT_FOUND") await refresh().catch(() => {})
      return false
    } finally {
      moving.value = false
    }
  }

  function reset(): void {
    groupId.value = null
    notes.value = []
    loading.value = false
    listError.value = null
    draft.value = EMPTY_DRAFT
    draftId.value = dependencies.newId()
    createErrors.value = NO_ERRORS
    creating.value = false
    editing.value = null
    editErrors.value = NO_ERRORS
    saving.value = false
    deleting.value = null
    moving.value = false
    showDeleted.value = false
    deletedNotes.value = []
    deletedLoading.value = false
    restoring.value = null
    restoreError.value = NO_ERRORS
    undo.value = null
    undoOutcome.value = null
    moveError.value = null
    missing.value = false
    elsewhere.value = null
    openId = null
    inFlight = null
    queued = null
  }

  return {
    groupId,
    notes,
    loading,
    listError,
    draftId,
    draft,
    createErrors,
    creating,
    editing,
    editErrors,
    saving,
    deleting,
    moving,
    moveError,
    showDeleted,
    deletedNotes,
    deletedLoading,
    restoring,
    restoreError,
    undo,
    undoOutcome,
    listShown,
    missing,
    elsewhere,
    unsaved,
    open,
    refresh,
    reloadLatest,
    create,
    discardDraft,
    save,
    remove,
    restore,
    undoDelete,
    clearUndoOutcome,
    dismissUndo,
    setShowDeleted,
    move,
    reset,
  }
}

function toEdit(note: NoteItem): Edit {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    version: note.version,
    conflict: false,
    base: { title: note.title, body: note.body },
  }
}

/**
 * Restores through the calls port, or refuses at once when the server cannot be reached. A restore
 * is never queued, and the call's own retries would keep the person waiting about six seconds for
 * the same answer.
 */
export function restoreWhileReachable(
  input: { groupId: string; id: string },
  isOpen: () => boolean = canCall,
  send: (input: { groupId: string; id: string }) => Promise<{ note: NoteItem }> = (value) =>
    callCommand("note.restore", value),
): Promise<{ note: NoteItem }> {
  if (!isOpen()) return Promise.reject(new ConnectionLostError("the server cannot be reached"))
  return send(input)
}

/** The notes as the server serves them: reads over REST, writes through the calls port. */
const onlineNotes: NotesDependencies = {
  async fetchPage(groupId, cursor, deleted = false) {
    const query = new URLSearchParams({ limit: String(PAGE_LIMIT) })
    if (cursor) query.set("cursor", cursor)
    if (deleted) query.set("deleted", "true")
    const result = await apiRead<NotePage>(`/api/groups/${groupId}/notes?${query}`)
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  },
  get: (groupId, id) => callQuery("note.get", { groupId, id }),
  locate: (id) => callQuery("note.locate", { id }),
  create: (input) => callCommand("note.create", input),
  update: (input) => callCommand("note.update", input),
  delete: (input) => callCommand("note.delete", input),
  restore: (input) => restoreWhileReachable(input),
  move: (input) => callCommand("note.move", input),
  newId: () => crypto.randomUUID(),
}

/**
 * The page's own store: reads over REST (start-up and after a push), writes through the calls port, and
 * with the offline layer running, served from the device first and queued while offline.
 */
export const notesStore = createNotesStore(offlineNotes(onlineNotes, currentLayer))
