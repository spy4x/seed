import type { ComponentChildren, JSX } from "preact"
import { useState } from "preact/hooks"
import { timeAgo } from "@spy4x/platform/universal/time"
import { Avatar } from "@spy4x/preact-ui/avatar"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { DropdownItem } from "@spy4x/preact-ui/dropdown"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Cluster, Stack } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { Modal } from "@spy4x/preact-ui/modal"
import { Notice } from "@spy4x/preact-ui/notice"
import { RadioGroup } from "@spy4x/preact-ui/radio"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import { SettingGroup, SettingList, SettingRow } from "@spy4x/preact-ui/setting-row"
import { Tabs } from "@spy4x/preact-ui/tabs"
import { Timeline, type TimelineTone } from "@spy4x/preact-ui/timeline"
import type { BillingAuditEvent } from "@domain/billing"
import {
  adminGrantableRoles,
  type AdminUserDetail,
  AuthAuditEventType,
  canChangeRoles,
  type UserRole,
} from "@domain/identity"
import { ADMIN_PATHS } from "./admin-frame.tsx"
import { BILLING_AUDIT_LABELS } from "./admin-billing-list.tsx"
import { adminUserName, adminUserSubtitle, roleColor, roleLabel } from "./admin-users-screen.tsx"
import { type Navigate, ScreenForm } from "./progressive.tsx"
import { When } from "@spy4x/preact-ui/format"
import { AdminPreferencesGroup } from "./preferences.tsx"

/** What an operator can do to a person; each is confirmed in a dialog first. */
export type AdminAction =
  | "block"
  | "unblock"
  | "end-sessions"
  | "end-session"
  | "change-role"
  | "password-reset"

/** What an action needs besides its name: the session to end, or the role to give. */
export interface AdminActionInput {
  sessionId?: number
  role?: UserRole
}

/** The signed-in operator, as far as the page needs them. */
export interface AdminOperator {
  id: number
  role: UserRole
}

/** What a group role is called in the person's group list. */
const GROUP_ROLES: Record<number, string> = { 1: "Viewer", 2: "Editor", 3: "Admin", 4: "Owner" }

/**
 * Each audit event's dot on the Activity timeline. Routine events stay neutral; a new or restored
 * account is good news; anything that takes access away or may be an attack is a warning; a block
 * is the one danger. The title still says what happened, so the colour is never the only sign.
 */
const AUDIT_TONES: Record<AuthAuditEventType, TimelineTone> = {
  [AuthAuditEventType.SIGNED_UP]: "success",
  [AuthAuditEventType.SIGNED_IN]: "neutral",
  [AuthAuditEventType.SIGNED_OUT]: "neutral",
  [AuthAuditEventType.PROFILE_UPDATED]: "neutral",
  [AuthAuditEventType.ACCOUNT_DELETION_REQUESTED]: "warning",
  [AuthAuditEventType.ACCOUNT_RESTORED]: "success",
  [AuthAuditEventType.SESSIONS_ENDED]: "warning",
  [AuthAuditEventType.API_TOKEN_CREATED]: "neutral",
  [AuthAuditEventType.API_TOKEN_USED]: "neutral",
  [AuthAuditEventType.API_TOKEN_REVOKED]: "warning",
  [AuthAuditEventType.API_TOKENS_PURGED]: "neutral",
  [AuthAuditEventType.API_TOKEN_REFUSED]: "warning",
  [AuthAuditEventType.SIGN_IN_METHOD_LINKED]: "neutral",
  [AuthAuditEventType.SIGN_IN_METHOD_UNLINKED]: "warning",
  [AuthAuditEventType.UNCONFIRMED_ADDRESS_TAKEN]: "warning",
  [AuthAuditEventType.USER_BLOCKED]: "danger",
  [AuthAuditEventType.USER_UNBLOCKED]: "success",
  [AuthAuditEventType.PUSH_DEVICE_REMOVED]: "warning",
  [AuthAuditEventType.NEWSLETTER_SUBSCRIBER_REMOVED]: "warning",
  [AuthAuditEventType.NEWSLETTER_CONFIRMATION_RESENT]: "neutral",
  [AuthAuditEventType.NEWSLETTER_SUBSCRIBERS_EXPORTED]: "neutral",
  [AuthAuditEventType.USER_ROLE_CHANGED]: "warning",
  [AuthAuditEventType.PASSWORD_RESET_SENT]: "neutral",
  [AuthAuditEventType.USERS_EXPORTED]: "neutral",
}

