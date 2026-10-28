// deno-lint-ignore-file ui-text/no-literal
import type { ComponentChildren, JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { IconPlus } from "@spy4x/preact-icons"
import { Button } from "@spy4x/preact-ui/button"
import { Link } from "@spy4x/preact-ui/link"
import { Card } from "@spy4x/preact-ui/card"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { DropdownItem } from "@spy4x/preact-ui/dropdown"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input, Textarea } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { Modal } from "@spy4x/preact-ui/modal"
import { Notice } from "@spy4x/preact-ui/notice"
import { ColorField } from "@spy4x/preact-ui/color-field"
import { Tabs } from "@spy4x/preact-ui/tabs"
import {
  canDelete,
  canExportGroup,
  canLeave,
  canManageInvitations,
  canMutateNotes,
  canRename,
  canViewActivity,
  GROUP_DESCRIPTION_MAX,
  GROUP_RESTORE_DAYS,
  type GroupColor,
  GroupRole,
} from "@domain/groups"
import { GroupMark } from "./group-appearance.tsx"
import { type GroupRow, ROLE_TEXT } from "./groups-screen.tsx"
import { type GroupMemberRow, GroupMembersSection, type MemberError } from "./group-members.tsx"
import { useSucceeded } from "@spy4x/preact-ui/use-succeeded"
import { useFreshError } from "@spy4x/preact-ui/use-fresh-error"
import { PageAction, PageHeader } from "@spy4x/preact-ui/page-header"
import { transferCandidates } from "./group-transfer.tsx"
import type { PersonTrial, PlanRefusal } from "@domain/billing"
import { GroupMoveAllForm, type MoveAllResult } from "./group-move-all.tsx"
import type { MoveTarget } from "./notes-screen.tsx"
import { GROUP_PATHS, type Navigate, SCREEN_PATHS, ScreenForm } from "./progressive.tsx"
import { FORM_WIDTH, useWaited } from "./tag-editor-screen.tsx"

/** What the editor's fields hold. The emoji is the text typed, an empty string for none. */
export interface GroupDraft {
  name: string
  description: string
  color: GroupColor | null
  emoji: string
}

/** The fields of a new group: all empty. */
export const EMPTY_GROUP_DRAFT: GroupDraft = { name: "", description: "", color: null, emoji: "" }

/** Why the last create or save was refused: under the field it is about, or under the form. */
export interface GroupEditorErrors {
  name?: string | null
  description?: string | null
  emoji?: string | null
  form?: string | null
}

/** The tabs of a group's page, each at an address of its own (`GROUP_TAB_PATHS`). */
export enum GroupTab {
  GENERAL = "general",
  MEMBERS = "members",
  BILLING = "billing",
  ACTIVITY = "activity",
}

/** Where each tab of a group's page lives. */
export const GROUP_TAB_PATHS: Record<GroupTab, (groupId: string) => string> = {
  [GroupTab.GENERAL]: GROUP_PATHS.settings,
  [GroupTab.MEMBERS]: GROUP_PATHS.members,
  [GroupTab.BILLING]: GROUP_PATHS.billing,
  [GroupTab.ACTIVITY]: GROUP_PATHS.activity,
}

/** The tab an address's last part names (`members` of `/groups/:id/members`), or `null`. */
export function groupTabOf(part: string | undefined): GroupTab | null {
  if (part === undefined) return GroupTab.GENERAL
  return part !== GroupTab.GENERAL && Object.values(GroupTab).includes(part as GroupTab)
    ? part as GroupTab
    : null
}

