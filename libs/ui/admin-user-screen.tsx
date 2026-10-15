import type { JSX } from "preact"
import { timeAgo } from "@spy4x/platform/universal/time"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { DropdownItem } from "@spy4x/preact-ui/dropdown"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Cluster, Stack } from "@spy4x/preact-ui/layout"
import { Modal } from "@spy4x/preact-ui/modal"
import { Notice } from "@spy4x/preact-ui/notice"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import { SettingGroup, SettingList, SettingRow } from "@spy4x/preact-ui/setting-row"
import { type AdminUserDetail, AuthAuditEventType, type UserRole } from "@domain/identity"
import { ADMIN_PATHS } from "./admin-frame.tsx"
import { adminUserName, roleLabel } from "./admin-users-screen.tsx"
import { type Navigate, ScreenForm } from "./progressive.tsx"

/** What an operator can do to a person; each is confirmed in a dialog first. */
export type AdminAction = "block" | "unblock" | "end-sessions"

/** The signed-in operator, as far as the page needs them. */
export interface AdminOperator {
  id: number
  role: UserRole
}

/** What a group role is called in the person's group list. */
const GROUP_ROLES: Record<number, string> = { 1: "Viewer", 2: "Editor", 3: "Admin", 4: "Owner" }

/** What each audit row says happened. */
const AUDIT_EVENTS: Record<AuthAuditEventType, string> = {
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
}

/** Each action's dialog: its title, what it does, and its button. */
const ACTIONS: Record<AdminAction, { title: string; text: string; submit: string; busy: string }> =
  {
    block: {
      title: "Block this user",
      text:
        "Every session of theirs ends at once and every way in is refused: password, Google, GitHub and API tokens. Their data stays. You can unblock them later.",
      submit: "Block",
      busy: "Blocking...",
    },
    unblock: {
      title: "Unblock this user",
      text: "They can sign in again, and their API tokens work again.",
      submit: "Unblock",
      busy: "Unblocking...",
    },
    "end-sessions": {
      title: "End all sessions",
      text: "Every device of theirs is signed out at once. They can sign in again.",
      submit: "End all sessions",
      busy: "Ending...",
    },
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

export interface AdminUserScreenProps {
  /** The person, or `null` while it loads or when it could not be read. */
  detail: AdminUserDetail | null
  /** Why the person could not be read, or `null`. */
  error: string | null
  operator: AdminOperator
  /** The action whose dialog is open, or `null`. */
  dialog: AdminAction | null
  onOpenDialog: (action: AdminAction) => void
  /** The operator closed the dialog: the app drops its error. */
  onCloseDialog: () => void
  /** Why the API refused the open dialog's action, shown under its text, or `null`. */
  actionError: string | null
  pending: boolean
  /** The operator confirmed the open dialog's action. */
  onAction: (action: AdminAction) => void
  navigate?: Navigate
}

/**
 * One person in the admin app: their account, how they sign in, their sessions, their groups and
 * the newest rows of their audit trail. The "More actions" menu blocks, unblocks or ends every
 * session, each confirmed in a dialog. No password is asked: the audit trail records who acted.
 */
export function AdminUserScreen(props: AdminUserScreenProps): JSX.Element {
  const { detail, error, operator, dialog, navigate } = props
  const back = { href: ADMIN_PATHS.users, label: "Users" }

  if (!detail) {
    return (
      <Stack>
        <PageHeader title="User" back={back} navigate={navigate} />
        {error
          ? <ErrorState message={error} />
          : <p class="text-sm text-muted" role="status">Loading...</p>}
      </Stack>
    )
  }

  const { user } = detail
  const actOn = canActOn(operator, user)
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
    </>
  )

  return (
    <Stack>
      <PageHeader
        title={adminUserName(user)}
        subtitle={user.email ?? undefined}
        back={back}
        navigate={navigate}
        menu={menu || undefined}
        menuDataE2E="admin-user-menu"
        titleDataE2E="admin-user-title"
      />
      {!actOn && (
        <p class="text-sm text-muted" data-e2e="admin-user-no-actions">
          {operator.id === user.id
            ? "This is your own account. Operators cannot act on themselves here."
            : "Their role is yours or higher, so you cannot act on this account."}
        </p>
      )}
      {user.blockedAt && (
        <Notice tone="danger" data-e2e="admin-user-blocked-notice">
          Blocked{" "}
          <time dateTime={user.blockedAt}>{timeAgo(user.blockedAt)}</time>. They cannot sign in.
        </Notice>
      )}

      <SettingGroup title="Account">
        <SettingList>
          <SettingRow label="Address" value={user.email ?? "None"} />
          <SettingRow label="Role" value={roleLabel(user.role)} />
          <SettingRow
            label="Status"
            value={user.blockedAt
              ? <Badge text="Blocked" color="red" data-e2e="admin-user-status" />
              : <Badge text="Active" color="green" data-e2e="admin-user-status" />}
          />
          <SettingRow label="Created" value={<When at={user.createdAt} />} />
          <SettingRow
            label="Last seen"
            value={user.lastSeenAt ? <When at={user.lastSeenAt} /> : "Never"}
          />
        </SettingList>
      </SettingGroup>

      <SettingGroup title="Sign-in methods">
        <Rows empty="No way to sign in." dataE2E="admin-user-methods">
          {detail.methods.map((method) => (
            <li key={`${method.method}-${method.createdAt}`} class={ROW}>
              <span class="font-medium">{methodName(method.method)}</span>
              {method.email && <span class="text-sm text-muted wrap-anywhere">{method.email}</span>}
              <span class="text-xs text-muted">{method.provenAt ? "Proven" : "Not proven"}</span>
            </li>
          ))}
        </Rows>
      </SettingGroup>

      <SettingGroup title="Sessions">
        <Rows empty="Signed in nowhere." dataE2E="admin-user-sessions">
          {detail.sessions.map((session) => (
            <li key={session.id} class={ROW}>
              <span class="font-medium">{session.deviceName}</span>
              {session.ipHint && <span class="text-sm text-muted">{session.ipHint}</span>}
              <span class="text-xs text-muted">
                Last active <When at={session.lastUsedAt} />
              </span>
            </li>
          ))}
        </Rows>
      </SettingGroup>

      <SettingGroup title="Groups">
        <Rows empty="In no group." dataE2E="admin-user-groups">
          {detail.groups.map((group) => (
            <li key={group.id} class={ROW}>
              <span class="font-medium wrap-anywhere">{group.name}</span>
              <span class="text-xs text-muted">{GROUP_ROLES[group.role] ?? "Member"}</span>
            </li>
          ))}
        </Rows>
      </SettingGroup>

      <SettingGroup title="Audit trail" description="The newest events first.">
        <Rows empty="Nothing recorded." dataE2E="admin-user-audits">
          {detail.audits.map((audit) => (
            <li key={audit.id} class={ROW} data-e2e={`admin-audit-${audit.eventType}`}>
              <span class="font-medium">{AUDIT_EVENTS[audit.eventType] ?? "Other event"}</span>
              {audit.identifier && (
                <span class="text-sm text-muted wrap-anywhere">{audit.identifier}</span>
              )}
              <span class="text-xs text-muted">
                <When at={audit.createdAt} />
                {audit.ip && ` from ${audit.ip}`}
              </span>
            </li>
          ))}
        </Rows>
      </SettingGroup>

      {actOn && dialog && (
        <ActionDialog
          action={dialog}
          actionError={props.actionError}
          pending={props.pending}
          onAction={props.onAction}
          onCloseDialog={props.onCloseDialog}
        />
      )}
    </Stack>
  )
}