/** An audit event's tone on the Activity timeline; an event this page does not know is neutral. */
export function auditTone(eventType: AuthAuditEventType): TimelineTone {
  return AUDIT_TONES[eventType] ?? "neutral"
}

/** What each audit row says happened; the audit log (#429) uses the same words. */
export const AUDIT_EVENTS: Record<AuthAuditEventType, string> = {
  [AuthAuditEventType.SIGNED_UP]: "Signed up",
  [AuthAuditEventType.SIGNED_IN]: "Signed in",
  [AuthAuditEventType.SIGNED_OUT]: "Signed out",
  [AuthAuditEventType.PROFILE_UPDATED]: "Changed the profile",
  [AuthAuditEventType.ACCOUNT_DELETION_REQUESTED]: "Asked to delete the account",
  [AuthAuditEventType.ACCOUNT_RESTORED]: "Restored the account",
  [AuthAuditEventType.SESSIONS_ENDED]: "Sessions ended",
  [AuthAuditEventType.API_TOKEN_CREATED]: "Created an API token",
  [AuthAuditEventType.API_TOKEN_USED]: "Used an API token",
  [AuthAuditEventType.API_TOKEN_REVOKED]: "API token revoked",
  [AuthAuditEventType.API_TOKENS_PURGED]: "Expired API token removed",
  [AuthAuditEventType.API_TOKEN_REFUSED]: "API token refused",
  [AuthAuditEventType.SIGN_IN_METHOD_LINKED]: "Sign-in method added",
  [AuthAuditEventType.SIGN_IN_METHOD_UNLINKED]: "Sign-in method removed",
  [AuthAuditEventType.UNCONFIRMED_ADDRESS_TAKEN]: "Unconfirmed address taken over",
  [AuthAuditEventType.USER_BLOCKED]: "Blocked by an operator",
  [AuthAuditEventType.USER_UNBLOCKED]: "Unblocked by an operator",
  [AuthAuditEventType.PUSH_DEVICE_REMOVED]: "Push device removed by an operator",
  [AuthAuditEventType.NEWSLETTER_SUBSCRIBER_REMOVED]: "Removed a newsletter subscriber",
  [AuthAuditEventType.NEWSLETTER_CONFIRMATION_RESENT]: "Resent a newsletter confirm mail",
  [AuthAuditEventType.NEWSLETTER_SUBSCRIBERS_EXPORTED]: "Exported the newsletter's subscribers",
  [AuthAuditEventType.USER_ROLE_CHANGED]: "Role changed",
  [AuthAuditEventType.PASSWORD_RESET_SENT]: "Password-reset link sent by an operator",
  [AuthAuditEventType.USERS_EXPORTED]: "Exported the user list",
}

/** Each action's dialog: its title, what it does, and its button. */
const ACTIONS: Record<AdminAction, { title: string; text: string; submit: string; busy: string }> =
  {
    block: {
      title: "Block this user",
      text:
        "Every session of theirs ends at once and every way in is refused: password, Google, GitHub and API tokens. Their data stays. You can unblock them later.",
      submit: "Block",
      busy: "Blocking…",
    },
    unblock: {
      title: "Unblock this user",
      text: "They can sign in again, and their API tokens work again.",
      submit: "Unblock",
      busy: "Unblocking…",
    },
    "end-sessions": {
      title: "End all sessions",
      text: "Every device of theirs is signed out at once. They can sign in again.",
      submit: "End all sessions",
      busy: "Ending…",
    },
    "end-session": {
      title: "End this session",
      text: "This one device is signed out at once. Their other devices stay signed in.",
      submit: "End session",
      busy: "Ending…",
    },
    "change-role": {
      title: "Change role",
      text:
        "The new role applies to their next request. You can give a role below your own; an administrator is made with the user:role script.",
      submit: "Change role",
      busy: "Changing…",
    },
    "password-reset": {
      title: "Send a password-reset link",
      text:
        'They get the same mail as from "Forgot password": a link to choose a new password. Their current password keeps working until they do.',
      submit: "Send link",
      busy: "Sending…",
    },
  }

/** The actions that change nothing the person could lose: their dialog is not red. */
const CALM_ACTIONS: readonly AdminAction[] = ["unblock", "change-role", "password-reset"]

/**
 * The address a password-reset link would go to, or `null` when the person has no password with
 * an address. The API answers the same on its own; this only says so before the operator asks.
 */
