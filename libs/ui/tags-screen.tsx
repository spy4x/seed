import type { ComponentChildren, JSX, RefObject } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { Dropdown, DropdownItem } from "@spy4x/preact-ui/dropdown"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Cluster, Stack } from "@spy4x/preact-ui/layout"
import { Modal } from "@spy4x/preact-ui/modal"
import { PageAction, PageHeader } from "@spy4x/preact-ui/page-header"
import { RadioGroup } from "@spy4x/preact-ui/radio"
import { IconEllipsisVertical, IconPlus } from "@spy4x/preact-icons"
import { TAG_COLORS, TAG_NAME_MAX_LENGTH, type TagColor } from "@domain/tags"
import { ListCard, ListEmpty, MENU_TRIGGER_CLASSES, type NotesGroup } from "./notes-screen.tsx"
import { TagBadge, type TagRow } from "./tag-parts.tsx"
import { type Navigate, SCREEN_PATHS, ScreenForm } from "./progressive.tsx"

export type { TagRow }

/** What the person has typed into the tag form. `id` is `null` while a new tag is made. */
export interface TagFormValue {
  id: string | null
  name: string
  color: TagColor
}

/** The errors of the tag form: on the name field, and for the form as a whole. */
export interface TagFormErrors {
  name: string | null
  form: string | null
}

export interface TagsScreenProps {
  /** `null` while the group is not known yet (loading), or when the person is not a member. */
  group: NotesGroup | null
  tags: readonly TagRow[]
  loading: boolean
  /** The error of the list itself, such as a failed read or a refused delete. */
  listError: string | null
  /** The open form, or `null` while none is open. */
  form: TagFormValue | null
  errors: TagFormErrors
  saving: boolean
  /** Opens the form to make a tag. Left out, a viewer sees the tags and no form. */
  onNew?: () => void
  /** Opens the form to rename or recolour a tag. */
  onEdit?: (id: string) => void
  onFormChange?: (value: TagFormValue) => void
  onSave?: () => void
  onCloseForm?: () => void
  /** Deletes a tag from its row's menu, after the person confirms. Left out, rows offer no delete. */
  onDelete?: (id: string) => void
  navigate?: Navigate
}

/** The words the colour choices are announced as. */
const COLOR_LABELS: Record<TagColor, string> = {
  gray: "Gray",
  red: "Red",
  orange: "Orange",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
}

/**
 * A group's tags: the list, a form to make or change one (opened by "New tag" or a tag's name) and
 * a delete behind a confirmation. A tag is only a label: deleting it takes it off its notes and
 * leaves the notes as they are, which the confirmation says.
 */
