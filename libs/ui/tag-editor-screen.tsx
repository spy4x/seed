// deno-lint-ignore-file ui-text/no-literal
import type { ComponentChildren, JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { DropdownItem } from "@spy4x/preact-ui/dropdown"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { Stack } from "@spy4x/preact-ui/layout"
import { Notice } from "@spy4x/preact-ui/notice"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import { ColorField } from "@spy4x/preact-ui/color-field"
import { TAG_NAME_MAX_LENGTH, type TagColor } from "@domain/tags"
import { ListEmpty, type NotesGroup } from "./notes-screen.tsx"
import { TagBadge, tagDeleteMessage, type TagRow } from "./tag-parts.tsx"
import { type Navigate, SCREEN_PATHS, ScreenForm, TAG_PATHS } from "./progressive.tsx"

/** What the tag's fields show: what the person typed, or the tag as saved. */
export interface TagFormValue {
  name: string
  color: TagColor
}

/** The errors of the tag editor: on the name field, and for the form as a whole. */
export interface TagFormErrors {
  name: string | null
  form: string | null
}

export interface TagEditorScreenProps {
  /** `null` while the group is not known yet (loading), or when the person is not a member. */
  group: NotesGroup | null
  /**
   * The group or the tag is still being read. The create page passes it only while its group is
   * not known: an edit page without its tag yet is the only other page that waits.
   */
  loading: boolean
  /** The tag is not in this group: it is gone, it never existed, or it is in another group. */
  notFound: boolean
  /** The tag being edited, as saved, or `null` on the create page. Its name is the page's title. */
  tag: TagRow | null
  value: TagFormValue
  onChange?: (value: TagFormValue) => void
  errors: TagFormErrors
  saving: boolean
  /**
   * The fields differ from the saved tag. An existing tag shows its Save and Cancel only then; the
   * create page always shows them.
   */
  dirty: boolean
  /** Creates or saves. */
  onSave?: () => void
  /** Puts an existing tag's fields back to the saved values: its Cancel. */
  onRevert?: () => void
  deleting?: boolean
  /**
   * Deletes the tag. Given, the page's menu holds "Delete tag", which asks first and runs this when
   * the person confirms. Left out, the page has no menu.
   */
  onDelete?: () => void
  /** The device has no network; the tag is saved on it and sent later, which the page says. */
  offline?: boolean
  navigate?: Navigate
}

/** How long a read may take before the page says it is loading, so a fast one never flickers. */
const LOADING_DELAY_MS = 300

/** The header's back link: to the list, which `navigate` follows without a page load. */
const BACK = { href: TAG_PATHS.list, label: "Back to tags" }

/**
 * One tag on a page of its own, at `/tags/new` and `/tags/:tagId`: the same form creates and
 * edits it. On the create page Create and Cancel always show; on an existing tag Save and Cancel
 * show once a field changed, and its "More actions" menu holds Delete, behind a confirmation. A
 * viewer sees the fields read-only, with a line saying who may change them.
 */
export function TagEditorScreen(props: TagEditorScreenProps): JSX.Element {
  const { group, navigate } = props
  const waited = useWaited(props.loading)
  if (!group) {
    return (
      <EditorPage>
        <PageHeader back={BACK} navigate={navigate} title="Tag" />
        {props.loading ? waited && <Loading label="Loading the group…" /> : (
          <ListEmpty
            title="This group does not exist."
            action={
              <Button href={SCREEN_PATHS.groups} navigate={navigate} variant="outline">
                Back to groups
              </Button>
            }
          />
        )}
      </EditorPage>
    )
  }
  if (props.notFound) {
    return (
      <EditorPage>
        <PageHeader back={BACK} navigate={navigate} title="Tag" />
        <div data-e2e="tag-not-found">
          <ListEmpty
            title="This tag does not exist."
            description={props.errors.form ?? "It may have been deleted."}
            action={
              <Button href={TAG_PATHS.list} navigate={navigate} variant="outline">
                Back to tags
              </Button>
            }
          />
        </div>
      </EditorPage>
    )
  }
  // The create page is never given `loading` once its group is known: only an edit waits here.
  if (props.loading && !props.tag) {
    return (
      <EditorPage>
        <PageHeader back={BACK} navigate={navigate} title="Tag" subtitle={group.name} />
        {waited && <Loading label="Loading the tag…" />}
      </EditorPage>
    )
  }
  return <Editor {...props} group={group} />
}

/** `true` once `active` has held for `LOADING_DELAY_MS`; `false` again as soon as it ends. */
export function useWaited(active: boolean): boolean {
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    if (!active) return setWaited(false)
    const timer = setTimeout(() => setWaited(true), LOADING_DELAY_MS)
    return () => clearTimeout(timer)
  }, [active])
  return waited
}

/** The form's width: a page with one short form keeps its fields from stretching across the column. */
export const FORM_WIDTH = "max-w-md"

/**
 * A read that took longer than the delay: a placeholder in the form's place, and one polite line
 * for a screen reader, which the placeholder hides itself from.
 */
function Loading({ label }: { label: string }): JSX.Element {
  return (
    <div data-e2e="tag-loading">
      <p role="status" class="sr-only">{label}</p>
      <LoadingSkeleton rows={1} class={FORM_WIDTH} />
    </div>
  )
}

