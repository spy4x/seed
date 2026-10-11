import type { ComponentChildren, JSX, Ref } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { Button, buttonClasses } from "@spy4x/preact-ui/button"
import { Checkbox } from "@spy4x/preact-ui/checkbox"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { Dropdown, DropdownItem } from "@spy4x/preact-ui/dropdown"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Select } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { IconEllipsisVertical, IconPlus } from "@spy4x/preact-icons"
import { timeAgo } from "@spy4x/platform/universal/time"
import type { PlanRefusal } from "@domain/billing"
import { canMutateNotes, type GroupRole } from "@domain/groups"
import { NOTE_RESTORE_DAYS } from "@domain/notes"
import { PageAction, PageHeader } from "@spy4x/preact-ui/page-header"
import { PlanRefusalNotice } from "./plan-refusal.tsx"
import { NoteTags, TagChips, type TagRow } from "./tag-parts.tsx"
import { type Navigate, NOTE_PATHS, SCREEN_PATHS, ScreenForm, TAG_PATHS } from "./progressive.tsx"

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
  /** The ids of the tags on the note. */
  tagIds?: readonly string[]
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

/**
 * A menu item that opens a page of the app: followed through `navigate` when the app gives one,
 * as a plain link otherwise. `DropdownItem` takes no `navigate`, so its link would load the page.
 */
export function NavigateItem(
  { href, navigate, dataE2E, children }: {
    href: string
    navigate?: Navigate
    dataE2E?: string
    children: ComponentChildren
  },
): JSX.Element {
  return navigate
    ? <DropdownItem onClick={() => navigate(href)} dataE2E={dataE2E}>{children}</DropdownItem>
    : <DropdownItem href={href} dataE2E={dataE2E}>{children}</DropdownItem>
}

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
  /** Deletes a note from its row's menu, after the person confirms. Left out, rows offer no delete. */
  onDelete?: (note: { id: string; version: number }) => void
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
   * The tags the list is narrowed to: a note shows only when it has all of them. The app keeps
   * them in the address, and the screen filters the list it was given, so it works offline.
   */
  tagFilter?: readonly string[]
  onTagFilterChange?: (ids: string[]) => void
  navigate?: Navigate
}

/**
 * The notes of one group, as a list of rows. Writing happens on the note's own page
 * (`NoteEditorScreen`): "New note" and each note's title open it. Each row has a menu to move the
 * note to another group or delete it, the delete behind a confirmation. "Select notes" in the
 * header's menu ticks several notes at once and moves them together, all or none. "Show deleted
 * notes" in the same menu swaps the list for the deleted notes, which an editor can restore.
 */
