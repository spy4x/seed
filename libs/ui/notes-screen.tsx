// deno-lint-ignore-file ui-text/no-literal
import type { ComponentChildren, JSX, Ref } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { Avatar } from "@spy4x/preact-ui/avatar"
import { Button, buttonClasses } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { Checkbox } from "@spy4x/preact-ui/checkbox"
import { Dropdown, DropdownItem } from "@spy4x/preact-ui/dropdown"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { FilterBar, type FilterBarMenu } from "@spy4x/preact-ui/filter-bar"
import { OnDay, useFormat, When } from "@spy4x/preact-ui/format"
import { Select } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { Modal } from "@spy4x/preact-ui/modal"
import { IconEllipsisVertical, IconPlus } from "@spy4x/preact-icons"
import type { PlanRefusal } from "@domain/billing"
import { canMutateNotes, type GroupRole } from "@domain/groups"
import { NOTE_RESTORE_DAYS } from "@domain/notes"
import { PageAction, PageHeader } from "@spy4x/preact-ui/page-header"
import { PlanRefusalNotice } from "./plan-refusal.tsx"
import { NoteTags, type TagRow } from "./tag-parts.tsx"
import { type Navigate, NOTE_PATHS, SCREEN_PATHS, ScreenForm, TAG_PATHS } from "./progressive.tsx"
import {
  defaultDirection,
  filterNotes,
  NO_NOTE_FILTERS,
  NOTE_SORTS,
  type NoteFilters,
  type NoteSort,
} from "./notes-filter.ts"

/**
 * Where focus goes once the list changes: after the row of note `id` (at `index`) leaves, the row
 * now in its place; with no `id`, the header's "More actions".
 */
interface FocusAfter {
  id: string | null
  index: number
}

/** One note as the screen shows it. */
export interface NoteRow {
  id: string
  title: string
  body: string
  version: number
  /** When the note last changed, as an ISO timestamp; the row shows it as "3 hours ago". */
  updatedAt?: string
  /** When the note was created, as an ISO timestamp. */
  createdAt?: string
  /** The ids of the tags on the note. */
  tagIds?: readonly string[]
  /** The id of the member who created the note; `null` when that account is gone. */
  authorId?: string | null
  /**
   * The creator as the row names them: "You", their name, or "Former member". Left out while the
   * members are not read yet, and the row shows no author.
   */
  authorName?: string
  /** The author's own name for the avatar's initials, when `authorName` is "You". */
  authorAvatarName?: string
  /** The author's profile picture (#228), in place of the initials. */
  authorPictureUrl?: string
}

/** A member the "Author" menu offers. */
export interface NoteAuthor {
  id: string
  name: string
  /** The person themselves: listed first, as "You". */
  isYou?: boolean
}

/** What the person has typed into a note form. */
export interface NoteDraft {
  title: string
  body: string
  /** The ids of the tags on the note. */
  tagIds?: readonly string[]
}

/** The errors of one note form: on the title field, and for the form as a whole. */
export interface NoteFormErrors {
  title: string | null
  form: string | null
  /** The group's plan refused the write: shown as an upgrade prompt in place of `form`. */
  plan?: PlanRefusal | null
}

/** The group whose notes are shown. */
export interface NotesGroup {
  id: string
  name: string
  /** The person is an editor or above; a viewer sees the notes without any form. */
  canWrite: boolean
}

/** A group the person may move notes to: one where they are an editor or above. */
export interface MoveTarget {
  id: string
  name: string
}

/**
 * The groups, other than `currentGroupId`, where a person with these memberships may write notes:
 * the places a note can move to.
 */
export function moveTargetsOf(
  groups: readonly { id: string; name: string; role: GroupRole }[],
  currentGroupId: string,
): MoveTarget[] {
  return groups
    .filter((group) => group.id !== currentGroupId && canMutateNotes(group.role))
    .map((group) => ({ id: group.id, name: group.name }))
}

/** The overflow trigger: 44 px on a phone, where it is a touch target, 36 px from `sm` up. */
export const MENU_TRIGGER_CLASSES = buttonClasses("icon", "none", "size-11 sm:size-9")