export interface GroupEditorScreenProps {
  /** The page creates a group (`/groups/new`) rather than editing one (`/groups/:groupId`). */
  creating?: boolean
  /** The tab of an existing group's page that is open. Defaults to General. */
  tab?: GroupTab
  /** The group being edited, or `null` on the create page, while it is read, or when it is not one of the person's. */
  group: GroupRow | null
  /** Whether this group is the person's current group, the one the notes show. */
  current: boolean
  /** The group is being read: an unknown group is not "missing" yet. */
  loading: boolean
  /** Why the group could not be read, or `null`. Shown instead of "loading" or "missing". */
  error?: string | null
  /** What the fields show: what the person typed, or the group as saved. */
  value: GroupDraft
  onChange?: (value: GroupDraft) => void
  /** The messages of the last refused create or save. */
  errors?: GroupEditorErrors
  /**
   * A field differs from what is saved. On an existing group the footer with Discard and Save
   * shows only then.
   */
  /**
   * The device has no network. Writing a group needs a connection, so the page says so before the
   * person fills anything in.
   */
  offline?: boolean
  dirty?: boolean
  /** A create or a save is in flight. */
  saving?: boolean
  /** Creates the group, or saves the changes to it. */
  onSave?: () => void
  /** Puts the fields back to the group as saved. */
  onDiscard?: () => void
  /** Makes this group the current one. The menu offers it while the group is not current. */
  onSwitch?: () => void
  /** Follows a link without a page load; without it every link is an ordinary one. */
  navigate?: Navigate
  /**
   * This is the only group the person has, so they can neither leave nor delete it: the menu says
   * so beside the disabled item. The server refuses both too.
   */
  isLastGroup?: boolean
  /**
   * The group has a subscription that is not cancelled, so it can be neither deleted nor transferred
   * until the owner cancels it in the billing portal: the menu says so beside the disabled items.
   */
  hasSubscription?: boolean
  /** A delete is in flight. */
  deleting?: boolean
  /** Why the delete was refused, shown in its dialog, or `null`. */
  deleteError?: string | null
  /** Deletes the group, once the owner confirmed it. */
  onDelete?: () => void
  /** The members, oldest first; `null` while they are read. */
  members?: readonly GroupMemberRow[] | null
  /** How many members the group has; see `GroupMembersSectionProps.memberCount`. */
  memberCount?: number | null
  /** Why the members could not be read, or `null`. */
  membersError?: string | null
  /** The member whose role change or removal is in flight, or `null`. */
  memberPendingId?: number | null
  /** The last refused member change, shown under that member, or `null`. */
  memberError?: MemberError | null
  /** Gives a member a new role. */
  onRoleChange?: (userId: number, role: GroupRole) => void
  /** Removes a member, once the person confirmed it. */
  onRemoveMember?: (userId: number) => void
  /** A leave is in flight. */
  leaving?: boolean
  /** Why the leave was refused, shown in its dialog, or `null`. */
  leaveError?: string | null
  /** Leaves the group, once the person confirmed it. */
  onLeave?: () => void
  /**
   * On the create page, the person's own trial: the page says whether the new group can start one.
   * Left out, or with billing off, it says nothing about plans.
   */
  trial?: PersonTrial | null
  /** The Plan and billing tab's content (`GroupBillingPanel`). */
  billing?: ComponentChildren
  /** The Activity tab's content (`GroupActivityPanel`), for the admins and the owner. */
  activity?: ComponentChildren
  /** The pending invitations (`PendingInvitations`), drawn under the members. */
  pendingInvitations?: ComponentChildren
  /**
   * The body of the "Transfer ownership" dialog (`GroupTransferForm`), given the function that
   * closes it. The menu offers it to the owner of a group with someone to hand it to.
   */
  transfer?: (close: () => void) => ComponentChildren
  /**
   * The groups the person may write to, other than this one. The menu offers "Move all data to…"
   * to an editor or above, and only when there is a group to move to and `onMoveAll` is given.
   */
  moveTargets?: readonly MoveTarget[]
  /** Moves every note of the group to the chosen group. */
  onMoveAll?: (toGroupId: string) => void
  /** A move of all the data is in flight. */
  movingAll?: boolean
  /** Why the move was refused, shown in its dialog, or `null`. */
  moveAllError?: string | null
  /** The target group's plan refused the move; shown in the dialog as the plan notice. */
  moveAllRefusal?: PlanRefusal | null
  /** The finished move, shown in its dialog with the choice to delete the group; or `null`. */
  moveAllResult?: MoveAllResult | null
  /** The person picked another target in the move dialog: the app forgets the refusal. */
  onMoveAllTargetChange?: () => void
  /** The move dialog closed: the app forgets the finished move and any error. */
  onMoveAllClose?: () => void
  /**
   * Downloads the group's export file. The menu offers "Export group…" to the owner only, and
   * disables it while the device is offline.
   */
  onExport?: () => void
  /** The export's file is being prepared: the menu item says so. */
  exporting?: boolean
  /** The last export failed: the page says so above the form, with "Try again". */
  exportFailed?: boolean
}

