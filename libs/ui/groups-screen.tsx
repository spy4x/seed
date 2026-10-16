import type { ComponentChildren, JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { IconCheck, IconCog6Tooth, IconPlus } from "@spy4x/preact-icons"
import { AvatarGroup } from "@spy4x/preact-ui/avatar"
import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Cluster, Stack } from "@spy4x/preact-ui/layout"
import { Modal } from "@spy4x/preact-ui/modal"
import { SettingGroup } from "@spy4x/preact-ui/setting-row"
import { GROUP_RESTORE_DAYS, type GroupColor, GroupRole } from "@domain/groups"
import { GroupMark } from "./group-appearance.tsx"
import { useSucceeded } from "@spy4x/preact-ui/use-succeeded"
import { PageAction, PageHeader } from "@spy4x/preact-ui/page-header"
import { GROUP_PATHS, type Navigate, SCREEN_PATHS, ScreenForm } from "./progressive.tsx"

/** The groups page with its "New group" dialog open: the address the group switcher links to. */
export const NEW_GROUP_PATH = `${SCREEN_PATHS.groups}?new`

/** One group as the screen shows it. */
export interface GroupRow {
  id: string
  name: string
  /** What the group is for; empty or absent when unset. */
  description?: string
  /** The group's colour, or absent for none. */
  color?: GroupColor | null
  /** The group's emoji, or absent for none. */
  emoji?: string | null
  role: GroupRole
  /** How many members the group has; the row shows its avatar stack when it is known. */
  memberCount?: number
  /** The first few members, oldest first, for the avatar stack. */
  members?: readonly { name: string }[]
}

/** A group its owner deleted and can still restore. */
export interface DeletedGroupRow {
  id: string
  name: string
  /** When it was deleted, as an ISO string. It can be restored for 30 days from then. */
  deletedAt: string
}

export interface GroupsScreenProps {
  groups: readonly GroupRow[]
  /** The groups the person deleted less than 30 days ago and can restore. */
  deleted?: readonly DeletedGroupRow[]
  /** The group the notes show now, or `null` when it is not known yet. */
  selectedId: string | null
  /** Follows a settings link without a page load; without it every link is an ordinary one. */
  navigate?: Navigate
  /** What the person has typed as the new group's name. */
  name: string
  onNameChange?: (name: string) => void
  /** A create is in flight. */
  creating: boolean
  /** The list is being fetched. */
  loading: boolean
  /** Why the create or the list read failed, or `null`. Shown in the dialog while it is open. */
  error: string | null
  /** Why a restore was refused, shown above the deleted groups, or `null`. */
  restoreError?: string | null
  /** Restores a deleted group. */
  onRestore?: (groupId: string) => void
  /** The group being restored, or `null`. */
  restoringId?: string | null
  /** Creates a group named `name`. The dialog closes once `creating` ends without an error. */
  onCreate?: () => void
  /** Opens a group's notes: the app selects the group, then shows `/notes`. */
  onOpen?: (groupId: string) => void
  /** The invitations sent to the person, drawn under the header; the app fills the slot. */
  invitations?: ComponentChildren
  /**
   * Opens the "New group" dialog, on the first render and whenever it turns `true`: the app sets it
   * from the address (`NEW_GROUP_PATH`), so a link can open the dialog.
   */
  createOpen?: boolean
  /** The "New group" dialog closed, by Cancel or by a create that worked: the app drops `?new`. */
  onCreateClose?: () => void
}

/** What a role is called on screen. */
export const ROLE_TEXT: Record<GroupRole, string> = {
  [GroupRole.VIEWER]: "Viewer",
  [GroupRole.EDITOR]: "Editor",
  [GroupRole.ADMIN]: "Admin",
  [GroupRole.OWNER]: "Owner",
}

/**
 * The groups page: one row per group with the person's role, the members' avatars and a quiet mark
 * on the current group. A row opens the group's notes; its cog opens the group's settings. "New
 * group" in the header, and a link to `NEW_GROUP_PATH`, open a dialog with the name field. Deleted
 * groups the person can still restore are listed under the groups, each with a Restore button.
 */
