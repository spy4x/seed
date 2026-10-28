import type { ComponentChildren, JSX } from "preact"
import { useState } from "preact/hooks"
import { Avatar } from "@spy4x/preact-ui/avatar"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { DialogActions } from "@spy4x/preact-ui/dialog-actions"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { Card } from "@spy4x/preact-ui/card"
import { DropdownItem } from "@spy4x/preact-ui/dropdown"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
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
  ADMIN_PICTURE_PATH,
  adminGrantableRoles,
  type AdminUserDetail,
  AuthAuditEventType,
  canChangeRoles,
  pictureUrl,
  SIGN_IN_LINK_METHOD,
  TELEGRAM_METHOD,
  type UserRole,
} from "@domain/identity"
import { ADMIN_PATHS } from "./admin-frame.tsx"
import { groupRoleLabel } from "./admin-groups-list.tsx"
import { BILLING_AUDIT_LABELS } from "./admin-billing-list.tsx"
import { adminUserName, adminUserSubtitle, roleColor, roleLabel } from "./admin-users-screen.tsx"
import { type Navigate, ScreenForm } from "./progressive.tsx"
import { OnDay, When } from "@spy4x/preact-ui/format"
import { AdminPreferencesGroup } from "./preferences.tsx"
import { Rich } from "@spy4x/preact-ui/i18n"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { useAdminText } from "./i18n.ts"

/** What an operator can do to a person; each is confirmed in a dialog first. */
export type AdminAction =
  | "block"
  | "unblock"
  | "end-sessions"
  | "end-session"
  | "change-role"
  | "password-reset"
  | "delete-guest"
  | "unlink-telegram"
  | "remove-picture"

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
  [AuthAuditEventType.SIGN_IN_METHOD_RENAMED]: "neutral",
  [AuthAuditEventType.GUEST_STARTED]: "neutral",
  [AuthAuditEventType.GUEST_KEPT]: "success",
  [AuthAuditEventType.GUEST_DELETED_BY_OPERATOR]: "warning",
  [AuthAuditEventType.TELEGRAM_LINKED]: "neutral",
  [AuthAuditEventType.TELEGRAM_UNLINKED]: "warning",
  [AuthAuditEventType.PICTURE_REMOVED_BY_OPERATOR]: "warning",
}

/** An audit event's tone on the Activity timeline; an event this page does not know is neutral. */
export function auditTone(eventType: AuthAuditEventType): TimelineTone {
  return AUDIT_TONES[eventType] ?? "neutral"
}

/**
 * What each audit row says happened, as a catalog key per event code: the audit log (#429) uses the
 * same words. Each title is one whole message, never built from parts.
 */