export function resetAddress(detail: Pick<AdminUserDetail, "methods">): string | null {
  return detail.methods.find((method) => method.method === "password" && method.email)?.email ??
    null
}

/**
 * Whether `operator` may act on the person: never on themselves, and never on a role at or above
 * their own. The API decides the same on its own; this only hides what it would refuse.
 */
export function canActOn(operator: Pick<AdminOperator, "id" | "role">, user: {
  id: number
  role: UserRole
}): boolean {
  return operator.id !== user.id && user.role < operator.role
}

/** The person page's own tabs, in order. A module may add more after them. */
export const ADMIN_USER_TABS = ["overview", "methods", "sessions", "groups", "activity"] as const

/** One of {@link ADMIN_USER_TABS}. */
export type AdminUserTab = typeof ADMIN_USER_TABS[number]

/** A tab a module adds to the person page (`apps/admin/src/modules/`): its id, name and content. */
export interface AdminExtraTab {
  id: string
  label: string
  content: ComponentChildren
}

export interface AdminUserScreenProps {
  /** The person, or `null` while it loads or when it could not be read. */
  detail: AdminUserDetail | null
  /** Why the person could not be read, or `null`. */
  error: string | null
  operator: AdminOperator
  /** The tab shown: one of {@link ADMIN_USER_TABS} or an extra tab's id. */
  tab: string
  onTab: (tab: string) => void
  /** The modules' tabs, after the page's own. */
  extraTabs?: readonly AdminExtraTab[]
  /** The action whose dialog is open, or `null`. */
  dialog: AdminAction | null
  /** The session the open "end-session" dialog ends. */
  dialogSessionId?: number | null
  /** The operator opened an action's dialog; "end-session" names its session. */
  onOpenDialog: (action: AdminAction, sessionId?: number) => void
  /** The operator closed the dialog: the app drops its error. */
  onCloseDialog: () => void
  /** Why the API refused the open dialog's action, shown under its text, or `null`. */
  actionError: string | null
  pending: boolean
  /** The operator confirmed the open dialog's action, with the session or the role it needs. */
  onAction: (action: AdminAction, input?: AdminActionInput) => void
  navigate?: Navigate
  /** The moment the person's local time is shown for; the page's render time by default. */
  now?: Date
}

/**
 * One person in the admin app (#424): a header card with their avatar, name, badges and the one
 * "More actions" menu, then tabs for their account, how they sign in, their sessions, their groups
 * and their activity, plus any tab a module adds. The menu blocks, unblocks, ends every session,
 * sends a password-reset link and, for an administrator, changes the role (#425); the Sessions tab
 * ends one session or all. Each is confirmed in a dialog. No password is asked: the audit trail
 * records who acted.
 */
