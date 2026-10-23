import type { ComponentChildren, JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { DropdownItem } from "@spy4x/preact-ui/dropdown"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { OnDay, useFormat, When } from "@spy4x/preact-ui/format"
import { Textarea } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { NOTE_BODY_MAX_LENGTH, NOTE_TITLE_MAX_LENGTH } from "@domain/notes"
import {
  ListEmpty,
  MoveNoteDialog,
  type MoveTarget,
  type NoteDraft,
  type NoteFormErrors,
  type NotesGroup,
} from "./notes-screen.tsx"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import { PlanRefusalNotice } from "./plan-refusal.tsx"
import { NoteAttachments, type NoteAttachmentsProps } from "./note-attachments.tsx"
import { NoteTags, TagChips, type TagRow } from "./tag-parts.tsx"
import { type Navigate, NOTE_PATHS, SCREEN_PATHS, ScreenForm } from "./progressive.tsx"

/**
 * Who made a note and when, and who changed it last and when, as the page's header line names
 * them: "You", a member's name, or "Former member". A name left out is not known yet.
 */
export interface NoteAuthorship {
  createdAt: string
  createdBy?: string
  updatedAt: string
  updatedBy?: string
}

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
  /** Who made the note and changed it last, shown under the title. Left out on the create page. */
  authorship?: NoteAuthorship | null
  /**
   * The note's files, drawn under the tags. Left out, the page has no attachments section. A
   * viewer's page shows the list only.
   */
  attachments?: NoteAttachmentsSlot | null
  navigate?: Navigate
}

/** What the page passes on to {@link NoteAttachments}; the group and the mode come from the page. */
export type NoteAttachmentsSlot = Omit<
  NoteAttachmentsProps,
  "groupId" | "groupName" | "readOnly" | "creating" | "navigate"
>

/**
 * One note on a page of its own: the form to create it or edit it, and for a viewer the note as
 * text. The title is typed into the page's heading itself, so it shows once. The header has a back
 * button and, on an existing note, a menu to move it to another group or delete it (after a
 * confirmation); under it, who made the note and who changed it last. Save and Cancel sit in the
 * form's footer under the text: Save full width on a phone, at the right from `sm` up.
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

/**
 * The header's second line on an existing note: "Created by Maya Chen, 12 Mar 2026 · Updated by
 * You, 3 hours ago", or only the first half for a note nobody changed since. Each moment's exact
 * time is its tooltip.
 */
function AuthorshipLine({ authorship }: { authorship: NoteAuthorship }): JSX.Element {
  const format = useFormat()
  const by = (name: string | undefined) => name ? ` by ${name}` : ""
  return (
    <p class="flex flex-col text-sm text-muted sm:flex-row sm:gap-2" data-e2e="note-authorship">
      <span>
        Created{by(authorship.createdBy)}, <OnDay at={authorship.createdAt} />
      </span>
      {authorship.updatedAt !== authorship.createdAt && (
        <>
          <span aria-hidden="true" class="hidden sm:inline">·</span>
          <span>
            Updated{by(authorship.updatedBy)}, <When at={authorship.updatedAt} />
            <span class="sr-only">({format.exact(authorship.updatedAt)})</span>
          </span>
        </>
      )}
    </p>
  )
}

/** A viewer's page: the note as text, with nothing to change. */
function ReadOnlyNote(
  { note, value, group, navigate, tags, authorship, attachments }: NoteEditorScreenProps,
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
      {note && authorship && <AuthorshipLine authorship={authorship} />}
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
      {note && group && attachments && (
        <NoteAttachments
          {...attachments}
          groupId={group.id}
          groupName={group.name}
          readOnly
          navigate={navigate}
        />
      )}
    </EditorPage>
  )
}

type WithGroup = NoteEditorScreenProps & { group: NotesGroup }

function Editor(props: WithGroup): JSX.Element {
  const { group, note, value, onChange, errors, saving, onSave, navigate } = props
  const moveTargets = props.onMove ? props.moveTargets ?? [] : []
  const [asking, setAsking] = useState(false)
  const [choosingGroup, setChoosingGroup] = useState(false)
  const hasMenu = note !== null && (moveTargets.length > 0 || props.onDelete !== undefined)
  const title = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (errors.title) title.current?.focus()
  }, [errors.title])
  return (
    <ScreenForm
      pending={saving}
      onSubmit={onSave}
    >
      <EditorPage>
        <PageHeader
          back={BACK}
          navigate={navigate}
          title={note ? note.savedTitle : "New note"}
          heading={
            <textarea
              ref={title}
              rows={1}
              id="note-title"
              data-e2e="note-title"
              name="title"
              aria-label="Title"
              aria-invalid={errors.title ? "true" : undefined}
              aria-describedby={errors.title ? "note-title-error" : undefined}
              autocomplete="off"
              placeholder="Title"
              class="-mx-2 block w-full min-w-0 resize-none overflow-hidden rounded-md border-0 bg-transparent px-2 py-0 text-xl font-semibold text-foreground field-sizing-content placeholder:text-muted hover:bg-hover focus:bg-surface focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus sm:text-2xl"
              maxLength={NOTE_TITLE_MAX_LENGTH}
              value={value.title}
              // A title is one line that wraps: Enter saves, as it would in a one-line field.
              onKeyDown={(e) => {
                if (e.key !== "Enter") return
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }}
              onInput={(e) =>
                onChange?.({ ...value, title: e.currentTarget.value.replace(/\r?\n/g, " ") })}
              required
            />
          }
          subtitle={group.name}
          subtitleDataE2E="notes-group"
          menuDataE2E="note-menu"
          menu={hasMenu && (
            <>
              {moveTargets.length > 0 && (
                <DropdownItem
                  onClick={() => setChoosingGroup(true)}
                  disabled={props.moving}
                  dataE2E="note-move"
                >
                  Move to group…
                </DropdownItem>
              )}
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
        <Stack>
          {note && props.authorship && <AuthorshipLine authorship={props.authorship} />}
          {errors.title && (
            <p id="note-title-error" class="text-sm text-danger" data-e2e="note-title-error">
              {errors.title}
            </p>
          )}
          <NoteFields
            groupId={group.id}
            value={value}
            onChange={onChange}
            errors={errors}
            tags={props.tags ?? []}
            navigate={navigate}
          />
          {props.attachments && (
            <NoteAttachments
              {...props.attachments}
              groupId={group.id}
              groupName={group.name}
              creating={note === null}
              navigate={navigate}
            />
          )}
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
      </EditorPage>
      {choosingGroup && note && (
        <MoveNoteDialog
          note={{ title: note.savedTitle }}
          moveTargets={moveTargets}
          onMove={(toGroupId) => {
            setChoosingGroup(false)
            props.onMove?.(toGroupId)
          }}
          onCancel={() => setChoosingGroup(false)}
        />
      )}
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
    </ScreenForm>
  )
}

/**
 * The text and tags of a note form, with the form's error under them; the title is in the page's
 * heading. The text grows with what is typed.
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
  return (
    <Stack>
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
          showLabel
          dataE2E="note-tags-picker"
        />
      )}
      {errors.plan
        ? <PlanRefusalNotice groupId={groupId} refusal={errors.plan} navigate={navigate} />
        : <ErrorState message={errors.form} />}
    </Stack>
  )
}