/** How many tags a row shows before it folds the rest into "+N". */
const ROW_TAGS = 3

export interface NotesScreenProps {
  /** `null` while the group is not known yet (loading), or when the person is not a member. */
  group: NotesGroup | null
  notes: readonly NoteRow[]
  loading: boolean
  /** The error of the list itself, such as a failed read. */
  listError: string | null
  /**
   * The other groups the person may move notes to. Empty (or left out) hides every move, so a
   * person with nowhere to move to sees a plain list.
   */
  moveTargets?: readonly MoveTarget[]
  /** Moves notes to another group: one from its row's menu, or the ticked ones. */
  onMove?: (input: { toGroupId: string; noteIds: string[] }) => void
  moving?: boolean
  /** The refusal of the last move. */
  moveError?: string | null
  /**
   * Deletes a note from its row's menu at once: the app offers Undo in a toast, so there is no
   * confirmation. Left out, rows offer no delete.
   */
  onDelete?: (note: { id: string; version: number }) => void
  /** Copies the link to a note, from its row's menu. Left out, the menu offers no "Copy link". */
  onCopyLink?: (note: { id: string; title: string }) => void
  /**
   * The "Show deleted" filter is on: the list shows `deletedNotes`, each with a Restore button for
   * an editor. Left out, `onShowDeletedChange` hides the filter's menu entry.
   */
  showDeleted?: boolean
  onShowDeletedChange?: (on: boolean) => void
  deletedNotes?: readonly NoteRow[]
  deletedLoading?: boolean
  /** Restores a deleted note from its row. Left out, or for a viewer, rows offer no restore. */
  onRestore?: (note: { id: string }) => void
  /** The id of the note being restored: its button is busy and the others wait. */
  restoring?: string | null
  /** Why the last restore failed; a plan refusal shows as an upgrade prompt. */
  restoreError?: NoteFormErrors | null
  /**
   * How an Undo of a delete ended. The toast that offers it lives outside the screen and vanishes
   * at once, so the screen moves focus: to the restored note's row, or, when the restore failed,
   * to "More actions".
   */
  undoOutcome?: { id: string; restored: boolean } | null
  /** Called once focus has moved after an Undo, so the app forgets the outcome. */
  onUndoFocused?: () => void
  /** The group's tags: shown on the rows and offered as a filter. Left out, notes show no tags. */
  tags?: readonly TagRow[]
  /**
   * The search, the filters and the order. The app keeps them in the address; the screen filters
   * the list it was given, so they work on the device's copy offline. Left out with
   * `onFiltersChange`, there is no filter bar.
   */
  filters?: NoteFilters
  /** Called with the whole new set when the person changes the search, a filter or the order. */
  onFiltersChange?: (filters: NoteFilters) => void
  /** Clears the tags, author and "Created by me" filters at once, as one change of the address. */
  onClearFilters?: () => void
  /** The members the "Author" menu offers. Left out or empty, there is no "Author" menu. */
  authors?: readonly NoteAuthor[]
  /** The person's own id, for "Created by me". Left out, there is no such toggle. */
  youId?: string | null
  navigate?: Navigate
  /** Drawn right under the page header, above the list: the app's first-steps card. */
  intro?: ComponentChildren
}

/** "1 note", "42 notes". */
function noteCount(count: number): string {
  return count === 1 ? "1 note" : `${count} notes`
}

/**
 * The notes of one group, as a list of rows under a bar to search, filter and sort them. Writing
 * happens on the note's own page (`NoteEditorScreen`): "New note" and each note's title open it.
 * Each row names its author, when it changed and was created, and its tags, and has a menu to open
 * it, move it to another group, copy its link or delete it (Undo comes from the app's toast).
 * "Select notes" in the header's menu ticks several notes at once and moves them together, all or
 * none. "Show deleted notes" in the same menu swaps the list for the deleted notes, which an editor
 * can restore.
 */