const ROW = "flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"

/** A list in the page's bordered style, or one quiet line when it is empty. */
function Rows(
  { empty, dataE2E, children }: { empty: string; dataE2E: string; children: JSX.Element[] },
): JSX.Element {
  if (children.length === 0) return <p class="text-sm text-muted" data-e2e={dataE2E}>{empty}</p>
  return (
    <ul
      class="divide-y divide-subtle overflow-hidden rounded-lg border border-subtle bg-surface"
      data-e2e={dataE2E}
    >
      {children}
    </ul>
  )
}

/** A moment as "3 days ago", with the exact time for a machine and on hover. */
function When({ at }: { at: string }): JSX.Element {
  return <time dateTime={at} title={new Date(at).toLocaleString()}>{timeAgo(at)}</time>
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
  { action, actionError, pending, onAction, onCloseDialog }: {
    action: AdminAction
    actionError: string | null
    pending: boolean
    onAction: (action: AdminAction) => void
    onCloseDialog: () => void
  },
): JSX.Element {
  const copy = ACTIONS[action]
  return (
    <Modal
      open
      onClose={onCloseDialog}
      title={copy.title}
      cancelLabel="Close"
      tone={action === "unblock" ? undefined : "danger"}
      dataE2E="admin-action-dialog"
    >
      <ScreenForm pending={pending} onSubmit={() => onAction(action)}>
        <Stack>
          <p class="text-sm text-muted">{copy.text}</p>
          <ErrorState message={actionError} />
          <Cluster justify="end">
            <Button type="button" variant="ghost" onClick={onCloseDialog}>Cancel</Button>
            <Button
              type="submit"
              variant={action === "unblock" ? "primary" : "danger"}
              data-e2e="admin-action-submit"
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