export function NotesScreen(props: NotesScreenProps): JSX.Element {
  const { group, loading, navigate } = props
  const allNotes = props.notes
  const tags = props.tags ?? []
  // A filter that names a tag now gone would hide every note: it only counts tags that exist.
  const activeFilter = tags.length === 0
    ? []
    : (props.tagFilter ?? []).filter((id) => tags.some((tag) => tag.id === id))
  const notes = activeFilter.length === 0
    ? allNotes
    : allNotes.filter((note) => activeFilter.every((id) => note.tagIds?.includes(id)))
  const moveTargets = group?.canWrite && props.onMove ? props.moveTargets ?? [] : []
  const onDelete = group?.canWrite ? props.onDelete : undefined
  const deletedMode = Boolean(props.showDeleted && props.onShowDeletedChange)
  const deletedNotes = props.deletedNotes ?? []
  const onRestore = group?.canWrite ? props.onRestore : undefined
  const rows = deletedMode ? deletedNotes : notes
  const [selecting, setSelecting] = useState(false)
  const [ticked, setTicked] = useState<readonly string[]>([])
  const [deleting, setDeleting] = useState<NoteRow | null>(null)
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
        <EmptyState
          headingLevel={2}
          title={loading ? "Loading the group..." : "This group was not found."}
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

  const list = (
    <ul
      class="divide-y divide-subtle overflow-hidden rounded-lg border border-subtle bg-surface"
      data-e2e="note-list"
    >
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
          menu={!selecting && (moveTargets.length > 0 || onDelete) && (
            <NoteRowMenu
              note={note}
              moveTargets={moveTargets}
              onMove={props.onMove &&
                ((toGroupId) => {
                  leaving(note)
                  props.onMove?.({ toGroupId, noteIds: [note.id] })
                })}
              onDelete={onDelete && (() => setDeleting(note))}
              disabled={props.moving}
            />
          )}
        />
      ))}
    </ul>
  )

  const deletedList = (
    <ul
      class="divide-y divide-subtle overflow-hidden rounded-lg border border-subtle bg-surface"
      data-e2e="deleted-note-list"
    >
      {deletedNotes.map((note) => (
        <li
          key={note.id}
          class="flex min-h-16 items-center gap-3 px-4 py-3"
          data-e2e={`note-${note.id}`}
        >
          <div class="min-w-0 flex-1">
            <h2 class="truncate text-sm font-medium" data-e2e="note-item-title">{note.title}</h2>
            {note.updatedAt && (
              <p class="text-xs text-muted">
                Deleted <time dateTime={note.updatedAt}>{timeAgo(note.updatedAt)}</time>
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
              busyLabel="Restoring..."
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
    </ul>
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
                Select notes to move
              </DropdownItem>
            )}
            <NavigateItem href={TAG_PATHS.list} navigate={navigate} dataE2E="notes-tags">
              Manage tags
            </NavigateItem>
            <NavigateItem href={SCREEN_PATHS.groups} navigate={navigate} dataE2E="notes-groups">
              All groups
            </NavigateItem>
          </>
        }
      />
      {!group.canWrite && (
        <p class="text-sm text-muted" data-e2e="notes-read-only">
          You can read these notes. Only an editor can change them.
        </p>
      )}
      <ErrorState message={props.listError} />
      {!selecting && !deletedMode && <ErrorState message={props.moveError ?? null} />}
      {!deletedMode && !selecting && tags.length > 0 && props.onTagFilterChange && (
        <TagChips
          tags={tags}
          value={activeFilter}
          onChange={props.onTagFilterChange}
          label="Filter by tag"
          dataE2E="notes-tag-filter"
        />
      )}
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
            <EmptyState
              headingLevel={2}
              title={props.deletedLoading ? "Loading deleted notes..." : "No deleted notes."}
            />
          )
          : deletedList
        : allNotes.length > 0 && notes.length === 0
        ? (
          <EmptyState
            headingLevel={2}
            title="No notes have all these tags."
            action={
              <Button
                type="button"
                variant="outline"
                onClick={() => props.onTagFilterChange?.([])}
                data-e2e="notes-tag-filter-clear"
              >
                Clear the filter
              </Button>
            }
          />
        )
        : notes.length === 0
        ? (
          <EmptyState
            headingLevel={2}
            title={loading ? "Loading notes..." : "No notes yet."}
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
      {deleting && (
        <ConfirmDialog
          title="Delete this note?"
          message={`"${deleting.title}" will be deleted for everyone in ${group.name}.`}
          confirmLabel="Delete"
          cancelLabel="Keep it"
          tone="danger"
          dataE2E="note-delete-dialog"
          onConfirm={() => {
            setDeleting(null)
            leaving(deleting)
            onDelete?.({ id: deleting.id, version: deleting.version })
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </ListPage>
  )
}

/** The list page's column: the full content width, about 64 rem. */
function ListPage(
  { children, pageRef }: { children?: ComponentChildren; pageRef?: Ref<HTMLDivElement> },
): JSX.Element {
  return (
    <div class="mx-auto w-full max-w-5xl" ref={pageRef}>
      <Stack gap="lg">{children}</Stack>
    </div>
  )
}

/**
 * The bar under the list while notes are being ticked: how many are ticked, and once any are, the
 * group to move them to and the button that does. Sticky, so it stays in reach on a long list.
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
      class="sticky bottom-0 flex flex-col gap-3 rounded-lg border border-subtle bg-surface p-3 shadow-sm"
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
              busyLabel="Moving..."
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

/** One note's row: its title, the first of its text, when it changed, and its menu. */
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
  const summary = (
    <div class="min-w-0 flex-1">
      <div class="flex items-baseline gap-3">
        <h2 class="min-w-0 flex-1 truncate text-sm font-medium" data-e2e="note-item-title">
          {selecting ? note.title : (
            <Link
              href={NOTE_PATHS.note(note.id)}
              navigate={navigate}
              class="text-foreground after:absolute after:inset-0 focus-visible:outline-hidden focus-visible:after:ring-2 focus-visible:after:ring-focus focus-visible:after:ring-inset"
            >
              {note.title}
            </Link>
          )}
        </h2>
        {note.updatedAt && (
          <time class="shrink-0 text-xs text-muted" dateTime={note.updatedAt}>
            {timeAgo(note.updatedAt)}
          </time>
        )}
      </div>
      {note.body && (
        <p class="truncate text-sm font-normal text-muted" data-e2e="note-item-body">{note.body}</p>
      )}
      <NoteTags tagIds={note.tagIds} tags={tags} />
    </div>
  )
  return (
    <li class="relative transition-colors hover:bg-hover" data-e2e={`note-${note.id}`}>
      {selecting
        // While selecting, the whole row is the tick box's label: a tap anywhere on it ticks.
        ? (
          <Checkbox
            name="noteIds"
            value={note.id}
            checked={ticked}
            onChange={(event) => onTick(event.currentTarget.checked)}
            aria-label={`Tick ${note.title}`}
            labelClass="flex min-h-16 w-full cursor-pointer px-4 py-3"
            data-e2e="note-select"
          >
            {summary}
          </Checkbox>
        )
        : (
          <div class="flex min-h-16 items-center gap-3 px-4 py-3">
            {summary}
            {menu && <div class="relative -my-2 -mr-2 shrink-0">{menu}</div>}
          </div>
        )}
    </li>
  )
}

/** A row's menu: move the note to each group it can go to, and delete it. */
function NoteRowMenu(
  { note, moveTargets, onMove, onDelete, disabled }: {
    note: NoteRow
    moveTargets: readonly MoveTarget[]
    onMove?: (toGroupId: string) => void
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
      {onMove && moveTargets.map((target) => (
        <DropdownItem
          key={target.id}
          onClick={() => onMove(target.id)}
          disabled={disabled}
          dataE2E="note-move"
        >
          Move to {target.name}
        </DropdownItem>
      ))}
      {onDelete && (
        <DropdownItem onClick={onDelete} danger dataE2E="note-delete">Delete</DropdownItem>
      )}
    </Dropdown>
  )
}