export function NotesScreen(props: NotesScreenProps): JSX.Element {
  const { group, loading, navigate } = props
  const allNotes = props.notes
  const tags = props.tags ?? []
  const filters = props.filters ?? NO_NOTE_FILTERS
  const notes = filterNotes(allNotes, filters, {
    youId: props.youId ?? null,
    knownTagIds: tags.map((tag) => tag.id),
  })
  const moveTargets = group?.canWrite && props.onMove ? props.moveTargets ?? [] : []
  const onDelete = group?.canWrite ? props.onDelete : undefined
  const deletedMode = Boolean(props.showDeleted && props.onShowDeletedChange)
  const deletedNotes = props.deletedNotes ?? []
  const onRestore = group?.canWrite ? props.onRestore : undefined
  const rows = deletedMode ? deletedNotes : notes
  const [selecting, setSelecting] = useState(false)
  const [ticked, setTicked] = useState<readonly string[]>([])
  const [moving, setMoving] = useState<NoteRow | null>(null)
  const page = useRef<HTMLDivElement>(null)
  const [focusAfter, setFocusAfter] = useState<FocusAfter | null>(null)

  // A finished move with no refusal ends the selection: the ticked notes have left the list.
  const wasMoving = useRef(props.moving)
  useEffect(() => {
    if (wasMoving.current && !props.moving && !props.moveError) {
      if (selecting) setFocusAfter({ id: null, index: 0 })
      setSelecting(false)
      setTicked([])
    }
    wasMoving.current = props.moving
  }, [props.moving, props.moveError])

  // A row that left the list, or a selection that ended, would leave focus on the page's body.
  // Focus goes to the next row's menu, else the previous row's, else the header's "More actions".
  useEffect(() => {
    if (!focusAfter) return
    // A refused delete or move keeps the note; a later live change must not pull focus to it.
    if (props.moveError || props.listError || props.restoreError?.form) return setFocusAfter(null)
    if (focusAfter.id && rows.some((note) => note.id === focusAfter.id)) return
    const root = page.current
    const menus = root?.querySelectorAll<HTMLElement>(
      deletedMode ? "[data-e2e=note-restore]" : "[data-e2e=note-menu]",
    )
    const row = focusAfter.id && menus
      ? menus[focusAfter.index] ?? menus[focusAfter.index - 1]
      : undefined
    ;(row ?? root?.querySelector<HTMLElement>("[data-e2e=notes-menu]"))?.focus()
    setFocusAfter(null)
  }, [focusAfter, rows, props.moveError, props.listError, props.restoreError])

  // Undo's toast is gone by now and focus would fall to the page's body.
  const { undoOutcome, onUndoFocused } = props
  useEffect(() => {
    if (!undoOutcome) return
    const root = page.current
    const row = undoOutcome.restored
      ? root?.querySelector<HTMLElement>(`[data-e2e=note-${undoOutcome.id}] a`)
      : null
    ;(row ?? root?.querySelector<HTMLElement>("[data-e2e=notes-menu]"))?.focus()
    onUndoFocused?.()
  }, [undoOutcome])

  if (!group) {
    return (
      <ListPage>
        <PageHeader title="Notes" />
        {props.intro}
        <ListEmpty
          title={loading ? "Loading the group…" : "This group does not exist."}
          action={!loading && (
            <Button href={SCREEN_PATHS.groups} navigate={navigate} variant="outline">
              Back to groups
            </Button>
          )}
        />
      </ListPage>
    )
  }

  const canSelect = moveTargets.length > 0 && notes.length > 0
  const shown = ticked.filter((id) => notes.some((note) => note.id === id))
  const stopSelecting = () => {
    setSelecting(false)
    setTicked([])
    setFocusAfter({ id: null, index: 0 })
  }
  const leaving = (note: NoteRow) =>
    setFocusAfter({ id: note.id, index: rows.findIndex((row) => row.id === note.id) })
  const change = (next: Partial<NoteFilters>) => props.onFiltersChange?.({ ...filters, ...next })
  const showBar = !deletedMode && !selecting && props.onFiltersChange !== undefined &&
    allNotes.length > 0

  const list = (
    <ListCard dataE2E="note-list">
      {notes.map((note) => (
        <NoteItem
          key={note.id}
          note={note}
          tags={tags}
          navigate={navigate}
          selecting={selecting}
          ticked={shown.includes(note.id)}
          onTick={(on) =>
            setTicked((ids) => on ? [...ids, note.id] : ids.filter((id) => id !== note.id))}
          menu={!selecting && (
            <NoteRowMenu
              note={note}
              navigate={navigate}
              onMove={moveTargets.length > 0 ? () => setMoving(note) : undefined}
              onCopyLink={props.onCopyLink && (() => props.onCopyLink?.(note))}
              onDelete={onDelete &&
                (() => {
                  leaving(note)
                  onDelete({ id: note.id, version: note.version })
                })}
              disabled={props.moving}
            />
          )}
        />
      ))}
    </ListCard>
  )

  const deletedList = (
    <ListCard dataE2E="deleted-note-list">
      {deletedNotes.map((note) => (
        <li
          key={note.id}
          class="flex min-h-14 items-center gap-3 px-4 py-3 sm:px-6"
          data-e2e={`note-${note.id}`}
        >
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <h2 class={ROW_TITLE} data-e2e="note-item-title">{note.title}</h2>
            {note.updatedAt && (
              <p class="text-sm text-muted">
                Deleted <When at={note.updatedAt} />
              </p>
            )}
          </div>
          {onRestore && (
            <Button
              type="button"
              variant="outline"
              class="min-h-11 shrink-0"
              aria-label={`Restore ${note.title}`}
              busy={props.restoring === note.id}
              busyLabel="Restoring…"
              disabled={Boolean(props.restoring)}
              data-e2e="note-restore"
              onClick={() => {
                leaving(note)
                onRestore({ id: note.id })
              }}
            >
              Restore
            </Button>
          )}
        </li>
      ))}
    </ListCard>
  )

  const query = filters.q.trim()
  const emptyList = query !== ""
    ? (
      <ListEmpty
        title={`No notes match "${query}"`}
        description="Check the spelling or search for fewer words."
        action={
          <Button
            type="button"
            variant="outline"
            onClick={() => change({ q: "" })}
            data-e2e="notes-search-clear"
          >
            Clear search
          </Button>
        }
      />
    )
    : (
      <ListEmpty
        title="No notes match these filters"
        description="Try fewer tags or another author."
        action={
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              props.onClearFilters
                ? props.onClearFilters()
                : change({ tagIds: [], match: "any", author: null, mine: false })}
            data-e2e="notes-filters-clear"
          >
            Clear filters
          </Button>
        }
      />
    )

  return (
    <ListPage pageRef={page}>
      <PageHeader
        title="Notes"
        subtitle={group.name}
        subtitleDataE2E="notes-group"
        action={group.canWrite && (
          <PageAction
            label="New note"
            Icon={IconPlus}
            href={NOTE_PATHS.new}
            navigate={navigate}
            dataE2E="note-new"
          />
        )}
        menuDataE2E="notes-menu"
        menu={
          <>
            {props.onShowDeletedChange && !selecting && (
              <DropdownItem
                onClick={() => props.onShowDeletedChange?.(!deletedMode)}
                dataE2E="notes-show-deleted"
              >
                {deletedMode ? "Show notes" : "Show deleted notes"}
              </DropdownItem>
            )}
            {canSelect && !selecting && !deletedMode && (
              <DropdownItem onClick={() => setSelecting(true)} dataE2E="notes-select">
                Select notes
              </DropdownItem>
            )}
            <DropdownItem href={TAG_PATHS.list} navigate={navigate} dataE2E="notes-tags">
              Manage tags
            </DropdownItem>
          </>
        }
      />
      {props.intro}
      <Stack>
        {!group.canWrite && (
          <p class="text-sm text-muted" data-e2e="notes-read-only">
            You can read these notes. Only an editor can change them.
          </p>
        )}
        {showBar && (
          <NotesFilterBar
            filters={filters}
            onChange={change}
            onClear={props.onClearFilters}
            notes={allNotes}
            tags={tags}
            authors={props.authors ?? []}
            youId={props.youId ?? null}
            count={noteCount(notes.length)}
          />
        )}
        <ErrorState message={props.listError} />
        {!selecting && !deletedMode && <ErrorState message={props.moveError ?? null} />}
        {deletedMode && (
          <div
            class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-subtle bg-surface p-3"
            data-e2e="notes-deleted-banner"
          >
            <p class="min-w-0 flex-1 text-sm">
              Deleted notes stay here for {NOTE_RESTORE_DAYS} days, then they are removed for good.
            </p>
            <Button
              type="button"
              variant="ghost"
              class="min-h-11"
              onClick={() => props.onShowDeletedChange?.(false)}
              data-e2e="notes-show-live"
            >
              Back to notes
            </Button>
          </div>
        )}
        {props.restoreError?.plan
          ? (
            <PlanRefusalNotice
              groupId={group.id}
              refusal={props.restoreError.plan}
              navigate={navigate}
            />
          )
          : <ErrorState message={props.restoreError?.form ?? null} />}
        {deletedMode
          ? deletedNotes.length === 0
            ? (
              <ListEmpty
                title={props.deletedLoading ? "Loading deleted notes…" : "No deleted notes"}
              />
            )
            : deletedList
          : allNotes.length > 0 && notes.length === 0
          ? emptyList
          : notes.length === 0
          ? (
            <ListEmpty
              title={loading ? "Loading notes…" : "No notes yet"}
              description={loading || !group.canWrite
                ? undefined
                : `Notes you write here are shared with everyone in ${group.name}.`}
              action={!loading && group.canWrite && (
                <Button href={NOTE_PATHS.new} navigate={navigate} data-e2e="note-new-empty">
                  New note
                </Button>
              )}
            />
          )
          : selecting
          ? (
            <ScreenForm
              pending={props.moving}
              onSubmit={(data) =>
                props.onMove?.({
                  toGroupId: String(data.get("toGroupId") ?? ""),
                  noteIds: data.getAll("noteIds").map(String),
                })}
            >
              <Stack>
                {list}
                <SelectionBar
                  count={shown.length}
                  moveTargets={moveTargets}
                  moving={props.moving}
                  moveError={props.moveError ?? null}
                  onCancel={stopSelecting}
                />
              </Stack>
            </ScreenForm>
          )
          : list}
      </Stack>
      {moving && (
        <MoveNoteDialog
          note={moving}
          moveTargets={moveTargets}
          onMove={(toGroupId) => {
            setMoving(null)
            leaving(moving)
            props.onMove?.({ toGroupId, noteIds: [moving.id] })
          }}
          // The dialog gives focus back to the row's menu it was opened from.
          onCancel={() => setMoving(null)}
        />
      )}
    </ListPage>
  )
}