export function GroupsScreen(
  {
    groups,
    selectedId,
    navigate,
    name,
    onNameChange,
    creating,
    loading,
    error,
    onCreate,
    onOpen,
    deleted = [],
    restoreError = null,
    onRestore,
    restoringId = null,
    invitations,
    createOpen = false,
    onCreateClose,
  }: GroupsScreenProps,
): JSX.Element {
  const [creatingOpen, setCreatingOpen] = useState(createOpen)
  // The address opens and closes the dialog: `?new` dropped by Back closes it too.
  useEffect(() => setCreatingOpen(createOpen), [createOpen])
  const closeCreate = () => {
    setCreatingOpen(false)
    onCreateClose?.()
  }
  useSucceeded(creating, error !== null, closeCreate)
  // A refused create lands the person on the name to fix.
  const nameInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (error && creatingOpen) nameInput.current?.focus()
  }, [error])
  // A refused restore has no field to fix, so focus lands on the message above the list.
  const restoreMessage = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (restoreError) restoreMessage.current?.focus()
  }, [restoreError])

  return (
    <Stack gap="xl">
      <PageHeader
        title="Groups"
        action={
          <PageAction
            label="New group"
            Icon={IconPlus}
            onClick={() => setCreatingOpen(true)}
            dataE2E="group-new"
          />
        }
      />
      {invitations}
      {!creatingOpen && groups.length > 0 && <ErrorState message={error} />}
      {groups.length === 0
        ? (
          <Card>
            <EmptyState
              headingLevel={2}
              inset
              title={loading ? "Loading groups..." : "No groups yet."}
              description={loading
                ? undefined
                : error ?? `A group holds the notes you share with the people you invite.`}
              action={!loading && (
                <Button onClick={() => setCreatingOpen(true)} data-e2e="group-new-empty">
                  New group
                </Button>
              )}
            />
          </Card>
        )
        : (
          <Card>
            <ul class="divide-y divide-subtle" data-e2e="group-list" aria-label="Your groups">
              {groups.map((group) => (
                <GroupItem
                  key={group.id}
                  group={group}
                  selected={group.id === selectedId}
                  navigate={navigate}
                  onOpen={onOpen}
                />
              ))}
            </ul>
          </Card>
        )}

      {(deleted.length > 0 || restoreError) && (
        <SettingGroup
          title="Deleted groups"
          description={`A deleted group and its notes can be restored for ${GROUP_RESTORE_DAYS} days. After that they are deleted for good.`}
        >
          <div ref={restoreMessage} tabIndex={-1} data-e2e="group-restore-error">
            <ErrorState message={restoreError} />
          </div>
          {deleted.length > 0 && (
            <Card>
              <ul class="divide-y divide-subtle" data-e2e="deleted-group-list">
                {deleted.map((group) => (
                  <li
                    key={group.id}
                    class="flex min-h-14 items-center gap-3 px-4 py-3 sm:px-6"
                    data-e2e={`deleted-group-${group.id}`}
                  >
                    <div class="flex min-w-0 flex-1 flex-col gap-1">
                      <span
                        class="line-clamp-2 break-words text-sm font-medium"
                        title={group.name}
                        data-e2e="deleted-group-name"
                      >
                        {group.name}
                      </span>
                      <span class="text-sm text-muted">
                        Restorable until{" "}
                        <time dateTime={restorableUntil(group.deletedAt)}>
                          {restorableUntil(group.deletedAt).slice(0, 10)}
                        </time>
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      class="min-h-11 sm:min-h-9"
                      aria-label={`Restore ${group.name}`}
                      data-e2e="group-restore"
                      busy={restoringId === group.id}
                      busyLabel="Restoring..."
                      disabled={restoringId !== null}
                      onClick={() => onRestore?.(group.id)}
                    >
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </SettingGroup>
      )}

      {creatingOpen && (
        <Modal
          open
          title="New group"
          cancelLabel="Close"
          onClose={closeCreate}
          dataE2E="group-new-dialog"
        >
          <ScreenForm pending={creating} onSubmit={onCreate}>
            <Stack>
              <Field id="group-name" label="Name" error={error} required>
                <Input
                  ref={nameInput}
                  data-e2e="group-name"
                  name="name"
                  autocomplete="off"
                  maxLength={100}
                  value={name}
                  onInput={(e) => onNameChange?.(e.currentTarget.value)}
                  required
                  autoFocus
                />
              </Field>
              <Cluster justify="end">
                <Button type="button" variant="outline" onClick={closeCreate}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  data-e2e="group-create"
                  busy={creating}
                  busyLabel="Creating..."
                >
                  Create group
                </Button>
              </Cluster>
            </Stack>
          </ScreenForm>
        </Modal>
      )}
    </Stack>
  )
}

/** One group's row: opens its notes, with a cog to its settings. */
function GroupItem(
  { group, selected, navigate, onOpen }: {
    group: GroupRow
    selected: boolean
    navigate?: Navigate
    onOpen?: (groupId: string) => void
  },
): JSX.Element {
  return (
    <li class="flex min-h-14 items-center gap-3 px-4 py-3 sm:px-6" data-e2e={`group-${group.id}`}>
      <button
        type="button"
        class="flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center gap-1 rounded-md text-left"
        aria-label={`Open notes in ${group.name}${selected ? ", the current group" : ""}`}
        data-e2e="group-open"
        onClick={() =>
          onOpen?.(group.id)}
      >
        <span class="flex min-w-0 max-w-full items-center gap-2">
          <GroupMark color={group.color} emoji={group.emoji} size="sm" />
          <span
            class="line-clamp-2 break-words text-sm font-medium"
            title={group.name}
            data-e2e="group-item-name"
          >
            {group.name}
          </span>
          {selected && (
            <span class="flex shrink-0 text-muted" data-e2e="group-current">
              <IconCheck class="size-4" aria-hidden="true" />
            </span>
          )}
        </span>
        <span class="line-clamp-2 max-w-full text-sm text-muted">
          {ROLE_TEXT[group.role]}
          {group.description && (
            <span data-e2e="group-item-description">{` · ${group.description}`}</span>
          )}
        </span>
      </button>
      {group.memberCount !== undefined && group.members && (
        <AvatarGroup
          items={stackItems(group.members, group.memberCount)}
          label={`Members of ${group.name}`}
          size="xs"
          max={3}
        />
      )}
      <Button
        href={GROUP_PATHS.settings(group.id)}
        navigate={navigate}
        variant="icon"
        aria-label={`Settings of ${group.name}`}
        class="min-h-11 min-w-11 justify-center"
        data-e2e="group-settings"
      >
        <IconCog6Tooth class="size-5" aria-hidden="true" />
      </Button>
    </li>
  )
}

/** When a group deleted at `deletedAt` stops being restorable, as an ISO string (UTC). */
function restorableUntil(deletedAt: string): string {
  return new Date(new Date(deletedAt).getTime() + GROUP_RESTORE_DAYS * 24 * 60 * 60_000)
    .toISOString()
}

/**
 * The avatars of a group's row: the members the list named, then a nameless one for each member it
 * did not, so the stack's `+N` chip and its label count everyone.
 */
function stackItems(
  members: readonly { name: string }[],
  count: number,
): { name: string }[] {
  const unnamed = Math.max(0, count - members.length)
  return [...members, ...Array.from({ length: unnamed }, () => ({ name: "" }))]
}