export function AdminUserScreen(props: AdminUserScreenProps): JSX.Element {
  const { detail, error, operator, dialog, navigate } = props
  const back = { href: ADMIN_PATHS.users, label: "Users" }

  if (!detail) {
    return (
      <Stack>
        <PageHeader title="User" back={back} navigate={navigate} />
        {error
          ? <ErrorState message={error} dataE2E="admin-user-error" />
          : (
            <div role="status" aria-label="Loading the person">
              <LoadingSkeleton rows={4} />
            </div>
          )}
      </Stack>
    )
  }

  const { user } = detail
  const actOn = canActOn(operator, user)
  const address = resetAddress(detail)
  const menu = actOn && (
    <>
      {user.blockedAt
        ? (
          <DropdownItem dataE2E="admin-unblock-open" onClick={() => props.onOpenDialog("unblock")}>
            Unblock
          </DropdownItem>
        )
        : (
          <DropdownItem dataE2E="admin-block-open" onClick={() => props.onOpenDialog("block")}>
            Block
          </DropdownItem>
        )}
      <DropdownItem
        dataE2E="admin-end-sessions-open"
        onClick={() => props.onOpenDialog("end-sessions")}
      >
        End all sessions
      </DropdownItem>
      <DropdownItem
        dataE2E="admin-password-reset-open"
        disabled={address === null}
        onClick={() => props.onOpenDialog("password-reset")}
      >
        <span class="flex flex-col">
          Send password-reset link
          {address === null && <span class="text-xs text-muted">No password with an address</span>}
        </span>
      </DropdownItem>
      {canChangeRoles(operator.role) && (
        <DropdownItem
          dataE2E="admin-change-role-open"
          onClick={() => props.onOpenDialog("change-role")}
        >
          Change role
        </DropdownItem>
      )}
    </>
  )

  const name = adminUserName(user)
  const tabs = [
    {
      id: "overview",
      label: "Overview",
      content: <Overview detail={detail} now={props.now ?? new Date()} />,
    },
    { id: "methods", label: `Sign-in methods`, content: <Methods detail={detail} /> },
    {
      id: "sessions",
      label: <TabLabel text="Sessions" count={detail.sessions.length} />,
      content: (
        <Sessions
          detail={detail}
          onEnd={actOn ? (sessionId) => props.onOpenDialog("end-session", sessionId) : undefined}
          onEndAll={actOn ? () => props.onOpenDialog("end-sessions") : undefined}
        />
      ),
    },
    {
      id: "groups",
      label: <TabLabel text="Groups" count={detail.groups.length} />,
      content: <Groups detail={detail} navigate={navigate} />,
    },
    { id: "activity", label: "Activity", content: <Activity detail={detail} /> },
    ...(props.extraTabs ?? []),
  ]
  const active = tabs.some((tab) => tab.id === props.tab) ? props.tab : "overview"

  return (
    <Stack>
      <PageHeader
        title={name}
        subtitle={adminUserSubtitle(user) ?? undefined}
        mark={<Avatar name={name} size="md" />}
        back={back}
        navigate={navigate}
        menu={menu || undefined}
        menuDataE2E="admin-user-menu"
        titleDataE2E="admin-user-title"
      />
      <div
        class="flex flex-col gap-4 rounded-xl border border-subtle bg-surface p-4"
        data-e2e="admin-user-card"
      >
        <div class="flex flex-wrap items-center gap-2">
          <Badge text={roleLabel(user.role)} color={roleColor(user.role)} />
          {user.blockedAt
            ? (
              <span data-e2e="admin-user-status">
                <Badge text="Blocked" color="red" />
              </span>
            )
            : (
              <span data-e2e="admin-user-status">
                <Badge text="Active" color="green" />
              </span>
            )}
          {operator.id === user.id && <Badge text="You" color="gray" type="outline" />}
        </div>
        <dl class="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Fact label="Created">
            <When at={user.createdAt} />
          </Fact>
          <Fact label="Last seen">{user.lastSeenAt ? <When at={user.lastSeenAt} /> : "Never"}</Fact>
          <Fact label="Sessions">{detail.sessions.length}</Fact>
          <Fact label="Groups">{detail.groups.length}</Fact>
        </dl>
        {user.blockedAt && (
          <Notice tone="danger" data-e2e="admin-user-blocked-notice">
            Blocked{" "}
            <time dateTime={user.blockedAt}>{timeAgo(user.blockedAt)}</time>. They cannot sign in.
          </Notice>
        )}
        {!actOn && (
          <p class="text-sm text-muted" data-e2e="admin-user-no-actions">
            {operator.id === user.id
              ? "This is your own account. Operators cannot act on themselves here."
              : "Their role is yours or higher, so you cannot act on this account."}
          </p>
        )}
      </div>

      {
        /*
        One row that scrolls sideways: eight tabs wrapped onto three rows on a phone. The arrow keys
        still move between them, and focus scrolls the chosen tab into view. The bottom padding keeps
        the active tab's underline inside the scroll box.
      */
      }
      <Tabs
        tabs={tabs}
        active={active}
        onChange={props.onTab}
        lazy
        label="About this person"
        listClass="flex-nowrap overflow-x-auto pb-px"
        panelClass="pt-4"
        tabDataE2E="admin-user-tab"
      />

      {actOn && dialog && (
        <ActionDialog
          action={dialog}
          detail={detail}
          address={address}
          operator={operator}
          sessionId={props.dialogSessionId ?? null}
          actionError={props.actionError}
          pending={props.pending}
          onAction={props.onAction}
          onCloseDialog={props.onCloseDialog}
        />
      )}
    </Stack>
  )
}

/** A tab's name with how many rows it holds. */
function TabLabel({ text, count }: { text: string; count: number }): JSX.Element {
  return (
    <span class="inline-flex items-center gap-2">
      {text}
      <span class="rounded-full bg-canvas px-2 text-xs text-muted">{count}</span>
    </span>
  )
}

/** One fact of the header card. */
function Fact({ label, children }: { label: string; children: ComponentChildren }): JSX.Element {
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <dt class="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd class="truncate text-sm font-medium">{children}</dd>
    </div>
  )
}