/**
 * The bar over the list: search, the "Tags" and "Author" menus, "Created by me", the order, the
 * active filters as chips and how many notes show.
 */
function NotesFilterBar(
  { filters, onChange, onClear, notes, tags, authors, youId, count }: {
    filters: NoteFilters
    onChange: (next: Partial<NoteFilters>) => void
    onClear?: () => void
    notes: readonly NoteRow[]
    tags: readonly TagRow[]
    authors: readonly NoteAuthor[]
    youId: string | null
    count: string
  },
): JSX.Element {
  const menus: FilterBarMenu[] = []
  if (tags.length > 0) {
    menus.push({
      id: "tags",
      label: "Tags",
      chipLabel: "Tag",
      multiple: true,
      options: tags.map((tag) => ({
        value: tag.id,
        label: tag.name,
        count: notes.filter((note) => note.tagIds?.includes(tag.id)).length,
      })),
      value: filters.tagIds.filter((id) => tags.some((tag) => tag.id === id)),
      onChange: (tagIds) => onChange({ tagIds }),
      headerLabel: "Show notes with",
      header: (
        <>
          <DropdownItem
            checked={filters.match === "any"}
            keepOpen
            onClick={() => onChange({ match: "any" })}
            dataE2E="notes-tags-any"
          >
            Any of these tags
          </DropdownItem>
          <DropdownItem
            checked={filters.match === "all"}
            keepOpen
            onClick={() => onChange({ match: "all" })}
            dataE2E="notes-tags-all"
          >
            All of these tags
          </DropdownItem>
        </>
      ),
    })
  }
  const you = authors.find((author) => author.isYou)
  const others = authors
    .filter((author) => !author.isYou)
    .sort((a, b) => a.name.localeCompare(b.name))
  if (authors.length > 0) {
    menus.push({
      id: "author",
      label: "Author",
      anyLabel: "Anyone",
      options: [
        ...(you ? [{ value: you.id, label: "You" }] : []),
        ...others.map((author) => ({ value: author.id, label: author.name })),
      ],
      value: filters.author,
      onChange: (author) => onChange({ author }),
    })
  }
  return (
    <div data-e2e="notes-filter-bar">
      <FilterBar
        search={{
          value: filters.q,
          onChange: (q) => onChange({ q }),
          label: "Search notes",
        }}
        filters={menus}
        toggles={youId === null ? [] : [{
          id: "mine",
          label: "Created by me",
          pressed: filters.mine,
          onChange: (mine) => onChange({ mine }),
        }]}
        sort={{
          options: [...NOTE_SORTS],
          value: filters.sort,
          // A new order starts in its own direction, so Title after a date is not Z–A.
          onChange: (sort) =>
            onChange({ sort: sort as NoteSort, direction: defaultDirection(sort as NoteSort) }),
          direction: filters.direction,
          onDirectionChange: (direction) => onChange({ direction }),
        }}
        onClear={onClear}
        count={<span data-e2e="notes-count">{count}</span>}
      />
    </div>
  )
}

