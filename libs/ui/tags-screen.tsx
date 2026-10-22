import type { ComponentChildren, JSX, RefObject } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { Dropdown, DropdownItem } from "@spy4x/preact-ui/dropdown"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Link } from "@spy4x/preact-ui/link"
import { Stack } from "@spy4x/preact-ui/layout"
import { PageAction, PageHeader } from "@spy4x/preact-ui/page-header"
import { IconEllipsisVertical, IconPlus } from "@spy4x/preact-icons"
import { ListCard, ListEmpty, MENU_TRIGGER_CLASSES, type NotesGroup } from "./notes-screen.tsx"
import { noteCountText, TagBadge, tagDeleteMessage, type TagRow } from "./tag-parts.tsx"
import { type Navigate, NOTE_PATHS, SCREEN_PATHS, TAG_PATHS } from "./progressive.tsx"

export type { TagRow }

export interface TagsScreenProps {
  /** `null` while the group is not known yet (loading), or when the person is not a member. */
  group: NotesGroup | null
  tags: readonly TagRow[]
  loading: boolean
  /** The error of the list itself, such as a failed read or a refused delete. */
  listError: string | null
  /** Deletes a tag from its row's menu, after the person confirms. Left out, rows offer no delete. */
  onDelete?: (id: string) => void
  navigate?: Navigate
}

/**
 * A group's tags: the list, where "New tag" and each tag's name lead to the tag editor
 * (`TagEditorScreen`), and a delete in each row's menu behind a confirmation. A tag is only a
 * label: deleting it takes it off its notes and leaves the notes as they are, which the
 * confirmation says.
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
          title={props.loading ? "Loading the group…" : "This group does not exist."}
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
        action={canWrite && (
          <PageAction
            label="New tag"
            Icon={IconPlus}
            href={TAG_PATHS.new}
            navigate={navigate}
            dataE2E="tag-new"
          />
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
              title={props.loading ? "Loading tags…" : "No tags yet"}
              description={props.loading || !canWrite
                ? undefined
                : "Tags label notes, so a group can find them again."}
              action={!props.loading && canWrite && (
                <Button href={TAG_PATHS.new} navigate={navigate} data-e2e="tag-new-empty">
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
                    {canWrite
                      ? (
                        <Link
                          href={TAG_PATHS.tag(tag.id)}
                          navigate={navigate}
                          class="flex min-h-11 w-full min-w-0 items-center rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus"
                          aria-label={`Edit ${tag.name}`}
                          data-e2e="tag-edit"
                        >
                          <TagBadge tag={tag} />
                        </Link>
                      )
                      : <TagBadge tag={tag} />}
                  </div>
                  {tag.noteCount !== undefined && (
                    tag.noteCount === 0
                      ? (
                        <span class="shrink-0 text-sm text-muted" data-e2e="tag-note-count">
                          No notes
                        </span>
                      )
                      : (
                        <Link
                          href={NOTE_PATHS.tagged(tag.id)}
                          navigate={navigate}
                          class="pc-link inline-flex min-h-11 shrink-0 items-center text-sm"
                          aria-label={tag.noteCount === 1
                            ? `Show the note tagged ${tag.name}`
                            : `Show the ${tag.noteCount} notes tagged ${tag.name}`}
                          data-e2e="tag-note-count"
                        >
                          {noteCountText(tag.noteCount)}
                        </Link>
                      )
                  )}
                  {canWrite && props.onDelete && (
                    <div class="relative -my-2 -mr-2 shrink-0">
                      <Dropdown
                        trigger={<IconEllipsisVertical class="size-5" />}
                        triggerLabel={`Actions for ${tag.name}`}
                        triggerClasses={MENU_TRIGGER_CLASSES}
                        triggerDataE2E="tag-menu"
                      >
                        <DropdownItem
                          href={TAG_PATHS.tag(tag.id)}
                          navigate={navigate}
                          dataE2E="tag-menu-edit"
                        >
                          Edit tag
                        </DropdownItem>
                        <DropdownItem onClick={() => setDeleting(tag)} danger dataE2E="tag-delete">
                          Delete tag
                        </DropdownItem>
                      </Dropdown>
                    </div>
                  )}
                </li>
              ))}
            </ListCard>
          )}
      </Stack>
      {deleting && (
        <ConfirmDialog
          title={`Delete tag "${deleting.name}"?`}
          message={tagDeleteMessage(deleting.noteCount)}
          confirmLabel="Delete tag"
          cancelLabel="Cancel"
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