/** Which of the header menu's dialogs is open. */
enum Dialog {
  TRANSFER = 1,
  LEAVE = 2,
  DELETE = 3,
  MOVE_ALL = 5,
}

const BACK = { href: SCREEN_PATHS.groups, label: "Back to groups" }

/**
 * One group's page, and the page that creates one: the same form in both. `/groups/new` shows the
 * form with "Cancel" and "Create group". An existing group shows its mark, name and the person's
 * role, then four tabs, each at its own address: General (the form, or read-only text for someone
 * who may not change it, with the footer only while a field differs from what is saved), Members
 * (with "Invite" in the header for the owner and admins), Plan and billing, and Activity (for the
 * admins and the owner). Its "More actions" menu switches to the group, downloads the owner's
 * export file, and holds transfer, move, leave and delete, each behind a dialog.
 */
export function GroupEditorScreen(props: GroupEditorScreenProps): JSX.Element {
  const { group, navigate } = props
  const waited = useWaited(props.loading && !group)
  if (props.creating) {
    return (
      <Stack gap="xl">
        <PageHeader
          title="New group"
          titleDataE2E="group-new-title"
          // The colour and emoji chosen so far, as the group's mark will show them.
          mark={<GroupMark color={props.value.color} emoji={props.value.emoji.trim() || null} />}
          back={BACK}
          navigate={navigate}
        />
        <GroupForm {...props} creating />
      </Stack>
    )
  }
  if (!group) {
    return (
      <Stack gap="xl">
        <PageHeader title="Group" back={BACK} navigate={navigate} />
        {props.error ? <ErrorState message={props.error} /> : props.loading
          ? (
            // Nothing for a short read, so a fast one does not flash; a placeholder after that.
            waited && (
              <div data-e2e="group-loading">
                <p role="status" class="sr-only">Loading the group…</p>
                <LoadingSkeleton rows={1} class={FORM_WIDTH} />
              </div>
            )
          )
          : (
            <Card>
              <EmptyState
                inset
                headingLevel={2}
                title="This group does not exist."
                description="It may have been deleted, or you are not a member."
                action={
                  <Button href={SCREEN_PATHS.groups} navigate={navigate} variant="outline">
                    Back to groups
                  </Button>
                }
              />
            </Card>
          )}
      </Stack>
    )
  }
  return <ExistingGroup {...props} group={group} />
}

