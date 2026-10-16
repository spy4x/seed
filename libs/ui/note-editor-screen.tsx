import type { ComponentChildren, JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { DropdownItem } from "@spy4x/preact-ui/dropdown"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input, Textarea } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { NOTE_BODY_MAX_LENGTH, NOTE_TITLE_MAX_LENGTH } from "@domain/notes"
import {
  ListEmpty,
  type MoveTarget,
  type NoteDraft,
  type NoteFormErrors,
  type NotesGroup,
} from "./notes-screen.tsx"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import { PlanRefusalNotice } from "./plan-refusal.tsx"
import { NoteTags, TagChips, type TagRow } from "./tag-parts.tsx"
import { type Navigate, NOTE_PATHS, SCREEN_PATHS, ScreenForm } from "./progressive.tsx"

/** The note a page edits: its id, the version the edit started from, and whether it moved on. */
export interface NoteTarget {
  id: string
  version: number
  /** The note moved on since the edit started; set after a refused save. */
  conflict: boolean
  /** The title as saved, which the page's heading shows; not what the person is typing. */
  savedTitle: string
}

export interface NoteEditorScreenProps {
  /** `null` while the group is not known yet (loading), or when the person is not a member. */
  group: NotesGroup | null
  /** The group or the note is still being read; the create page never waits. */
  loading: boolean
  /** The note is not in this group: it is gone, it never existed, or it is in another group. */
  notFound: boolean
  /**
   * The note is in another group the person belongs to. Given with `notFound`, the page names that
   * group and offers to switch to it, instead of saying the note does not exist.
   */
  elsewhere?: { name: string } | null
  /** Switches to the note's group, which then opens the note. Never called by the page load. */
  onSwitchGroup?: () => void
  /** True while the switch to the note's group is under way; disables the button. */
  switching?: boolean
  /** The note being edited, or `null` on the create page. */
  note: NoteTarget | null
  /** What the title and text show: what the person typed, or the note as saved. */
  value: NoteDraft
  onChange?: (value: NoteDraft) => void
  errors: NoteFormErrors
  saving: boolean
  /** Saves or creates. */
  onSave?: () => void
  /** Rereads the note after a conflict; without it, the "load the latest" link reloads the page. */
  onReloadLatest?: () => void
  deleting: boolean
  /**
   * Deletes the note. Given, the page's menu holds "Delete", which asks first and runs this when
   * the person confirms. Left out, the menu offers no delete.
   */
  onDelete?: () => void
  /**
   * The other groups the person may move this note to (editor or above there). Empty, or left
   * out, the menu offers no move.
   */
  moveTargets?: readonly MoveTarget[]
  /** Moves the note to the chosen group. */
  onMove?: (toGroupId: string) => void
  moving?: boolean
  /** The refusal of the last move, shown under the form. */
  moveError?: string | null
  /** The group's tags, offered as a picker under the text. Left out or empty, there is none. */
  tags?: readonly TagRow[]
  navigate?: Navigate
}

/**
 * One note on a page of its own: the form to create it or edit it, and for a viewer the note as
 * text. The header has a back button and, on an existing note, a menu to move it to another group
 * or delete it (after a confirmation). Save and Cancel sit in the form's footer under the text:
 * Save full width on a phone, at the right from `sm` up.
 */