function Overview({ detail, now }: { detail: AdminUserDetail; now: Date }): JSX.Element {
  const { user } = detail
  return (
    <Stack>
      <SettingGroup title="Account">
        <SettingList>
          <SettingRow label="Address" value={user.email ?? "None"} />
          <SettingRow label="Role" value={roleLabel(user.role)} />
          <SettingRow label="Status" value={user.blockedAt ? "Blocked" : "Active"} />
          <SettingRow label="Created" value={<When at={user.createdAt} />} />
          <SettingRow
            label="Last seen"
            value={user.lastSeenAt ? <When at={user.lastSeenAt} /> : "Never"}
          />
        </SettingList>
      </SettingGroup>
      <AdminPreferencesGroup preferences={detail.preferences} now={now} />
    </Stack>
  )
}

function Methods({ detail }: { detail: AdminUserDetail }): JSX.Element {
  return (
    <Rows empty="No way to sign in." dataE2E="admin-user-methods">
      {detail.methods.map((method) => (
        <li key={`${method.method}-${method.createdAt}`} class={ROW}>
          <span class="font-medium">{methodName(method.method)}</span>
          {method.email && <span class="text-sm text-muted wrap-anywhere">{method.email}</span>}
          <span class="ml-auto">
            {method.provenAt
              ? <Badge text="Proven" color="green" type="outline" />
              : <Badge text="Not proven" color="orange" type="outline" />}
          </span>
        </li>
      ))}
    </Rows>
  )
}

/**
 * The person's open sessions. With `onEnd` and `onEndAll` (an operator who may act on them), each
 * row has its own "End" button and "End all" sits above the list.
 */
function Sessions(
  { detail, onEnd, onEndAll }: {
    detail: AdminUserDetail
    onEnd?: (sessionId: number) => void
    onEndAll?: () => void
  },
): JSX.Element {
  const list = (
    <Rows empty="Signed in nowhere." dataE2E="admin-user-sessions">
      {detail.sessions.map((session) => (
        <li key={session.id} class={ROW} data-e2e={`admin-session-${session.id}`}>
          <span class="font-medium">{sessionName(session.deviceName)}</span>
          {session.ipHint && <span class="text-sm text-muted">{session.ipHint}</span>}
          <span class="ml-auto text-xs text-muted">
            Last active <When at={session.lastUsedAt} />
          </span>
          {onEnd && (
            <Button
              variant="ghost"
              size="sm"
              data-e2e="admin-session-end-open"
              aria-label={`End the session on ${sessionName(session.deviceName)}`}
              onClick={() => onEnd(session.id)}
            >
              End
            </Button>
          )}
        </li>
      ))}
    </Rows>
  )
  if (!onEndAll || detail.sessions.length === 0) return list
  return (
    <Stack>
      <Cluster justify="end">
        <Button
          variant="secondary"
          size="sm"
          data-e2e="admin-sessions-end-all-open"
          onClick={onEndAll}
        >
          End all
        </Button>
      </Cluster>
      {list}
    </Stack>
  )
}

/** A session's device as a person reads it; a session that named none is "Unknown device". */
function sessionName(deviceName: string): string {
  return deviceName || "Unknown device"
}

/** The person's groups; each name opens the group's page in the groups module (#426). */
function Groups(
  { detail, navigate }: { detail: AdminUserDetail; navigate?: Navigate },
): JSX.Element {
  return (
    <Rows empty="In no group." dataE2E="admin-user-groups">
      {detail.groups.map((group) => (
        <li key={group.id} class={ROW}>
          <Link
            href={`/groups/${encodeURIComponent(group.id)}`}
            navigate={navigate}
            class="pc-link font-medium wrap-anywhere"
            data-e2e={`admin-user-group-${group.id}`}
          >
            {group.name}
          </Link>
          <span class="ml-auto">
            <Badge text={GROUP_ROLES[group.role] ?? "Member"} color="gray" type="outline" />
          </span>
        </li>
      ))}
    </Rows>
  )
}

