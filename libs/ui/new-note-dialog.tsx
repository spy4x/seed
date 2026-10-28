// deno-lint-ignore-file ui-text/no-literal
import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { isApplePlatform, matchesHotkey, parseHotkey } from "@spy4x/platform/browser/hotkeys"
import type { PlanRefusal } from "@domain/billing"
import { IconCheck } from "@spy4x/preact-icons"
import { NOTE_TITLE_MAX_LENGTH } from "@domain/notes"
import { Button } from "@spy4x/preact-ui/button"
import { DialogActions } from "@spy4x/preact-ui/dialog-actions"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input, Select } from "@spy4x/preact-ui/input"
import { Kbd } from "@spy4x/preact-ui/kbd"
import { Stack } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { Modal } from "@spy4x/preact-ui/modal"
import { PlanRefusalNotice } from "./plan-refusal.tsx"
import { GROUP_PATHS, type Navigate, NOTE_PATHS, ScreenForm } from "./progressive.tsx"

/** A group the person may add notes to. */
export interface NewNoteGroup {
  id: string
  name: string
}

/** What the last add made: the success line names it and links to it. */
export interface NewNoteAdded {
  noteId: string
  groupId: string
  title: string
  groupName: string
  /** Kept on this device only, until it is sent once the server can be reached again. */
  onDevice: boolean
}

/** Why the last add failed, by where it is shown. */
export interface NewNoteErrors {
  title?: string | null
  group?: string | null
  /** Shown under the form: the notes store's create error, or the offline message. */
  form?: string | null
  /** The group's plan refused the note; shown under the form with its link to the plans. */
  plan?: PlanRefusal | null
}

/** The words of the New note dialog that are not data. */
export const NEW_NOTE_TEXT = {
  title: "New note",
  titleLabel: "Title",
  groupLabel: "Group",
  chooseGroup: "Choose a group",
  add: "Add note",
  adding: "Adding…",
  open: "Open note",
  chooseGroupError: "Choose a group for this note.",
  noGroup: "Notes live in a group you can write to. Create one to start.",
  newGroup: "New group",
  onDevice: "Saved on this device. It will be sent when you are back online.",
} as const

/** "Added “Buy milk” to Acme." */
export function addedText(added: NewNoteAdded): string {
  return `Added “${added.title}” to ${added.groupName}.`
}

/** Props of {@link NewNoteDialog}. */
export interface NewNoteDialogProps {
  open: boolean
  /** Escape, the close button and a click outside; the app keeps the unsent text. */
  onClose: () => void
  /** The groups the person may add notes to. */
  groups: readonly NewNoteGroup[]
  /** The group the note goes to: the selected one, or the one chosen here; `null` for none yet. */
  groupId: string | null
  onGroupChange: (groupId: string | null) => void
  title: string
  onTitleChange: (title: string) => void
  /** An add is on its way: the form is disabled and a second Enter is ignored. */
  pending: boolean
  errors: NewNoteErrors
  /** The note the last add made, or `null`. */
  added: NewNoteAdded | null
  /** Add the note; with `openAfter` (Ctrl or ⌘ Enter), open it once it is made. */
  onAdd: (openAfter: boolean) => void
  /** Open a note this dialog made. */
  onOpenNote: (noteId: string) => void
  navigate?: Navigate
}

/**
 * The New note dialog, opened with `n` from any page: one Title field and the group the note goes
 * to. Enter adds the note, clears the field and keeps focus there, so a person can add several in
 * a row; Ctrl Enter (⌘ Enter on a Mac) adds and opens it. The dialog stays open after an add and
 * says what was added in a polite live region, with a link to the note.
 *
 * With one group the person may write to, a hint names it; with several, a "Group" select starts
 * on the selected one. With none, the dialog says so and offers "New group" instead of the form.
 *
 * Every error is shown under its field or the form, the text stays, and focus goes back to the
 * field to fix.
 */