export function NoteEditorScreen(props: NoteEditorScreenProps): JSX.Element {
  const { group, notFound, navigate } = props
  if (!group) {
    return (
      <EditorPage>
        <PageHeader back={BACK} navigate={navigate} title="Note" />
        <ListEmpty
          title={props.loading ? "Loading the group…" : "This group does not exist."}
          action={!props.loading && (
            <Button href={SCREEN_PATHS.groups} navigate={navigate} variant="outline">
              Back to groups
            </Button>
          )}
        />
      </EditorPage>
    )
  }
  if (notFound && props.elsewhere) {
    return (
      <EditorPage>
        <PageHeader back={BACK} navigate={navigate} title="Note in another group" />
        <Stack gap="md">
          <p class="text-sm text-muted" data-e2e="note-elsewhere">
            This note is in {props.elsewhere.name}, another of your groups. You are in {group.name}.
          </p>
          <div>
            <Button
              type="button"
              class="min-h-11 sm:min-h-9"
              data-e2e="note-switch-group"
              busy={props.switching}
              busyLabel="Switching…"
              disabled={!props.onSwitchGroup}
              onClick={props.onSwitchGroup}
            >
              Switch to {props.elsewhere.name}
            </Button>
          </div>
        </Stack>
      </EditorPage>
    )
  }
  if (notFound) {
    return (
      <EditorPage>
        <PageHeader back={BACK} navigate={navigate} title="This note does not exist." />
        {props.errors.form
          ? <ErrorState message={props.errors.form} />
          : (
            <p class="text-sm text-muted" data-e2e="note-not-found">
              There is no such note in{" "}
              {group.name}. It may have been deleted, or it may be in another of your groups: switch
              to that group, then open it from its notes.
            </p>
          )}
      </EditorPage>
    )
  }
  if (props.loading) {
    return (
      <EditorPage>
        <PageHeader back={BACK} navigate={navigate} title="Note" />
        <ListEmpty title="Loading the note…" />
      </EditorPage>
    )
  }
  return group.canWrite ? <Editor {...props} group={group} /> : <ReadOnlyNote {...props} />
}

/** The page's content, in the column the app's frame sets: never a width of its own. */
function EditorPage({ children }: { children?: ComponentChildren }): JSX.Element {
  return <Stack gap="xl">{children}</Stack>
}

/** The header's back link: to the list, which `navigate` follows without a page load. */
const BACK = { href: NOTE_PATHS.list, label: "Back to notes" }

/** A viewer's page: the note as text, with nothing to change. */
function ReadOnlyNote(
  { note, value, group, navigate, tags }: NoteEditorScreenProps,
): JSX.Element {
  return (
    <EditorPage>
      <PageHeader
        back={BACK}
        navigate={navigate}
        title={note ? value.title : "New note"}
        subtitle={group?.name}
        subtitleDataE2E="notes-group"
        titleDataE2E="note-read-title"
      />
      <p class="text-sm text-muted" data-e2e="note-read-only">
        {note
          ? "You can read this note. Only an editor can change it."
          : "Only an editor can add notes to this group."}
      </p>
      {note && value.body && (
        <p class="whitespace-pre-wrap break-words text-base" data-e2e="note-read-body">
          {value.body}
        </p>
      )}
      {note && <NoteTags tagIds={value.tagIds} tags={tags ?? []} />}
    </EditorPage>
  )
}

type WithGroup = NoteEditorScreenProps & { group: NotesGroup }