/** The page's content, in the column the app's frame sets: never a width of its own. */
function EditorPage({ children }: { children?: ComponentChildren }): JSX.Element {
  return <Stack gap="xl">{children}</Stack>
}

type WithGroup = TagEditorScreenProps & { group: NotesGroup }

function Editor(props: WithGroup): JSX.Element {
  const { group, tag, value, onChange, errors, saving, navigate } = props
  const canWrite = group.canWrite
  const [asking, setAsking] = useState(false)
  const name = useRef<HTMLInputElement>(null)
  // A refused name lands the person on the field to fix.
  useEffect(() => {
    if (errors.name) name.current?.focus()
  }, [errors.name])
  const showFooter = canWrite && (tag === null || props.dirty)
  const fields = useRef<HTMLFieldSetElement>(null)
  // When an existing tag's footer goes away (Cancel, or a save that went through), the button that
  // held focus goes with it, and the browser drops focus to the page. Focus moves to the name field
  // instead, once the save has finished and the fields are enabled again. Focus the person put in
  // the fields themselves stays where it is.
  const shown = useRef({ footer: showFooter, tagId: tag?.id })
  const refocus = useRef(false)
  useEffect(() => {
    const before = shown.current
    if (before.footer && !showFooter && tag && before.tagId === tag.id) refocus.current = true
    shown.current = { footer: showFooter, tagId: tag?.id }
    if (!refocus.current || saving) return
    refocus.current = false
    const active = fields.current?.ownerDocument.activeElement
    if (active && fields.current?.contains(active)) return
    name.current?.focus()
  }, [showFooter, saving, tag?.id])
  return (
    <EditorPage>
      <PageHeader
        back={BACK}
        navigate={navigate}
        title={tag ? tag.name : "New tag"}
        titleDataE2E="tag-title"
        subtitle={group.name}
        subtitleDataE2E="tags-group"
        menuDataE2E="tag-editor-menu"
        menu={canWrite && tag && props.onDelete && (
          <DropdownItem
            onClick={() => setAsking(true)}
            disabled={props.deleting}
            danger
            dataE2E="tag-editor-delete"
          >
            Delete tag
          </DropdownItem>
        )}
      />
      {canWrite && props.offline && (
        <div data-e2e="tag-offline">
          <Notice title="You are offline">
            Your changes are saved on this device and sent when you are back online.
          </Notice>
        </div>
      )}
      {!canWrite && (
        <p class="text-sm text-muted" data-e2e="tag-read-only">
          Only an editor can change tags in this group.
        </p>
      )}
      <ScreenForm
        pending={saving}
        // Enter in the name field submits even with the footer hidden: an existing tag with
        // nothing changed has nothing to save, so that submit does nothing.
        onSubmit={() => {
          if (tag === null || props.dirty) props.onSave?.()
        }}
      >
        <Stack class={FORM_WIDTH}>
          <fieldset ref={fields} disabled={!canWrite} class="contents">
            <Stack>
              <Field
                id="tag-name"
                label="Name"
                hint={`Everyone in ${group.name} sees this tag.`}
                error={errors.name}
                required
              >
                <Input
                  ref={name}
                  data-e2e="tag-name"
                  name="name"
                  autocomplete="off"
                  maxLength={TAG_NAME_MAX_LENGTH}
                  value={value.name}
                  onInput={(e) => onChange?.({ ...value, name: e.currentTarget.value })}
                  required
                />
              </Field>
              <div data-e2e="tag-color">
                <ColorField
                  name="color"
                  value={value.color}
                  onChange={(color) => {
                    if (color) onChange?.({ ...value, color })
                  }}
                  // The chip as the lists will draw it, with the name typed so far.
                  preview={() => (
                    <TagBadge tag={{ name: value.name.trim() || "Tag name", color: value.color }} />
                  )}
                />
              </div>
            </Stack>
          </fieldset>
          <ErrorState message={errors.form} />
          {
            // The form's footer. On a phone the primary button is on top at full width, Cancel
            // under it; from `sm` up they are a row at the right, the primary button last.
          }
          {showFooter && (
            <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {tag
                ? (
                  <Button
                    type="button"
                    variant="ghost"
                    class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                    data-e2e="tag-cancel"
                    onClick={props.onRevert}
                  >
                    Cancel
                  </Button>
                )
                : (
                  <Button
                    href={TAG_PATHS.list}
                    navigate={navigate}
                    variant="ghost"
                    class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                    data-e2e="tag-cancel"
                  >
                    Cancel
                  </Button>
                )}
              <Button
                type="submit"
                class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                data-e2e="tag-save"
                busy={saving}
                busyLabel={tag ? "Saving…" : "Creating…"}
              >
                {tag ? "Save tag" : "Create tag"}
              </Button>
            </div>
          )}
        </Stack>
      </ScreenForm>
      {asking && tag && (
        <ConfirmDialog
          title={`Delete tag "${tag.name}"?`}
          message={tagDeleteMessage(tag.noteCount)}
          confirmLabel="Delete tag"
          cancelLabel="Cancel"
          tone="danger"
          dataE2E="tag-delete-dialog"
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