/**
 * The page's content, in the column the app's frame sets: never a width of its own. The header and
 * the content under it sit the page's gap apart.
 */
function ListPage(
  { children, pageRef }: { children?: ComponentChildren; pageRef?: Ref<HTMLDivElement> },
): JSX.Element {
  return <div class="flex flex-col gap-8" ref={pageRef}>{children}</div>
}

/** A list row's title: up to two lines, so a phone shows a long title instead of cutting it. */
const ROW_TITLE = "line-clamp-2 break-words text-sm font-medium"

/**
 * A list: one card, its rows split by a quiet line. The card never clips (`overflow-hidden`), so a
 * row's menu opens over the rows below it instead of being cut off; the first and last rows round
 * their own corners so a hover background still follows the card's.
 */
export function ListCard(
  { children, dataE2E }: { children?: ComponentChildren; dataE2E: string },
): JSX.Element {
  return (
    <Card>
      <ul
        class="divide-y divide-subtle *:first:rounded-t-[var(--radius-primary,0.5rem)] *:last:rounded-b-[var(--radius-primary,0.5rem)]"
        data-e2e={dataE2E}
      >
        {children}
      </ul>
    </Card>
  )
}

/**
 * What a list shows while it has no rows (loading, empty, or filtered to nothing): `EmptyState`
 * inside the list's own card, without its dashed border, so it reads as part of the page.
 */