/** The page of a group the person is a member of. */
function ExistingGroup(props: GroupEditorScreenProps & { group: GroupRow }): JSX.Element {
  const {
    group,
    current,
    navigate,
    onSwitch,
    isLastGroup = false,
    hasSubscription = false,
    deleting = false,
    deleteError = null,
    onDelete,
    members = null,
    memberCount = null,
    membersError = null,
    memberPendingId = null,
    memberError = null,
    onRoleChange,
    onRemoveMember,
    leaving = false,
    leaveError = null,
    onLeave,
    tab = GroupTab.GENERAL,
    billing,
    activity,
    pendingInvitations,
    transfer,
    moveTargets = [],
    onMoveAll,
    movingAll = false,
    moveAllError = null,
    moveAllResult = null,
    moveAllRefusal = null,
    onMoveAllClose,
    onMoveAllTargetChange,
    onExport,
    exporting = false,
    exportFailed = false,
    offline = false,
  } = props
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const close = () => {
    if (dialog === Dialog.MOVE_ALL) onMoveAllClose?.()
    setDialog(null)
  }
  useSucceeded(leaving, leaveError !== null, close)
  useSucceeded(deleting, deleteError !== null, close)
  const [freshLeaveError, leaveOpened] = useFreshError(leaveError, leaving)
  const [freshDeleteError, deleteOpened] = useFreshError(deleteError, deleting)
  // A transfer that went through makes the person an admin, and the owner's dialog goes with the
  // role. Focus goes to the menu that opened it, where a closed dialog would have put it.
  const header = useRef<HTMLDivElement>(null)
  const handedOver = dialog === Dialog.TRANSFER && group.role !== GroupRole.OWNER
  useEffect(() => {
    if (!handedOver) return
    setDialog(null)
    header.current?.querySelector<HTMLElement>("[data-e2e=group-menu]")?.focus()
  }, [handedOver])

  // Only the owner has candidates: `transferCandidates` asks `canTransfer`, which needs the owner.
  const canHandOver = transfer !== undefined &&
    transferCandidates(group.role, members).length > 0
  const subscriptionBlocks = hasSubscription ? "Cancel its subscription first" : null
  const deleteBlocked = isLastGroup ? "It is your only group" : subscriptionBlocks

  const canMoveAll = onMoveAll !== undefined && moveTargets.length > 0 &&
    canMutateNotes(group.role)

  // The menu in three parts, a divider between two parts that both have an item.
  const going = [
    !current && onSwitch && (
      <DropdownItem key="switch" dataE2E="group-switch" onClick={onSwitch}>
        Switch to this group
      </DropdownItem>
    ),
  ].filter(Boolean)
  const handing = [
    canHandOver && (
      <DropdownItem
        key="transfer"
        disabled={subscriptionBlocks !== null}
        dataE2E="group-transfer-open"
        onClick={() => setDialog(Dialog.TRANSFER)}
      >
        <MenuText
          text="Transfer ownership"
          hint={subscriptionBlocks}
          hintDataE2E="group-transfer-why"
        />
      </DropdownItem>
    ),
    onExport && canExportGroup(group.role) && (
      <DropdownItem
        key="export"
        disabled={offline || exporting}
        dataE2E="group-export"
        onClick={onExport}
      >
        <MenuText
          text={exporting ? "Preparing…" : "Export group…"}
          hint={offline ? "You are offline" : null}
          hintDataE2E="group-export-why"
        />
      </DropdownItem>
    ),
    canMoveAll && (
      <DropdownItem
        key="move"
        dataE2E="group-move-all-open"
        onClick={() => setDialog(Dialog.MOVE_ALL)}
      >
        Move all data…
      </DropdownItem>
    ),
  ].filter(Boolean)
  const ending = [
    canLeave(group.role) && (
      <DropdownItem
        key="leave"
        danger
        disabled={isLastGroup}
        dataE2E="group-leave-open"
        onClick={() => {
          leaveOpened()
          setDialog(Dialog.LEAVE)
        }}
      >
        <MenuText
          text="Leave group"
          hint={isLastGroup ? "It is your only group" : null}
          hintDataE2E="group-leave-why"
        />
      </DropdownItem>
    ),
    canDelete(group.role) && (
      <DropdownItem
        key="delete"
        danger
        disabled={deleteBlocked !== null}
        dataE2E="group-delete-open"
        onClick={() => {
          deleteOpened()
          setDialog(Dialog.DELETE)
        }}
      >
        <MenuText text="Delete group" hint={deleteBlocked} hintDataE2E="group-delete-why" />
      </DropdownItem>
    ),
  ].filter(Boolean)
  const parts = [going, handing, ending].filter((part) => part.length > 0)
  const menu = parts.length > 0 && parts.map((part, index) => (
    <>
      {index > 0 && <div role="separator" class="my-1 border-t border-subtle" />}
      {part}
    </>
  ))

  // On a phone the tab row scrolls sideways: the open tab is brought into view, so Activity, the
  // last one, is not left cut off at the edge when its address is opened.
  const tabRow = useRef<HTMLDivElement>(null)
  useEffect(() => {
    tabRow.current?.querySelector("[role=tab][aria-selected=true]")?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
    })
  }, [tab])

  // The member count says what a per-member plan bills for, so it leads to the plan.
  const count = memberCount ?? members?.length ?? group.memberCount
  const countText = count === undefined || count === null
    ? null
    : `${count} ${count === 1 ? "member" : "members"}`
  const tabs = [
    { id: GroupTab.GENERAL, label: "General" },
    { id: GroupTab.MEMBERS, label: "Members" },
    { id: GroupTab.BILLING, label: "Plan and billing" },
    // Left out for a role that may not read the log, unless its address was opened anyway.
    ...(canViewActivity(group.role) || tab === GroupTab.ACTIVITY
      ? [{ id: GroupTab.ACTIVITY, label: "Activity" }]
      : []),
  ].map((item) => ({
    id: `group-tab-${item.id}`,
    label: item.label,
    content: item.id !== tab
      ? null
      : item.id === GroupTab.GENERAL
      ? (canRename(group.role) ? <GroupForm {...props} /> : <GroupDetailsText group={group} />)
      : item.id === GroupTab.MEMBERS
      ? (
        <GroupMembersSection
          groupId={group.id}
          actorRole={group.role}
          members={members}
          memberCount={memberCount}
          error={membersError}
          pendingUserId={memberPendingId}
          memberError={memberError}
          onRoleChange={onRoleChange}
          onRemove={onRemoveMember}
          navigate={navigate}
        >
          {pendingInvitations}
        </GroupMembersSection>
      )
      : item.id === GroupTab.BILLING
      ? billing
      : activity,
  }))

  return (
    <Stack>
      <div ref={header}>
        <PageHeader
          title={group.name}
          titleDataE2E="group-general-name"
          mark={canRename(group.role)
            // The fields' colour and emoji, so the mark follows a change before it is saved.
            ? <GroupMark color={props.value.color} emoji={props.value.emoji.trim() || null} />
            : <GroupMark color={group.color} emoji={group.emoji} />}
          subtitle={
            <>
              <span data-e2e="group-general-role">{ROLE_TEXT[group.role]}</span>
              {countText && (
                <>
                  {" · "}
                  {tab === GroupTab.BILLING
                    ? <span data-e2e="group-member-count">{countText}</span>
                    : (
                      <Link
                        href={GROUP_PATHS.billing(group.id)}
                        navigate={navigate}
                        class="pc-link"
                        aria-label={`${countText}: see the plan and billing`}
                        data-e2e="group-member-count"
                      >
                        {countText}
                      </Link>
                    )}
                </>
              )}
              {current && <span data-e2e="group-current">&nbsp;· your current group</span>}
            </>
          }
          back={BACK}
          navigate={navigate}
          action={tab === GroupTab.MEMBERS && canManageInvitations(group.role) && (
            <PageAction
              label="Invite"
              Icon={IconPlus}
              href={GROUP_PATHS.invite(group.id)}
              navigate={navigate}
              dataE2E="invite-open"
            />
          )}
          menu={menu}
          menuDataE2E="group-menu"
        />
      </div>

      {exportFailed && (
        <div data-e2e="group-export-failed">
          <Notice
            tone="danger"
            urgent
            action={onExport && (
              <Button size="sm" variant="secondary" disabled={offline} onClick={onExport}>
                Try again
              </Button>
            )}
          >
            We could not prepare the file. Nothing in your group changed.
          </Notice>
        </div>
      )}

      {/* One row that scrolls sideways on a phone; the arrow keys still move between tabs. */}
      <div ref={tabRow}>
        <Tabs
          tabs={tabs}
          active={`group-tab-${tab}`}
          onChange={(id) =>
            navigate?.(GROUP_TAB_PATHS[id.replace("group-tab-", "") as GroupTab](group.id))}
          lazy
          label={`About ${group.name}`}
          listClass="flex-nowrap overflow-x-auto pb-px"
          panelClass="pt-6"
          tabDataE2E="group-tab"
        />
      </div>

      {dialog === Dialog.TRANSFER && canHandOver && (
        <Modal
          open
          title={`Transfer "${group.name}"`}
          cancelLabel="Close"
          closeOnBackdrop={false}
          onClose={close}
          dataE2E="group-transfer-dialog"
        >
          {transfer(close)}
        </Modal>
      )}

      {dialog === Dialog.MOVE_ALL && canMoveAll && (
        <Modal
          open
          title={`Move all data of "${group.name}"`}
          cancelLabel="Close"
          closeOnBackdrop={false}
          onClose={close}
          dataE2E="group-move-all-dialog"
        >
          <GroupMoveAllForm
            groupName={group.name}
            targets={moveTargets}
            moving={movingAll}
            error={moveAllError}
            refusal={moveAllRefusal}
            navigate={navigate}
            result={moveAllResult}
            onMove={onMoveAll}
            onTargetChange={onMoveAllTargetChange}
            onCancel={close}
            onDelete={canDelete(group.role) && deleteBlocked === null
              ? () => {
                onMoveAllClose?.()
                deleteOpened()
                setDialog(Dialog.DELETE)
              }
              : undefined}
          />
        </Modal>
      )}

      {dialog === Dialog.LEAVE && (
        <ConfirmDialog
          title={`Leave "${group.name}"?`}
          confirmLabel="Leave group"
          cancelLabel="Cancel"
          tone="danger"
          dataE2E="group-leave-dialog"
          onConfirm={() => {
            if (!leaving) onLeave?.()
          }}
          onCancel={close}
        >
          <div class="flex flex-col gap-4">
            <p class="text-sm text-muted" data-e2e="group-leave-confirmation">
              You lose access right away, on every device. What you wrote stays in the group. To
              come back, someone must add you again.
            </p>
            <ErrorState focusOnAppear message={freshLeaveError} dataE2E="group-leave-error" />
          </div>
        </ConfirmDialog>
      )}

      {dialog === Dialog.DELETE && (
        <ConfirmDialog
          title={`Delete "${group.name}"?`}
          confirmLabel="Delete group"
          cancelLabel="Cancel"
          tone="danger"
          dataE2E="group-delete-dialog"
          onConfirm={() => {
            if (!deleting) onDelete?.()
          }}
          onCancel={close}
        >
          <div class="flex flex-col gap-4">
            <p class="text-sm text-muted" data-e2e="group-delete-confirmation">
              It disappears for every member right away, with everything in it. Members who have it
              open are switched to another of their groups, and anyone left with no group gets a new
              empty one named "Personal". You can restore it from the Groups page for{" "}
              {GROUP_RESTORE_DAYS}{" "}
              days. After that it and everything in it are deleted for good and cannot be recovered.
            </p>
            <ErrorState focusOnAppear message={freshDeleteError} dataE2E="group-delete-error" />
          </div>
        </ConfirmDialog>
      )}
    </Stack>
  )
}