function Editor(props: WithGroup): JSX.Element {
  const { group, note, value, onChange, errors, saving, onSave, navigate } = props
  const moveTargets = props.onMove ? props.moveTargets ?? [] : []
  const [asking, setAsking] = useState(false)
  const hasMenu = note !== null && (moveTargets.length > 0 || props.onDelete !== undefined)
  return (
    <EditorPage>
      <PageHeader
        back={BACK}
        navigate={navigate}
        title={note ? note.savedTitle : "New note"}
        subtitle={group.name}
        subtitleDataE2E="notes-group"
        menuDataE2E="note-menu"
        menu={hasMenu && (
          <>
            {moveTargets.map((target) => (
              <DropdownItem
                key={target.id}
                onClick={() => props.onMove?.(target.id)}
                disabled={props.moving}
                dataE2E="note-move"
              >
                Move to {target.name}
              </DropdownItem>
            ))}
            {props.onDelete && (
              <DropdownItem
                onClick={() => setAsking(true)}
                disabled={props.deleting}
                danger
                dataE2E="note-delete"
              >
                Delete
              </DropdownItem>
            )}
          </>
        )}
      />
      <ScreenForm
        pending={saving}
        onSubmit={onSave}
      >
        <Stack>
          <NoteFields
            groupId={group.id}
            value={value}
            onChange={onChange}
            errors={errors}
            tags={props.tags ?? []}
            navigate={navigate}
          />
          {note?.conflict && (
            <p class="text-sm" data-e2e="note-conflict">
              <Link
                href={NOTE_PATHS.note(note.id)}
                navigate={props.onReloadLatest ? () => props.onReloadLatest?.() : navigate}
                class="pc-link"
                // Acts on this page, so a guard that asks before leaving must let it through.
                data-unsaved-ok="true"
              >
                Load the latest version
              </Link>{" "}
              to see what changed. Your text here is kept until you do.
            </p>
          )}
          <ErrorState message={props.moveError ?? null} />
          {
            // The form's footer. On a phone Save is on top at full width, Cancel under it; from
            // `sm` up they are a row at the right, Save last.
          }
          <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              href={NOTE_PATHS.list}
              navigate={navigate}
              variant="ghost"
              class="min-h-11 w-full sm:min-h-9 sm:w-auto"
              data-e2e="note-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              class="min-h-11 w-full sm:min-h-9 sm:w-auto"
              data-e2e="note-save"
              busy={saving}
              busyLabel={note ? "Saving…" : "Creating…"}
            >
              {note ? "Save note" : "Create note"}
            </Button>
          </div>
        </Stack>
      </ScreenForm>
      {asking && note && (
        <ConfirmDialog
          title="Delete this note?"
          message={`"${value.title}" will be deleted for everyone in ${group.name}.`}
          confirmLabel="Delete note"
          cancelLabel="Cancel"
          tone="danger"
          dataE2E="note-delete-dialog"
          onConfirm={() => {
            setAsking(false)
            props.onDelete?.()
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </EditorPage>
  )
}

/**
 * The title and text of a note form, with the form's error under them. The title is the page's
 * large first line; the text grows with what is typed. When the title gets an error, focus moves
 * to it, so a keyboard or screen reader user lands on what to fix.
 */
function NoteFields(
  { groupId, value, onChange, errors, tags, navigate }: {
    groupId: string
    value: NoteDraft
    onChange?: (value: NoteDraft) => void
    errors: NoteFormErrors
    tags: readonly TagRow[]
    navigate?: Navigate
  },
): JSX.Element {
  const title = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (errors.title) title.current?.focus()
  }, [errors.title])
  return (
    <Stack>
      <Field id="note-title" label="Title" error={errors.title} required>
        <Input
          ref={title}
          data-e2e="note-title"
          name="title"
          autocomplete="off"
          placeholder="What is this note about?"
          class="text-lg font-semibold"
          maxLength={NOTE_TITLE_MAX_LENGTH}
          value={value.title}
          onInput={(e) => onChange?.({ ...value, title: e.currentTarget.value })}
          required
        />
      </Field>
      <Field id="note-body" label="Text">
        <Textarea
          data-e2e="note-body"
          name="body"
          rows={8}
          class="min-h-48 field-sizing-content"
          maxLength={NOTE_BODY_MAX_LENGTH}
          value={value.body}
          onInput={(e) => onChange?.({ ...value, body: e.currentTarget.value })}
        />
      </Field>
      {tags.length > 0 && (
        <TagChips
          tags={tags}
          value={value.tagIds ?? []}
          onChange={(tagIds) => onChange?.({ ...value, tagIds })}
          label="Tags"
          dataE2E="note-tags-picker"
        />
      )}
      {errors.plan
        ? <PlanRefusalNotice groupId={groupId} refusal={errors.plan} navigate={navigate} />
        : <ErrorState message={errors.form} />}
    </Stack>
  )
}