export function ListEmpty(
  { title, description, action }: {
    title: string
    description?: string
    action?: ComponentChildren
  },
): JSX.Element {
  return (
    <Card>
      <EmptyState
        headingLevel={2}
        title={title}
        description={description}
        action={action}
        inset
      />
    </Card>
  )
}

/**
 * The bar under the list while notes are being ticked: how many are ticked, and once any are, the
 * group to move them to and the button that does. From `md` up it is sticky, so it stays in reach on
 * a long list. Below `md` it stays in the flow: the phone tab bar is pinned to the same bottom edge
 * and would cover a sticky bar.
 */
function SelectionBar(
  { count, moveTargets, moving, moveError, onCancel }: {
    count: number
    moveTargets: readonly MoveTarget[]
    moving?: boolean
    moveError: string | null
    onCancel: () => void
  },
): JSX.Element {
  return (
    <div
      class="flex flex-col gap-3 md:sticky md:bottom-0 rounded-lg border border-subtle bg-surface p-3 shadow-sm"
      data-e2e="notes-move"
    >
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p class="min-w-0 flex-1 text-sm font-medium" aria-live="polite">
          {count === 0 ? "Tick the notes to move" : `${count} selected`}
        </p>
        <Button
          type="button"
          variant="ghost"
          class="sm:order-last"
          onClick={onCancel}
          data-e2e="notes-select-cancel"
        >
          Cancel
        </Button>
        {count > 0 && (
          <div class="flex w-full items-center gap-3 sm:w-auto">
            <label class="sr-only" for="notes-move-to">Move to group</label>
            <Select
              id="notes-move-to"
              name="toGroupId"
              data-e2e="notes-move-to"
              class="min-w-0 flex-1 sm:w-auto sm:flex-none"
              options={moveTargets.map((target) => ({ value: target.id, label: target.name }))}
            />
            <Button
              type="submit"
              data-e2e="notes-move-submit"
              busy={moving}
              busyLabel="Moving…"
            >
              Move
            </Button>
          </div>
        )}
      </div>
      <ErrorState message={moveError} />
    </div>
  )
}