export const AUDIT_EVENTS: Record<AuthAuditEventType, string> = {
  [AuthAuditEventType.SIGNED_UP]: `AdminAuditEvent.signedUp`,
  [AuthAuditEventType.SIGNED_IN]: `AdminAuditEvent.signedIn`,
  [AuthAuditEventType.SIGNED_OUT]: `AdminAuditEvent.signedOut`,
  [AuthAuditEventType.PROFILE_UPDATED]: `AdminAuditEvent.profileUpdated`,
  [AuthAuditEventType.ACCOUNT_DELETION_REQUESTED]: `AdminAuditEvent.deletionRequested`,
  [AuthAuditEventType.ACCOUNT_RESTORED]: `AdminAuditEvent.accountRestored`,
  [AuthAuditEventType.SESSIONS_ENDED]: `AdminAuditEvent.sessionsEnded`,
  [AuthAuditEventType.API_TOKEN_CREATED]: `AdminAuditEvent.apiTokenCreated`,
  [AuthAuditEventType.API_TOKEN_USED]: `AdminAuditEvent.apiTokenUsed`,
  [AuthAuditEventType.API_TOKEN_REVOKED]: `AdminAuditEvent.apiTokenRevoked`,
  [AuthAuditEventType.API_TOKENS_PURGED]: `AdminAuditEvent.apiTokensPurged`,
  [AuthAuditEventType.API_TOKEN_REFUSED]: `AdminAuditEvent.apiTokenRefused`,
  [AuthAuditEventType.SIGN_IN_METHOD_LINKED]: `AdminAuditEvent.methodLinked`,
  [AuthAuditEventType.SIGN_IN_METHOD_UNLINKED]: `AdminAuditEvent.methodUnlinked`,
  [AuthAuditEventType.UNCONFIRMED_ADDRESS_TAKEN]: `AdminAuditEvent.addressTaken`,
  [AuthAuditEventType.USER_BLOCKED]: `AdminAuditEvent.userBlocked`,
  [AuthAuditEventType.USER_UNBLOCKED]: `AdminAuditEvent.userUnblocked`,
  [AuthAuditEventType.PUSH_DEVICE_REMOVED]: `AdminAuditEvent.pushDeviceRemoved`,
  [AuthAuditEventType.NEWSLETTER_SUBSCRIBER_REMOVED]: `AdminAuditEvent.subscriberRemoved`,
  [AuthAuditEventType.NEWSLETTER_CONFIRMATION_RESENT]: `AdminAuditEvent.confirmationResent`,
  [AuthAuditEventType.NEWSLETTER_SUBSCRIBERS_EXPORTED]: `AdminAuditEvent.subscribersExported`,
  [AuthAuditEventType.USER_ROLE_CHANGED]: `AdminAuditEvent.roleChanged`,
  [AuthAuditEventType.PASSWORD_RESET_SENT]: `AdminAuditEvent.resetSent`,
  [AuthAuditEventType.USERS_EXPORTED]: `AdminAuditEvent.usersExported`,
  [AuthAuditEventType.SIGN_IN_METHOD_RENAMED]: `AdminAuditEvent.passkeyRenamed`,
  [AuthAuditEventType.GUEST_STARTED]: `AdminAuditEvent.guestStarted`,
  [AuthAuditEventType.GUEST_KEPT]: `AdminAuditEvent.guestKept`,
  [AuthAuditEventType.GUEST_DELETED_BY_OPERATOR]: `AdminAuditEvent.guestDeleted`,
  [AuthAuditEventType.TELEGRAM_LINKED]: `AdminAuditEvent.telegramLinked`,
  [AuthAuditEventType.TELEGRAM_UNLINKED]: `AdminAuditEvent.telegramUnlinked`,
  [AuthAuditEventType.PICTURE_REMOVED_BY_OPERATOR]: `AdminAuditEvent.pictureRemoved`,
}

/**
 * Each action's dialog, as catalog keys: its title, which names the person (`{name}`), what it
 * does, and its button. Every dialog but "change-role" only confirms, so it is a `ConfirmDialog`
 * (ui-layout rule 4).
 */