/** The newest rows of the person's audit trail, newest first, on a timeline. */
function Activity({ detail }: { detail: AdminUserDetail }): JSX.Element {
  return (
    <Timeline
      label="Activity"
      empty="Nothing recorded."
      dataE2E="admin-user-audits"
      items={detail.audits.map((audit) => {
        const parts = [audit.identifier, audit.ip && `from ${audit.ip}`].filter(Boolean)
        return {
          id: audit.id,
          title: AUDIT_EVENTS[audit.eventType] ??
            BILLING_AUDIT_LABELS[audit.eventType as number as BillingAuditEvent] ?? "Other event",
          at: audit.createdAt,
          when: timeAgo(audit.createdAt),
          description: parts.length > 0 ? parts.join(" · ") : undefined,
          tone: auditTone(audit.eventType),
          dataE2E: `admin-audit-${audit.eventType}`,
        }
      })}
    />
  )
}

const ROW = "flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"

/** A list in the page's bordered style, or one quiet line when it is empty. */
function Rows(
  { empty, dataE2E, children }: { empty: string; dataE2E: string; children: JSX.Element[] },
): JSX.Element {
  if (children.length === 0) {
    return (
      <p
        class="rounded-lg border border-dashed border-subtle px-4 py-6 text-center text-sm text-muted"
        data-e2e={dataE2E}
      >
        {empty}
      </p>
    )
  }
  return (
    <ul
      class="divide-y divide-subtle overflow-hidden rounded-lg border border-subtle bg-surface"
      data-e2e={dataE2E}
    >
      {children}
    </ul>
  )
}

/** A sign-in method's key name as a person reads it. */
function methodName(method: string): string {
  if (method === "password") return "Password"
  if (method === "oauth:google") return "Google"
  if (method === "oauth:github") return "GitHub"
  if (method === "email-code") return "E-mail code"
  return method
}

/** The dialog of one action: what it does, why the API refused it, and its button. */
function ActionDialog(
  { action, detail, address, operator, sessionId, actionError, pending, onAction, onCloseDialog }: {
    action: AdminAction
    detail: AdminUserDetail
    /** Where a password-reset link goes, or `null` when it cannot. */
    address: string | null
    operator: AdminOperator
    /** The session an "end-session" dialog ends. */
    sessionId: number | null
    actionError: string | null
    pending: boolean
    onAction: (action: AdminAction, input?: AdminActionInput) => void
    onCloseDialog: () => void
  },
): JSX.Element {
  const copy = ACTIONS[action]
  const calm = CALM_ACTIONS.includes(action)
  const roles = adminGrantableRoles(operator.role)
  // The person's own role is picked first, so the button changes nothing until another is picked.
  const [role, setRole] = useState<UserRole>(detail.user.role)
  const session = detail.sessions.find((one) => one.id === sessionId)
  const input: AdminActionInput | undefined = action === "change-role"
    ? { role }
    : action === "end-session" && sessionId !== null
    ? { sessionId }
    : undefined
  const unchanged = action === "change-role" && role === detail.user.role
  return (
    <Modal
      open
      onClose={onCloseDialog}
      title={copy.title}
      cancelLabel="Close"
      tone={calm ? undefined : "danger"}
      dataE2E="admin-action-dialog"
    >
      <ScreenForm pending={pending} onSubmit={() => onAction(action, input)}>
        <Stack>
          <p class="text-sm text-muted">{copy.text}</p>
          {action === "end-session" && session && (
            <p class="text-sm font-medium" data-e2e="admin-action-session">
              {sessionName(session.deviceName)}
              {session.ipHint && (
                <span class="font-normal text-muted">{` · ${session.ipHint}`}</span>
              )}
            </p>
          )}
          {action === "password-reset" && address && (
            <p class="text-sm">
              Sent to <span class="font-medium wrap-anywhere">{address}</span>
            </p>
          )}
          {action === "change-role" && (
            <RadioGroup
              legend="Role"
              name="role"
              data-e2e="admin-role-picker"
              options={roles.map((one) => ({
                value: String(one),
                label: one === detail.user.role ? `${roleLabel(one)} (now)` : roleLabel(one),
              }))}
              value={String(role)}
              onChange={(value) => setRole(Number(value) as UserRole)}
            />
          )}
          <ErrorState message={actionError} />
          <Cluster justify="end">
            <Button type="button" variant="ghost" onClick={onCloseDialog}>Cancel</Button>
            <Button
              type="submit"
              variant={calm ? "primary" : "danger"}
              data-e2e="admin-action-submit"
              disabled={unchanged}
              busy={pending}
              busyLabel={copy.busy}
            >
              {copy.submit}
            </Button>
          </Cluster>
        </Stack>
      </ScreenForm>
    </Modal>
  )
}
