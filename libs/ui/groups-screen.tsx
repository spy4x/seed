import type { ComponentChildren, JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { IconChevronDown, IconChevronRight, IconPlus } from "@spy4x/preact-icons"
import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { DropdownItem } from "@spy4x/preact-ui/dropdown"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Stack } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { Rich } from "@spy4x/preact-ui/i18n"
import { GROUP_RESTORE_DAYS, type GroupColor, GroupRole } from "@domain/groups"
import { GroupMark } from "./group-appearance.tsx"
import { PageAction, PageHeader } from "@spy4x/preact-ui/page-header"
import { GROUP_PATHS, type Navigate } from "./progressive.tsx"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { useAppText } from "./i18n.ts"

/** The page that creates a group: the same editor as a group's own page, with empty fields. */
export const NEW_GROUP_PATH = GROUP_PATHS.new

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
  /** How many members the group has, when it is known. */
  memberCount?: number
  /** The first few members, oldest first. */
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
  /** Follows a link without a page load; without it every link is an ordinary one. */
  navigate?: Navigate
  /** The list is being fetched. */
  loading: boolean
  /** Why the list could not be read, or `null`. */
  error: string | null
  /**
   * Why the last read of the list failed, or `null`. With no groups to show it takes the place of
   * the list, with "Try again" and no "New group": the person may well have groups.
   */
  loadError?: string | null
  /** Reads the list again, from "Try again" after a failed read. */
  onRetry?: () => void
  /** Why a restore was refused, shown above the deleted groups, or `null`. */
  restoreError?: string | null
  /** Restores a deleted group. */
  onRestore?: (groupId: string) => void
  /** The group being restored, or `null`. */
  restoringId?: string | null
  /** The invitations sent to the person, drawn under the header; the app fills the slot. */
  invitations?: ComponentChildren
}

/** Each role's name, by its key in the `app` catalog. */
const ROLE_KEYS: Record<GroupRole, string> = {
  [GroupRole.VIEWER]: `Groups.roleViewer`,
  [GroupRole.EDITOR]: `Groups.roleEditor`,
  [GroupRole.ADMIN]: `Groups.roleAdmin`,
  [GroupRole.OWNER]: `Groups.roleOwner`,
}

/** What a role is called on screen, in the person's language. */
export function roleName(t: Translator<string>, role: GroupRole): string {
  return t.t(ROLE_KEYS[role])
}

/**
 * What a role is called, in English. Only the search palette reads it, until its own screens are
 * translated (#275); every group screen uses {@link roleName}.
 */
export const ROLE_TEXT: Record<GroupRole, string> = {
  [GroupRole.VIEWER]: "Viewer",
  [GroupRole.EDITOR]: "Editor",
  [GroupRole.ADMIN]: "Admin",
  [GroupRole.OWNER]: "Owner",
}

/**
 * The groups page: one row per group, the whole row a link to the group's page, with the person's
 * role and "Current" on the group the notes show. "New group" in the header opens the create page;
 * its "More actions" menu opens the import page.
 * Deleted groups the person can still restore sit under a closed disclosure, each with Restore.
 */