const ACTIONS: Record<AdminAction, { title: string; text: string; submit: string; busy: string }> =
  {
    block: {
      title: `AdminUser.blockTitle`,
      text: `AdminUser.blockText`,
      submit: `AdminUser.block`,
      busy: `AdminUser.blocking`,
    },
    unblock: {
      title: `AdminUser.unblockTitle`,
      text: `AdminUser.unblockText`,
      submit: `AdminUser.unblock`,
      busy: `AdminUser.unblocking`,
    },
    "end-sessions": {
      title: `AdminUser.endSessionsTitle`,
      text: `AdminUser.endSessionsText`,
      submit: `AdminUser.endAllSessions`,
      busy: `AdminUser.ending`,
    },
    "end-session": {
      title: `AdminUser.endSessionTitle`,
      text: `AdminUser.endSessionText`,
      submit: `AdminUser.endSession`,
      busy: `AdminUser.ending`,
    },
    "change-role": {
      title: `AdminUser.changeRoleTitle`,
      text: `AdminUser.changeRoleText`,
      submit: `AdminUser.changeRole`,
      busy: `AdminUser.changing`,
    },
    "password-reset": {
      title: `AdminUser.resetTitle`,
      text: `AdminUser.resetText`,
      submit: `AdminUser.sendLink`,
      busy: `AdminUser.sending`,
    },
    "delete-guest": {
      title: `AdminUser.deleteGuestTitle`,
      text: `AdminUser.deleteGuestText`,
      submit: `AdminUser.deleteGuest`,
      busy: `AdminUser.deleting`,
    },
    "unlink-telegram": {
      title: `AdminUser.unlinkTelegramTitle`,
      text: `AdminUser.unlinkTelegramText`,
      submit: `AdminUser.unlinkTelegram`,
      busy: `AdminUser.unlinking`,
    },
    "remove-picture": {
      title: `AdminUser.removePictureTitle`,
      text: `AdminUser.removePictureText`,
      submit: `AdminUser.removePictureSubmit`,
      busy: `AdminUser.removing`,
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
  const t = useAdminText()
  const back = { href: ADMIN_PATHS.users, label: t.t(`AdminUser.back`) }

  if (!detail) {
    return (
      <Stack>
        <PageHeader title={t.t(`AdminUser.title`)} back={back} navigate={navigate} />
        {error
          ? <ErrorState message={error} dataE2E="admin-user-error" />
          : (
            <div role="status" aria-label={t.t(`AdminUser.loading`)}>
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
            {t.t(`AdminUser.unblock`)}
          </DropdownItem>
        )
        : (
          <DropdownItem dataE2E="admin-block-open" onClick={() => props.onOpenDialog("block")}>
            {t.t(`AdminUser.block`)}
          </DropdownItem>
        )}
      <DropdownItem
        dataE2E="admin-end-sessions-open"
        onClick={() => props.onOpenDialog("end-sessions")}
      >
        {t.t(`AdminUser.endAllSessions`)}
      </DropdownItem>
      <DropdownItem
        dataE2E="admin-password-reset-open"
        disabled={address === null}
        onClick={() => props.onOpenDialog("password-reset")}
      >
        <span class="flex flex-col">
          {t.t(`AdminUser.sendReset`)}
          {address === null && (
            <span class="text-xs text-muted">{t.t(`AdminUser.noResetAddress`)}</span>
          )}
        </span>
      </DropdownItem>
      {telegramOf(detail) && (
        <DropdownItem
          dataE2E="admin-unlink-telegram-open"
          onClick={() => props.onOpenDialog("unlink-telegram")}
        >
          {t.t(`AdminUser.unlinkTelegram`)}
        </DropdownItem>
      )}
      {user.pictureId && (
        <DropdownItem
          dataE2E="admin-remove-picture-open"
          onClick={() => props.onOpenDialog("remove-picture")}
        >
          {t.t(`AdminUser.removePicture`)}
        </DropdownItem>
      )}
      {user.guestSince && (
        <DropdownItem
          dataE2E="admin-delete-guest-open"
          onClick={() => props.onOpenDialog("delete-guest")}
        >
          {t.t(`AdminUser.deleteGuest`)}
        </DropdownItem>
      )}
      {canChangeRoles(operator.role) && (
        <DropdownItem
          dataE2E="admin-change-role-open"
          onClick={() => props.onOpenDialog("change-role")}
        >
          {t.t(`AdminUser.changeRole`)}
        </DropdownItem>
      )}
    </>
  )

  const name = adminUserName(user, t)
  const tabs = [
    {
      id: "overview",
      label: t.t(`AdminUser.overview`),
      content: <Overview detail={detail} now={props.now ?? new Date()} />,
    },
    { id: "methods", label: t.t(`AdminUser.methods`), content: <Methods detail={detail} /> },
    {
      id: "sessions",
      label: <TabLabel text={t.t(`AdminUser.sessions`)} count={detail.sessions.length} />,
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
      label: <TabLabel text={t.t(`AdminUser.groups`)} count={detail.groups.length} />,
      content: <Groups detail={detail} navigate={navigate} />,
    },
    { id: "activity", label: t.t(`AdminUser.activity`), content: <Activity detail={detail} /> },
    ...(props.extraTabs ?? []),
  ]
  const active = tabs.some((tab) => tab.id === props.tab) ? props.tab : "overview"

  return (
    <Stack>
      <PageHeader
        title={name}
        subtitle={adminUserSubtitle(user) ?? undefined}
        mark={<Avatar name={name} src={pictureUrl(user.pictureId, ADMIN_PICTURE_PATH)} size="md" />}
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
          <Badge text={roleLabel(t, user.role)} color={roleColor(user.role)} />
          {user.blockedAt
            ? (
              <span data-e2e="admin-user-status">
                <Badge text={t.t(`AdminUser.blocked`)} color="red" />
              </span>
            )
            : (
              <span data-e2e="admin-user-status">
                <Badge text={t.t(`AdminUser.active`)} color="green" />
              </span>
            )}
          {user.guestSince && (
            <span data-e2e="admin-user-guest">
              <Badge text={t.t(`AdminUser.guest`)} color="gray" type="outline" />
            </span>
          )}
          {operator.id === user.id && (
            <Badge text={t.t(`AdminUser.you`)} color="gray" type="outline" />
          )}
        </div>
        {user.guestSince && (
          <p class="text-sm text-muted" data-e2e="admin-user-guest-note">
            {t.t(`AdminUser.guestNote`)}
          </p>
        )}
        <dl class="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Fact label={t.t(`AdminUser.created`)}>
            <When at={user.createdAt} />
          </Fact>
          <Fact label={t.t(`AdminUser.lastSeen`)}>
            {user.lastSeenAt ? <When at={user.lastSeenAt} /> : t.t(`AdminUser.never`)}
          </Fact>
          <Fact label={t.t(`AdminUser.sessions`)}>{detail.sessions.length}</Fact>
          <Fact label={t.t(`AdminUser.groups`)}>{detail.groups.length}</Fact>
        </dl>
        {user.blockedAt && (
          <Notice tone="danger" data-e2e="admin-user-blocked-notice">
            <Rich
              parts={t.parts(`AdminUser.blockedNotice`)}
              tags={{ when: () => <When at={user.blockedAt!} /> }}
            />
          </Notice>
        )}
        {/* The operator's own page says nothing about it: the "You" badge already does (rule 3). */}
        {!actOn && operator.id !== user.id && (
          <p class="text-sm text-muted" data-e2e="admin-user-no-actions">
            {t.t(`AdminUser.noActions`)}
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
        label={t.t(`AdminUser.tabs`)}
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
  const t = useAdminText()
  const telegram = telegramOf(detail)
  return (
    <Stack>
      <SettingGroup title={t.t(`AdminUser.account`)}>
        <SettingList>
          <SettingRow
            label={t.t(`AdminUser.picture`)}
            dataE2E="admin-user-picture"
            value={user.pictureId
              ? (
                <Avatar
                  name={adminUserName(user, t)}
                  src={pictureUrl(user.pictureId, ADMIN_PICTURE_PATH)}
                  size="lg"
                  alt=""
                />
              )
              : t.t(`AdminUser.none`)}
          />
          <SettingRow
            label={t.t(`AdminUser.address`)}
            value={user.email ? <span translate={false}>{user.email}</span> : t.t(`AdminUser.none`)}
          />
          <SettingRow label={t.t(`AdminUser.role`)} value={roleLabel(t, user.role)} />
          <SettingRow
            label={t.t(`AdminUser.status`)}
            value={t.t(user.blockedAt ? `AdminUser.blocked` : `AdminUser.active`)}
          />
          <SettingRow label={t.t(`AdminUser.created`)} value={<When at={user.createdAt} />} />
          <SettingRow
            label={t.t(`AdminUser.lastSeen`)}
            value={user.lastSeenAt ? <When at={user.lastSeenAt} /> : t.t(`AdminUser.never`)}
          />
          <SettingRow
            label={t.t(`AdminUser.telegram`)}
            dataE2E="admin-user-telegram"
            value={telegram
              ? (
                <Rich
                  parts={t.parts(`AdminUser.telegramLinked`)}
                  tags={{ when: () => <When at={telegram.createdAt} /> }}
                />
              )
              : t.t(`AdminUser.notLinked`)}
          />
          <SettingRow
            label={t.t(`AdminUser.trial`)}
            value={detail.trialUsedAt
              ? (
                <Rich
                  parts={t.parts(`AdminUser.trialUsed`)}
                  tags={{ when: () => <When at={detail.trialUsedAt!} /> }}
                />
              )
              : t.t(`AdminUser.trialNotUsed`)}
          />
        </SettingList>
      </SettingGroup>
      <AdminPreferencesGroup preferences={detail.preferences} now={now} />
    </Stack>
  )
}

/**
 * The person's linked Telegram account (#269), or `undefined`. It is no way in, so the Sign-in
 * methods tab leaves it out and the Overview shows it.
 */
export function telegramOf(
  detail: Pick<AdminUserDetail, "methods">,
): AdminUserDetail["methods"][number] | undefined {
  return detail.methods.find((method) => method.method === TELEGRAM_METHOD)
}

function Methods({ detail }: { detail: AdminUserDetail }): JSX.Element {
  const t = useAdminText()
  const lastUsed = (at: string | null | undefined) =>
    at
      ? <Rich parts={t.parts(`AdminUser.lastUsed`)} tags={{ when: () => <When at={at} /> }} />
      : t.t(`AdminUser.notUsedYet`)
  return (
    <Rows empty={t.t(`AdminUser.noMethods`)} dataE2E="admin-user-methods">
      {detail.methods.filter((method) => method.method !== TELEGRAM_METHOD).map((method) => (
        <li key={`${method.method}-${method.createdAt}`} class={ROW}>
          <span class="font-medium">{methodName(t, method.method)}</span>
          {method.email && (
            <span class="text-sm text-muted wrap-anywhere" translate={false}>{method.email}</span>
          )}
          {method.method === SIGN_IN_LINK_METHOD
            ? (
              // A sign-in link is no stored method: when one was last used, read-only (#391).
              <span class="text-sm text-muted" data-e2e="admin-user-email-link">
                {lastUsed(method.lastUsedAt)}
              </span>
            )
            : method.passkey
            ? (
              // A passkey proves no address: its name and dates, read-only (#222).
              <span class="text-sm text-muted wrap-anywhere" data-e2e="admin-user-passkey">
                <Rich
                  parts={t.parts(`AdminUser.passkeyAdded`, { name: method.passkey.name })}
                  tags={{
                    name: (text) => <bdi translate={false}>{text}</bdi>,
                    day: () => <OnDay at={method.createdAt} />,
                  }}
                />{" "}
                · {lastUsed(method.passkey.lastUsedAt)}
              </span>
            )
            : (
              <span class="ml-auto">
                {method.provenAt
                  ? <Badge text={t.t(`AdminUser.proven`)} color="green" type="outline" />
                  : <Badge text={t.t(`AdminUser.notProven`)} color="orange" type="outline" />}
              </span>
            )}
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
  const t = useAdminText()
  const list = (
    <Rows empty={t.t(`AdminUser.noSessions`)} dataE2E="admin-user-sessions">
      {detail.sessions.map((session) => (
        <li key={session.id} class={ROW} data-e2e={`admin-session-${session.id}`}>
          <span class="font-medium" translate={session.deviceName ? false : undefined}>
            {sessionName(t, session.deviceName)}
          </span>
          {session.ipHint && <span class="text-sm text-muted">{session.ipHint}</span>}
          <span class="ml-auto text-xs text-muted">
            <Rich
              parts={t.parts(`AdminUser.lastActive`)}
              tags={{ when: () => <When at={session.lastUsedAt} /> }}
            />
          </span>
          {onEnd && (
            <Button
              variant="ghost"
              size="sm"
              data-e2e="admin-session-end-open"
              aria-label={t.t(`AdminUser.endSessionLabel`, {
                device: sessionName(t, session.deviceName),
              })}
              onClick={() => onEnd(session.id)}
            >
              {t.t(`AdminUser.end`)}
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
          {t.t(`AdminUser.endAll`)}
        </Button>
      </Cluster>
      {list}
    </Stack>
  )
}

/** A session's device as a person reads it; a session that named none is "Unknown device". */
function sessionName(t: Translator<string>, deviceName: string): string {
  return deviceName || t.t(`AdminUser.unknownDevice`)
}

/** The person's groups; each name opens the group's page in the groups module (#426). */
function Groups(
  { detail, navigate }: { detail: AdminUserDetail; navigate?: Navigate },
): JSX.Element {
  const t = useAdminText()
  return (
    <Rows empty={t.t(`AdminUser.noGroups`)} dataE2E="admin-user-groups">
      {detail.groups.map((group) => (
        <li key={group.id} class={ROW}>
          <Link
            href={`/groups/${encodeURIComponent(group.id)}`}
            navigate={navigate}
            class="pc-link font-medium wrap-anywhere"
            translate={false}
            data-e2e={`admin-user-group-${group.id}`}
          >
            {group.name}
          </Link>
          <span class="ml-auto">
            <Badge text={groupRoleLabel(t, group.role)} color="gray" type="outline" />
          </span>
        </li>
      ))}
    </Rows>
  )
}

const PASSKEY_RENAMED = /^passkey name=(.*?) from=(.*)$/
const PASSKEY_NAMED = /^passkey name=(.*)$/

/**
 * An audit row's stored identifier as an operator reads it, in their language: a passkey rename as
 * `From "Old" to "New"`, any other passkey row as `Passkey "Name"`. Anything else stays as stored,
 * since the server's format is also what the audit search matches.
 */
export function auditDetail(
  t: Translator<string>,
  eventType: number | null,
  identifier: string,
): string {
  const renamed = eventType === AuthAuditEventType.SIGN_IN_METHOD_RENAMED &&
    PASSKEY_RENAMED.exec(identifier)
  if (renamed) return t.t(`AdminUser.passkeyRenamed`, { from: renamed[2], to: renamed[1] })
  const named = PASSKEY_NAMED.exec(identifier)
  return named ? t.t(`AdminUser.passkeyNamed`, { name: named[1] }) : identifier
}

/**
 * The title key of a sign-in or sign-up row that a sign-in link wrote (#391), which names the
 * method itself: "Signed in with an e-mail link". `null` for every other row.
 */
export function linkAuditTitle(eventType: number | null, identifier: string | null): string | null {
  if (identifier !== SIGN_IN_LINK_METHOD) return null
  if (eventType === AuthAuditEventType.SIGNED_IN) return `AdminAuditEvent.signedInWithLink`
  if (eventType === AuthAuditEventType.SIGNED_UP) return `AdminAuditEvent.signedUpWithLink`
  return null
}

/**
 * What an audit row says happened, in the operator's language: one whole message per event code
 * (an account event, a billing event, or a sign-in link's own title), or `null` for a code this
 * page does not know.
 */
export function auditEventTitle(
  t: Translator<string>,
  eventType: number | null,
  identifier: string | null,
): string | null {
  const key = linkAuditTitle(eventType, identifier) ??
    AUDIT_EVENTS[eventType as AuthAuditEventType] ??
    BILLING_AUDIT_LABELS[eventType as BillingAuditEvent]
  return key ? t.t(key) : null
}

/** The newest rows of the person's audit trail, newest first, on a timeline. */
function Activity({ detail }: { detail: AdminUserDetail }): JSX.Element {
  const t = useAdminText()
  return (
    <Timeline
      label={t.t(`AdminUser.activity`)}
      empty={t.t(`AdminUser.nothingRecorded`)}
      dataE2E="admin-user-audits"
      items={detail.audits.map((audit) => {
        const linkTitle = linkAuditTitle(audit.eventType, audit.identifier)
        const parts = [
          !linkTitle && audit.identifier && auditDetail(t, audit.eventType, audit.identifier),
          audit.ip && t.t(`AdminUser.fromIp`, { ip: audit.ip }),
        ].filter(Boolean)
        return {
          id: audit.id,
          title: auditEventTitle(t, audit.eventType, audit.identifier) ??
            t.t(`AdminUser.otherEvent`),
          at: audit.createdAt,
          when: <When at={audit.createdAt} />,
          description: parts.length > 0 ? parts.join(" · ") : undefined,
          tone: auditTone(audit.eventType),
          dataE2E: `admin-audit-${audit.eventType}`,
        }
      })}
    />
  )
}

const ROW = "flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"

/** A list in the page's bordered style, or a card with one quiet line when it is empty. */
function Rows(
  { empty, dataE2E, children }: { empty: string; dataE2E: string; children: JSX.Element[] },
): JSX.Element {
  if (children.length === 0) {
    return (
      // The list's card with one quiet line in its body's place: no dashed box inside the page.
      <Card data-e2e={dataE2E}>
        <EmptyState inset description={empty} />
      </Card>
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

/** A sign-in method's key name as a person reads it, in the operator's language. */
function methodName(t: Translator<string>, method: string): string {
  if (method === "password") return t.t(`AdminUser.methodPassword`)
  if (method === "oauth:google") return "Google"
  if (method === "oauth:github") return "GitHub"
  if (method === "email-code") return t.t(`AdminUser.methodEmailCode`)
  if (method === "passkey") return t.t(`AdminUser.methodPasskey`)
  if (method === SIGN_IN_LINK_METHOD) return t.t(`AdminUser.methodEmailLink`)
  return method
}

/**
 * The dialog of one action: what it does to whom, why the API refused it, and its button. A
 * confirm-only action is a `ConfirmDialog`; changing the role needs a choice, so it is a form.
 */
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
  const t = useAdminText()
  const copy = ACTIONS[action]
  const calm = CALM_ACTIONS.includes(action)
  const title = t.t(copy.title, { name: adminUserName(detail.user, t) })
  const roles = adminGrantableRoles(operator.role)
  // The person's own role is picked first, so the button changes nothing until another is picked.
  const [role, setRole] = useState<UserRole>(detail.user.role)
  const session = detail.sessions.find((one) => one.id === sessionId)

  if (action !== "change-role") {
    const input = action === "end-session" && sessionId !== null ? { sessionId } : undefined
    return (
      <ConfirmDialog
        title={title}
        tone={calm ? "default" : "danger"}
        confirmLabel={t.t(copy.submit)}
        busy={pending}
        busyLabel={t.t(copy.busy)}
        onConfirm={() => {
          onAction(action, input)
          // The app closes the dialog once the API answers; a refusal keeps it open with its error.
          return false
        }}
        onCancel={onCloseDialog}
        dataE2E="admin-action-dialog"
        confirmDataE2E="admin-action-submit"
      >
        <Stack>
          <p class="text-sm text-muted">{t.t(copy.text)}</p>
          {action === "end-session" && session && (
            <p class="text-sm font-medium" data-e2e="admin-action-session">
              <span translate={session.deviceName ? false : undefined}>
                {sessionName(t, session.deviceName)}
              </span>
              {session.ipHint && (
                <span class="font-normal text-muted">{` · ${session.ipHint}`}</span>
              )}
            </p>
          )}
          {action === "password-reset" && address && (
            <p class="text-sm">
              <Rich
                parts={t.parts(`AdminUser.sentTo`, { address })}
                tags={{
                  address: (text) => (
                    <bdi class="font-medium wrap-anywhere" translate={false}>{text}</bdi>
                  ),
                }}
              />
            </p>
          )}
          <ErrorState message={actionError} />
        </Stack>
      </ConfirmDialog>
    )
  }

  const unchanged = role === detail.user.role
  return (
    <Modal
      open
      onClose={onCloseDialog}
      title={title}
      cancelLabel={t.t(`AdminUser.close`)}
      dataE2E="admin-action-dialog"
    >
      <ScreenForm pending={pending} onSubmit={() => onAction(action, { role })}>
        <Stack>
          <p class="text-sm text-muted">{t.t(copy.text)}</p>
          <RadioGroup
            legend={t.t(`AdminUser.role`)}
            name="role"
            data-e2e="admin-role-picker"
            options={roles.map((one) => ({
              value: String(one),
              label: one === detail.user.role
                ? t.t(`AdminUser.roleNow`, { role: roleLabel(t, one) })
                : roleLabel(t, one),
            }))}
            value={String(role)}
            onChange={(value) => setRole(Number(value) as UserRole)}
          />
          <ErrorState message={actionError} />
          <DialogActions>
            <Button type="button" variant="ghost" onClick={onCloseDialog}>
              {t.t(`AdminUser.cancel`)}
            </Button>
            <Button
              type="submit"
              variant="primary"
              data-e2e="admin-action-submit"
              disabled={unchanged}
              busy={pending}
              busyLabel={t.t(copy.busy)}
            >
              {t.t(copy.submit)}
            </Button>
          </DialogActions>
        </Stack>
      </ScreenForm>
    </Modal>
  )
}