export function NewNoteDialog(props: NewNoteDialogProps): JSX.Element {
  const { open, onClose, groups, groupId, pending, errors, added, navigate } = props
  const title = useRef<HTMLInputElement>(null)
  const group = useRef<HTMLSelectElement>(null)
  const openAfter = useRef(false)
  const chosen = groups.find((candidate) => candidate.id === groupId)

  // Focus goes to the field to fix, or back to the title once an add has finished. A pending form
  // is disabled, which drops focus, so the effect runs when `pending` turns off. It runs again when
  // the groups arrive after the dialog opened, and it waits a microtask: this effect runs before
  // `Modal`'s own, and a field in a dialog that is not shown yet cannot take focus.
  useEffect(() => {
    if (!open || pending) return
    let live = true
    queueMicrotask(() => {
      if (!live) return
      const target = errors.group && !errors.title ? group.current : title.current
      target?.focus()
    })
    return () => {
      live = false
    }
  }, [
    open,
    pending,
    groups.length,
    errors.title,
    errors.group,
    errors.form,
    errors.plan,
    added?.noteId,
  ])

  const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
    if (!matchesHotkey(parseHotkey("mod+enter"), event, isApplePlatform())) return
    event.preventDefault()
    openAfter.current = true
    event.currentTarget.form?.requestSubmit()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={NEW_NOTE_TEXT.title}
      cancelLabel="Close"
      dataE2E="new-note-dialog"
      class="mt-16 sm:mt-auto sm:max-w-120"
    >
      {groups.length === 0
        ? (
          <Stack>
            <p class="text-sm text-muted" data-e2e="new-note-no-group">{NEW_NOTE_TEXT.noGroup}</p>
            <DialogActions>
              <Button
                href={GROUP_PATHS.new}
                navigate={(href) => {
                  onClose()
                  navigate?.(href)
                }}
                data-e2e="new-note-new-group"
              >
                {NEW_NOTE_TEXT.newGroup}
              </Button>
            </DialogActions>
          </Stack>
        )
        : (
          <ScreenForm
            pending={pending}
            onSubmit={() => {
              const andOpen = openAfter.current
              openAfter.current = false
              props.onAdd(andOpen)
            }}
          >
            <Stack>
              {groups.length > 1 && (
                <Field
                  id="new-note-group"
                  label={NEW_NOTE_TEXT.groupLabel}
                  error={errors.group}
                >
                  <Select
                    ref={group}
                    name="groupId"
                    data-e2e="new-note-group"
                    placeholder={NEW_NOTE_TEXT.chooseGroup}
                    options={groups.map((option) => ({ value: option.id, label: option.name }))}
                    value={chosen?.id ?? ""}
                    onChange={(event) => props.onGroupChange(event.currentTarget.value || null)}
                  />
                </Field>
              )}
              <Field
                id="new-note-title"
                label={NEW_NOTE_TEXT.titleLabel}
                error={errors.title}
                hint={groups.length === 1 ? `In ${groups[0].name}` : undefined}
              >
                <Input
                  ref={title}
                  name="title"
                  data-e2e="new-note-title"
                  autocomplete="off"
                  autofocus={groups.length === 1 || chosen !== undefined}
                  maxLength={NOTE_TITLE_MAX_LENGTH}
                  value={props.title}
                  onInput={(event) => props.onTitleChange(event.currentTarget.value)}
                  onKeyDown={onKeyDown}
                />
              </Field>
              <p class="hidden items-center gap-1 text-xs text-muted pointer-fine:flex">
                <Kbd keys="enter" /> adds · <Kbd keys="mod+enter" /> adds and opens
              </p>
            </Stack>
            <div
              role="status"
              class="text-sm text-foreground not-empty:pt-4"
              data-e2e="new-note-added"
            >
              {added && (
                <p class="flex items-start gap-2">
                  <IconCheck
                    class="size-4 shrink-0 translate-y-0.5 text-success"
                    aria-hidden="true"
                  />
                  <span>
                    {addedText(added)} {added.onDevice && `${NEW_NOTE_TEXT.onDevice} `}
                    <Link
                      href={NOTE_PATHS.note(added.noteId)}
                      navigate={() => props.onOpenNote(added.noteId)}
                      class="font-medium underline underline-offset-2"
                      data-e2e="new-note-open"
                    >
                      {NEW_NOTE_TEXT.open}
                    </Link>
                  </span>
                </p>
              )}
            </div>
            <Stack class="pt-4">
              {errors.plan && chosen
                ? (
                  <PlanRefusalNotice
                    groupId={chosen.id}
                    groupName={chosen.name}
                    refusal={errors.plan}
                    navigate={navigate}
                  />
                )
                : <ErrorState message={errors.form ?? null} />}
              <DialogActions>
                <Button
                  type="submit"
                  data-e2e="new-note-submit"
                  busy={pending}
                  busyLabel={NEW_NOTE_TEXT.adding}
                >
                  {NEW_NOTE_TEXT.add}
                </Button>
              </DialogActions>
            </Stack>
          </ScreenForm>
        )}
    </Modal>
  )
}