/**
 * The form of a new or an existing group: name, description, emoji, colour, and a preview of the
 * group's mark as it will look. A new group's footer is always there; an existing group's only
 * while a field differs from what is saved. When a create or a save is refused, focus moves to the
 * first field it names, or to the message under the form.
 */
function GroupForm(
  {
    creating = false,
    value,
    onChange,
    errors = {},
    dirty = false,
    saving = false,
    onSave,
    onDiscard,
    navigate,
    group,
    offline = false,
    trial = null,
  }: GroupEditorScreenProps,
): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const first = errors.name
      ? "name"
      : errors.description
      ? "description"
      : errors.emoji
      ? "emoji"
      : null
    if (first) box.current?.querySelector<HTMLElement>(`[name=${first}]`)?.focus()
  }, [errors])
  // When an existing group's footer goes away (Discard, or a save that went through), the button
  // that held focus goes with it, and the browser drops focus to the page. Focus moves to the name
  // field instead, once the save has finished and the fields are enabled again. Focus the person
  // put in the fields themselves stays where it is.
  const showFooter = creating || dirty
  const shown = useRef({ footer: showFooter, groupId: group?.id })
  const refocus = useRef(false)
  useEffect(() => {
    const before = shown.current
    if (before.footer && !showFooter && group && before.groupId === group.id) {
      refocus.current = true
    }
    shown.current = { footer: showFooter, groupId: group?.id }
    if (!refocus.current || saving) return
    refocus.current = false
    const active = box.current?.ownerDocument.activeElement
    if (active && box.current?.contains(active)) return
    box.current?.querySelector<HTMLElement>("[name=name]")?.focus()
  }, [showFooter, saving, group?.id])
  const change = (patch: Partial<GroupDraft>) => onChange?.({ ...value, ...patch })
  const optional = <span class="ml-2 font-normal text-muted">Optional</span>
  return (
    <>
      {offline && (
        <div data-e2e="group-offline" class={FORM_WIDTH}>
          <Notice title="You are offline">
            {creating
              ? "You can fill this in now. Creating the group needs a connection."
              : "This is the copy saved on this device. Saving changes needs a connection."}
          </Notice>
        </div>
      )}
      <ScreenForm pending={saving} onSubmit={onSave}>
        <div ref={box} class={FORM_WIDTH}>
          <Stack>
            <Field id="group-name" label="Name" error={errors.name} required>
              <Input
                data-e2e="group-name"
                name="name"
                autocomplete="off"
                maxLength={100}
                value={value.name}
                onInput={(e) => change({ name: e.currentTarget.value })}
                required
              />
            </Field>
            <Field
              id="group-description"
              label={<>Description {optional}</>}
              error={errors.description}
              hint={`${
                Array.from(value.description).length
              } of ${GROUP_DESCRIPTION_MAX} characters`}
            >
              <Textarea
                data-e2e="group-description"
                name="description"
                rows={3}
                placeholder="What is this group for?"
                value={value.description}
                onInput={(e) => change({ description: e.currentTarget.value })}
              />
            </Field>
            <Field
              id="group-emoji"
              label={<>Emoji {optional}</>}
              error={errors.emoji}
              hint="Shown before the group's name."
            >
              <Input
                data-e2e="group-emoji"
                name="emoji"
                autocomplete="off"
                placeholder="🏕️"
                class="w-24"
                value={value.emoji}
                onInput={(e) => change({ emoji: e.currentTarget.value })}
              />
            </Field>
            <div data-e2e="group-color">
              <ColorField
                legend={<>Colour {optional}</>}
                name="color"
                allowNone
                hint="Shown behind the group's mark."
                value={value.color}
                onChange={(color) => change({ color })}
              />
            </div>
            {creating && trialText(trial) && (
              <p class="text-sm text-muted" data-e2e="group-trial">{trialText(trial)}</p>
            )}
            <ErrorState focusOnAppear message={errors.form ?? null} dataE2E="group-form-error" />
            {showFooter && (
              // On a phone the primary button is on top at full width; from `sm` up the two are a
              // row at the right, the primary last.
              <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                {creating
                  ? (
                    <Button
                      href={SCREEN_PATHS.groups}
                      navigate={navigate}
                      variant="ghost"
                      class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                      data-e2e="group-cancel"
                    >
                      Cancel
                    </Button>
                  )
                  : (
                    <Button
                      type="button"
                      variant="ghost"
                      class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                      data-e2e="group-discard"
                      disabled={saving}
                      onClick={onDiscard}
                    >
                      Discard
                    </Button>
                  )}
                <Button
                  type="submit"
                  class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                  data-e2e={creating ? "group-create" : "group-save"}
                  busy={saving}
                  busyLabel={creating ? "Creating…" : "Saving…"}
                >
                  {creating ? "Create group" : "Save group"}
                </Button>
              </div>
            )}
          </Stack>
        </div>
      </ScreenForm>
    </>
  )
}