export function TagsScreen(props: TagsScreenProps): JSX.Element {
  const { group, tags, navigate } = props
  const [deleting, setDeleting] = useState<TagRow | null>(null)
  const [focusAfter, setFocusAfter] = useState<{ id: string; index: number } | null>(null)
  const page = useRef<HTMLDivElement>(null)
  // A deleted row would leave focus on the page's body. It goes to the next row's menu, else the
  // previous row's, else the page's primary action.
  useEffect(() => {
    if (!focusAfter) return
    // A refused delete keeps the tag; a later live change must not pull focus to it.
    if (props.listError) return setFocusAfter(null)
    if (tags.some((tag) => tag.id === focusAfter.id)) return
    const root = page.current
    const menus = root?.querySelectorAll<HTMLElement>("[data-e2e=tag-menu]")
    const row = menus?.[focusAfter.index] ?? menus?.[focusAfter.index - 1]
    ;(row ?? root?.querySelector<HTMLElement>("[data-e2e=tag-new], [data-e2e=tag-new-empty]"))
      ?.focus()
    setFocusAfter(null)
  }, [focusAfter, tags, props.listError])
  if (!group) {
    return (
      <TagsPage>
        <PageHeader title="Tags" />
        <ListEmpty
          title={props.loading ? "Loading the group..." : "This group was not found."}
          action={!props.loading && (
            <Button href={SCREEN_PATHS.groups} navigate={navigate} variant="outline">
              Back to groups
            </Button>
          )}
        />
      </TagsPage>
    )
  }
  const canWrite = group.canWrite
  return (
    <TagsPage page={page}>
      <PageHeader
        title="Tags"
        subtitle={group.name}
        subtitleDataE2E="tags-group"
        action={canWrite && props.onNew && (
          <PageAction label="New tag" Icon={IconPlus} onClick={props.onNew} dataE2E="tag-new" />
        )}
      />
      <Stack>
        {!canWrite && (
          <p class="text-sm text-muted" data-e2e="tags-read-only">
            You can see these tags. Only an editor can change them.
          </p>
        )}
        <ErrorState message={props.listError} />
        {tags.length === 0
          ? (
            <ListEmpty
              title={props.loading ? "Loading tags..." : "No tags yet."}
              description={props.loading || !canWrite
                ? undefined
                : "Tags label notes, so a group can find them again."}
              action={!props.loading && canWrite && props.onNew && (
                <Button type="button" onClick={props.onNew} data-e2e="tag-new-empty">
                  New tag
                </Button>
              )}
            />
          )
          : (
            <ListCard dataE2E="tag-list">
              {tags.map((tag) => (
                <li
                  key={tag.id}
                  class="flex min-h-14 items-center gap-3 px-4 py-3 sm:px-6"
                  data-e2e={`tag-${tag.id}`}
                >
                  <div class="min-w-0 flex-1">
                    {canWrite && props.onEdit
                      ? (
                        <button
                          type="button"
                          class="flex min-h-11 w-full cursor-pointer items-center rounded-sm text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus"
                          aria-label={`Edit ${tag.name}`}
                          data-e2e="tag-edit"
                          onClick={() => props.onEdit?.(tag.id)}
                        >
                          <TagBadge tag={tag} />
                        </button>
                      )
                      : <TagBadge tag={tag} />}
                  </div>
                  {canWrite && props.onDelete && (
                    <div class="relative -my-2 -mr-2 shrink-0">
                      <Dropdown
                        trigger={<IconEllipsisVertical class="size-5" />}
                        triggerLabel={`Actions for ${tag.name}`}
                        triggerClasses={MENU_TRIGGER_CLASSES}
                        triggerDataE2E="tag-menu"
                      >
                        <DropdownItem onClick={() => setDeleting(tag)} danger dataE2E="tag-delete">
                          Delete
                        </DropdownItem>
                      </Dropdown>
                    </div>
                  )}
                </li>
              ))}
            </ListCard>
          )}
      </Stack>
      <Modal
        open={props.form !== null}
        onClose={() => props.onCloseForm?.()}
        title={props.form?.id ? "Edit tag" : "New tag"}
        cancelLabel="Close"
        dataE2E="tag-dialog"
      >
        {props.form && <TagForm {...props} form={props.form} />}
      </Modal>
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          message="The tag is taken off every note that has it. The notes stay as they are."
          confirmLabel="Delete"
          cancelLabel="Keep it"
          tone="danger"
          dataE2E="tag-delete-dialog"
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            setDeleting(null)
            setFocusAfter({ id: deleting.id, index: tags.findIndex((t) => t.id === deleting.id) })
            props.onDelete?.(deleting.id)
          }}
        />
      )}
    </TagsPage>
  )
}

/** The page's content, in the column the app's frame sets: never a width of its own. */
function TagsPage(
  { children, page }: { children?: ComponentChildren; page?: RefObject<HTMLDivElement> },
): JSX.Element {
  return <div ref={page} class="flex flex-col gap-8">{children}</div>
}

function TagForm(
  { form, errors, saving, onFormChange, onSave, onCloseForm }: TagsScreenProps & {
    form: TagFormValue
  },
): JSX.Element {
  const name = useRef<HTMLInputElement>(null)
  // A failed submit lands the person on the field to fix.
  useEffect(() => {
    if (errors.name) name.current?.focus()
  }, [errors.name])
  return (
    <ScreenForm pending={saving} onSubmit={onSave}>
      <Stack>
        <Field id="tag-name" label="Name" error={errors.name} required>
          <Input
            ref={name}
            data-e2e="tag-name"
            name="name"
            autocomplete="off"
            maxLength={TAG_NAME_MAX_LENGTH}
            value={form.name}
            onInput={(e) => onFormChange?.({ ...form, name: e.currentTarget.value })}
            required
          />
        </Field>
        <RadioGroup
          legend="Colour"
          name="color"
          data-e2e="tag-color"
          options={TAG_COLORS.map((color) => ({ value: color, label: COLOR_LABELS[color] }))}
          value={form.color}
          onChange={(value) => {
            const color = TAG_COLORS.find((candidate) => candidate === value)
            if (color) onFormChange?.({ ...form, color })
          }}
        />
        <ErrorState message={errors.form} />
        <Cluster justify="end">
          <Button type="button" variant="ghost" onClick={onCloseForm} data-e2e="tag-cancel">
            Cancel
          </Button>
          <Button type="submit" data-e2e="tag-save" busy={saving} busyLabel="Saving...">
            {form.id ? "Save tag" : "Add tag"}
          </Button>
        </Cluster>
      </Stack>
    </ScreenForm>
  )
}