export function GroupsScreen(
  {
    groups,
    selectedId,
    navigate,
    loading,
    error,
    loadError = null,
    onRetry,
    deleted = [],
    restoreError = null,
    onRestore,
    restoringId = null,
    invitations,
  }: GroupsScreenProps,
): JSX.Element {
  const t = useAppText()
  // A refused restore has no field to fix, so focus lands on the message above the list. The
  // disclosure opens for it, or the message would be hidden.
  const restoreMessage = useRef<HTMLDivElement>(null)
  const disclosure = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (!restoreError) return
    if (disclosure.current) disclosure.current.open = true
    restoreMessage.current?.focus()
  }, [restoreError])

  // A failed read with nothing to show is not "no groups": the page says so and offers a retry,
  // and "New group" waits until the list is known.
  const readFailed = groups.length === 0 && loadError !== null

  return (
    <Stack gap="xl">
      <PageHeader
        title={t.t(`Groups.title`)}
        action={!readFailed && (
          <PageAction
            label={t.t(`Groups.new`)}
            Icon={IconPlus}
            href={NEW_GROUP_PATH}
            navigate={navigate}
            dataE2E="group-new"
          />
        )}
        // Rare actions go in the menu: "New group" stays the page's one primary action.
        menu={
          <DropdownItem href={GROUP_PATHS.import} navigate={navigate} dataE2E="group-import-open">
            {t.t(`Groups.import`)}
          </DropdownItem>
        }
        menuDataE2E="groups-menu"
      />
      {invitations}
      {groups.length > 0 && <ErrorState message={error} />}
      {readFailed
        ? (
          <div class="flex flex-col items-center gap-3" data-e2e="groups-load-error">
            <ErrorState message={loadError} />
            <Button
              type="button"
              variant="secondary"
              class="min-h-11 sm:min-h-9"
              busy={loading}
              busyLabel={t.t(`Groups.loading`)}
              onClick={onRetry}
              data-e2e="groups-retry"
            >
              {t.t(`Groups.retry`)}
            </Button>
          </div>
        )
        : groups.length === 0
        ? (
          <Card>
            <EmptyState
              headingLevel={2}
              inset
              title={loading ? t.t(`Groups.loading`) : t.t(`Groups.empty`)}
              description={loading ? undefined : error ?? t.t(`Groups.emptyHint`)}
              action={!loading && (
                <Button href={NEW_GROUP_PATH} navigate={navigate} data-e2e="group-new-empty">
                  {t.t(`Groups.new`)}
                </Button>
              )}
            />
          </Card>
        )
        : (
          <Card>
            <ul
              class="divide-y divide-subtle"
              data-e2e="group-list"
              aria-label={t.t(`Groups.listLabel`)}
            >
              {groups.map((group) => (
                <GroupItem
                  key={group.id}
                  group={group}
                  current={group.id === selectedId}
                  navigate={navigate}
                />
              ))}
            </ul>
          </Card>
        )}

      {(deleted.length > 0 || restoreError) && (
        <details ref={disclosure} class="group/deleted" data-e2e="deleted-groups">
          {/* The chevron stands in for the marker a flex summary loses, and turns when it opens. */}
          <summary class="flex min-h-11 cursor-pointer items-center gap-2 rounded-md text-sm font-semibold text-foreground">
            {t.t(`Groups.deleted`, { count: deleted.length })}
            <IconChevronDown
              aria-hidden="true"
              class="size-4 shrink-0 transition-transform group-open/deleted:rotate-180"
            />
          </summary>
          <Stack gap="sm" class="mt-2">
            <p class="text-sm text-muted">
              {t.t(`Groups.deletedHint`, { count: GROUP_RESTORE_DAYS })}
            </p>
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
                          translate={false}
                          data-e2e="deleted-group-name"
                        >
                          {group.name}
                        </span>
                        <span class="text-sm text-muted">
                          <Rich
                            parts={t.parts(`Groups.restorableUntil`, {
                              date: restorableUntil(group.deletedAt).slice(0, 10),
                            })}
                            tags={{
                              value: (date) => (
                                <time dateTime={restorableUntil(group.deletedAt)}>{date}</time>
                              ),
                            }}
                          />
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        class="min-h-11 sm:min-h-9"
                        aria-label={t.t(`Groups.restoreNamed`, { name: group.name })}
                        data-e2e="group-restore"
                        busy={restoringId === group.id}
                        busyLabel={t.t(`Groups.restoring`)}
                        disabled={restoringId !== null}
                        onClick={() => onRestore?.(group.id)}
                      >
                        {t.t(`Groups.restore`)}
                      </Button>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </Stack>
        </details>
      )}
    </Stack>
  )
}

/** How many people a group has, for its row: "Only you" for a group of one. */
function membersText(t: Translator<string>, count: number): string {
  return count === 1 ? t.t(`Groups.onlyYou`) : t.t(`Groups.members`, { count })
}

/**
 * One group's row: its mark, its name and "Current" on the current group, its role, how many
 * members it has and its description. The name is a link stretched over the whole row, so a tap anywhere opens the group's
 * page, and a screen reader hears one link per group.
 */
function GroupItem(
  { group, current, navigate }: { group: GroupRow; current: boolean; navigate?: Navigate },
): JSX.Element {
  const t = useAppText()
  return (
    <li class="relative transition-colors hover:bg-hover" data-e2e={`group-${group.id}`}>
      <div class="flex min-h-14 items-center gap-3 px-4 py-3 sm:px-6">
        <GroupMark color={group.color} emoji={group.emoji} />
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="flex min-w-0 items-baseline gap-2">
            <Link
              href={GROUP_PATHS.settings(group.id)}
              navigate={navigate}
              aria-label={current ? t.t(`Groups.currentNamed`, { name: group.name }) : undefined}
              class="line-clamp-2 min-w-0 break-words text-sm font-medium text-foreground after:absolute after:inset-0 focus-visible:outline-hidden focus-visible:after:ring-2 focus-visible:after:ring-focus focus-visible:after:ring-inset"
              title={group.name}
              data-e2e="group-open"
            >
              <span translate={false} data-e2e="group-item-name">{group.name}</span>
            </Link>
            {current && (
              <span class="shrink-0 text-sm text-muted" aria-hidden="true" data-e2e="group-current">
                {t.t(`Groups.current`)}
              </span>
            )}
          </span>
          <span class="line-clamp-2 max-w-full text-sm text-muted">
            {roleName(t, group.role)}
            {group.memberCount !== undefined && (
              <span data-e2e="group-item-members">{` · ${membersText(t, group.memberCount)}`}</span>
            )}
            {group.description && (
              <span data-e2e="group-item-description">
                {` · `}
                <bdi translate={false}>{group.description}</bdi>
              </span>
            )}
          </span>
        </div>
        <IconChevronRight aria-hidden="true" class="size-4 shrink-0 text-muted" />
      </div>
    </li>
  )
}

/** When a group deleted at `deletedAt` stops being restorable, as an ISO string (UTC). */
function restorableUntil(deletedAt: string): string {
  return new Date(new Date(deletedAt).getTime() + GROUP_RESTORE_DAYS * 24 * 60 * 60_000)
    .toISOString()
}