/**
 * What the create page says about the trial, or `null` to say nothing: billing is off, or no plan
 * has a trial and the person never used one. One trial per person (#205), so it names the rule.
 */
export function trialText(trial: PersonTrial | null): string | null {
  if (!trial?.enabled) return null
  if (trial.used) {
    return "New groups start on the free plan. You have used your free trial, so a paid plan " +
      "here is charged from the first day."
  }
  if (trial.days <= 0) return null
  return `New groups start on the free plan. Your ${trial.days}-day free trial of a paid plan ` +
    `goes to the first group you choose a paid plan for.`
}

/** The details as text, for a member who may not change them, with who may. */
function GroupDetailsText({ group }: { group: GroupRow }): JSX.Element {
  return (
    <Stack gap="sm">
      {group.description && (
        <p class="whitespace-pre-line break-words text-sm" data-e2e="group-general-description">
          {group.description}
        </p>
      )}
      <p class="text-sm text-muted" data-e2e="group-read-only">
        Only an admin or the owner can change this group's details.
      </p>
    </Stack>
  )
}

/** A menu item's label, with a short line under it that says why the item is disabled. */
function MenuText(
  { text, hint, hintDataE2E }: { text: string; hint: string | null; hintDataE2E: string },
): JSX.Element {
  return (
    <span class="flex flex-col items-start gap-1 text-left">
      <span>{text}</span>
      {hint && <span class="text-xs text-muted" data-e2e={hintDataE2E}>{hint}</span>}
    </span>
  )
}