/**
 * A moment as "Updated 3 hours ago" or "Created 12 Mar 2026". Its hover text is the exact moment,
 * and a screen reader hears the exact moment too, not only the rough distance.
 */
function Stamp(
  { label, at, day, class: className }: {
    label: string
    at: string
    /** Shows the calendar day instead of the distance from now. */
    day?: boolean
    class?: string
  },
): JSX.Element {
  const format = useFormat()
  return (
    <span class={className}>
      <span aria-hidden="true">
        {label} {day ? <OnDay at={at} /> : <When at={at} />}
      </span>
      <span class="sr-only">{label} {format.exact(at)}</span>
    </span>
  )
}

/**
 * One note's row: its title (two lines at most), then who created it, when it changed and its
 * tags; from `sm` up the dates sit at the right, "Updated" over "Created". A note that never
 * changed after it was made says "Created" on a phone.
 */
function NoteItem(
  { note, tags, navigate, selecting, ticked, onTick, menu }: {
    note: NoteRow
    tags: readonly TagRow[]
    navigate?: Navigate
    selecting: boolean
    ticked: boolean
    onTick: (on: boolean) => void
    menu: ComponentChildren
  },
): JSX.Element {
  const edited = note.updatedAt !== undefined && note.updatedAt !== note.createdAt
  const phoneStamp = edited
    ? { label: "Updated", at: note.updatedAt }
    : { label: "Created", at: note.createdAt ?? note.updatedAt }
  const summary = (
    <div class="flex min-w-0 flex-1 gap-4">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <h2 class={ROW_TITLE} data-e2e="note-item-title">
          {selecting ? note.title : (
            <Link
              href={NOTE_PATHS.note(note.id)}
              navigate={navigate}
              class="block min-h-6 text-foreground after:absolute after:inset-0 focus-visible:outline-hidden focus-visible:after:ring-2 focus-visible:after:ring-focus focus-visible:after:ring-inset"
            >
              {note.title}
            </Link>
          )}
        </h2>
        {
          // The meta line: the author, when it changed (on a phone), then its tags.
        }
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          {
            // The author and, on a phone, the time stay on one line: a long name truncates rather
            // than leave the separator hanging at the end of a line.
          }
          <span class="flex min-w-0 max-w-full items-center gap-2 whitespace-nowrap">
            {note.authorName && (
              <span class="flex min-w-0 items-center gap-2">
                <Avatar
                  name={note.authorAvatarName ?? note.authorName}
                  src={note.authorPictureUrl}
                  alt=""
                  size="xs"
                  class="size-5 text-[10px]"
                />
                <span class="truncate" data-e2e="note-author">{note.authorName}</span>
              </span>
            )}
            {note.authorName && phoneStamp.at && (
              <span aria-hidden="true" class="sm:hidden">
                ·
              </span>
            )}
            {phoneStamp.at && (
              <Stamp label={phoneStamp.label} at={phoneStamp.at} class="shrink-0 sm:hidden" />
            )}
          </span>
          <NoteTags tagIds={note.tagIds} tags={tags} max={ROW_TAGS} />
        </div>
      </div>
      <div class="hidden shrink-0 flex-col items-end gap-1 text-right text-sm text-muted sm:flex">
        {note.updatedAt && <Stamp label="Updated" at={note.updatedAt} />}
        {note.createdAt && <Stamp label="Created" at={note.createdAt} day />}
      </div>
    </div>
  )
  return (
    <li
      class="flex min-h-14 items-stretch transition-colors hover:bg-hover"
      data-e2e={`note-${note.id}`}
    >
      {selecting
        // While selecting, the whole row is the tick box's label: a tap anywhere on it ticks.
        ? (
          <Checkbox
            name="noteIds"
            value={note.id}
            checked={ticked}
            onChange={(event) => onTick(event.currentTarget.checked)}
            aria-label={`Tick ${note.title}`}
            labelClass="flex min-h-14 w-full cursor-pointer px-4 py-3 sm:px-6"
            data-e2e="note-select"
          >
            {summary}
          </Checkbox>
        )
        : (
          // Two areas side by side that never overlap: the title's link covers the summary (its
          // `after:` box stops at the summary's edge) and the menu has a column of its own, 8 px
          // clear of it.
          <>
            <div
              class={`relative flex min-w-0 flex-1 py-3 pl-4 sm:pl-6 ${
                menu ? "pr-2" : "pr-4 sm:pr-6"
              }`}
            >
              {summary}
            </div>
            {menu && <div class="flex shrink-0 items-center px-2 sm:pr-4">{menu}</div>}
          </>
        )}
    </li>
  )
}

/** A quiet line between a menu's everyday items and its destructive one. */
const MENU_DIVIDER = <div role="separator" class="my-1 border-t border-subtle" />

/**
 * A row's menu: open the note, move it to another group (which asks where), copy its link, and,
 * after a divider, delete it.
 */
function NoteRowMenu(
  { note, navigate, onMove, onCopyLink, onDelete, disabled }: {
    note: NoteRow
    navigate?: Navigate
    onMove?: () => void
    onCopyLink?: () => void
    onDelete?: () => void
    disabled?: boolean
  },
): JSX.Element {
  return (
    <Dropdown
      trigger={<IconEllipsisVertical class="size-5" />}
      triggerLabel={`Actions for ${note.title}`}
      triggerClasses={MENU_TRIGGER_CLASSES}
      triggerDataE2E="note-menu"
    >
      <DropdownItem href={NOTE_PATHS.note(note.id)} navigate={navigate} dataE2E="note-open">
        Open
      </DropdownItem>
      {onMove && (
        <DropdownItem onClick={onMove} disabled={disabled} dataE2E="note-move">
          Move to group…
        </DropdownItem>
      )}
      {onCopyLink && (
        <DropdownItem onClick={onCopyLink} dataE2E="note-copy-link">Copy link</DropdownItem>
      )}
      {onDelete && MENU_DIVIDER}
      {onDelete && (
        <DropdownItem onClick={onDelete} danger dataE2E="note-delete">Delete</DropdownItem>
      )}
    </Dropdown>
  )
}

/**
 * Asks which group a note moves to: one button per group the person may write in. A press moves
 * the note at once; Cancel, Escape or the backdrop keeps it where it is.
 */
export function MoveNoteDialog(
  { note, moveTargets, onMove, onCancel }: {
    note: { title: string }
    moveTargets: readonly MoveTarget[]
    onMove: (toGroupId: string) => void
    onCancel: () => void
  },
): JSX.Element {
  return (
    <Modal
      open
      title="Move to group"
      cancelLabel="Cancel"
      onClose={onCancel}
      ariaDescribedBy="note-move-question"
      dataE2E="note-move-dialog"
      footer={
        <Button type="button" variant="ghost" onClick={onCancel} data-e2e="note-move-cancel">
          Cancel
        </Button>
      }
    >
      <Stack gap="md">
        <p id="note-move-question" class="text-sm text-muted">
          Choose the group "{note.title}" moves to. Everyone in that group will see it.
        </p>
        <ul class="flex flex-col gap-2">
          {moveTargets.map((target) => (
            <li key={target.id}>
              <Button
                type="button"
                variant="outline"
                class="min-h-11 w-full justify-start sm:min-h-9"
                onClick={() => onMove(target.id)}
                data-e2e="note-move-target"
              >
                {target.name}
              </Button>
            </li>
          ))}
        </ul>
      </Stack>
    </Modal>
  )
}
