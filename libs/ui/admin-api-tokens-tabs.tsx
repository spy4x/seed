import type { JSX } from "preact"
import { useRef } from "preact/hooks"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { DataTable } from "@spy4x/preact-ui/data-table"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Stack } from "@spy4x/preact-ui/layout"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import type { AdminApiToken } from "@domain/api-tokens"
import type { AdminPushDevice } from "@domain/identity"
import { type AdminNotificationsResponse, NotificationKind } from "@domain/notifications"
import {
  type AdminTokensConfirm,
  AdminTokensConfirmDialog,
  type AdminTokensConfirmState,
  Ago,
  PANEL_ROW,
  PanelRows,
  tokenColumns,
  tokenTableClass,
  useFocusAfterConfirm,
} from "./admin-api-tokens-screen.tsx"
import { Rich } from "@spy4x/preact-ui/i18n"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { useAdminText } from "./i18n.ts"

/**
 * A panel's count, as a heading that takes focus after a confirmed revoke or removal, so focus
 * does not fall to the page's body when the row's button is gone.
 */
function PanelCount(
  props: { count: string; headingRef: { current: HTMLHeadingElement | null }; dataE2E: string },
): JSX.Element {
  return (
    <h2 ref={props.headingRef} tabIndex={-1} class="text-sm text-muted" data-e2e={props.dataE2E}>
      {props.count}
    </h2>
  )
}

/** What each notification kind is called; a kind this page does not know shows as stored. */
const KIND_LABELS: Record<string, string> = {
  [NotificationKind.InvitationReceived]: `AdminPersonTabs.invitationReceived`,
  [NotificationKind.RoleChanged]: `AdminPersonTabs.roleChanged`,
  [NotificationKind.RemovedFromGroup]: `AdminPersonTabs.removedFromGroup`,
  [NotificationKind.OwnershipReceived]: `AdminPersonTabs.ownershipReceived`,
  [NotificationKind.DataExportReady]: `AdminPersonTabs.dataExportReady`,
}

/** What a notification kind is called on the person's tab, in the operator's language. */
export function notificationKindLabel(t: Translator<string>, kind: string): string {
  const key = Object.hasOwn(KIND_LABELS, kind) ? KIND_LABELS[kind] : undefined
  return key ? t.t(key) : kind
}

/** What every panel shows while it loads or after a failed read. */
interface PanelLoad<T> {
  /** What the API answered, or `null` while it loads or after it failed. */
  data: T | null
  error: string | null
}

/** Loading rows or the read's error; `null` once there is data to show. */
function loadingOrError<T>({ data, error }: PanelLoad<T>, label: string): JSX.Element | null {
  if (error) return <ErrorState message={error} />
  if (data === null) {
    return (
      <div role="status" aria-label={label}>
        <LoadingSkeleton rows={3} />
      </div>
    )
  }
  return null
}

/** What the person's actionable tabs need beyond their data. */
interface ActionPanelProps {
  /** The person's id and the signed-in operator's: an operator never acts on their own here. */
  userId: number
  operatorId: number
  confirm: AdminTokensConfirmState
  onAsk: (target: AdminTokensConfirm) => void
  onCloseConfirm: () => void
  onConfirm: () => void
}

/**
 * The person's "API tokens" tab (#427): their tokens, newest first, with the same columns as the
 * API tokens page but without the owner. A live one can be revoked after a confirm.
 */
export function AdminPersonTokensPanel(
  props: PanelLoad<AdminApiToken[]> & ActionPanelProps,
): JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null)
  const t = useAdminText()
  useFocusAfterConfirm(props.confirm, heading)
  const waiting = loadingOrError(props, t.t(`AdminPersonTabs.loadingTokens`))
  if (waiting) return waiting
  const tokens = props.data!
  return (
    <Stack>
      <PanelCount
        headingRef={heading}
        dataE2E="admin-person-api-tokens-count"
        count={t.t(`AdminApiTokens.count`, { count: tokens.length })}
      />
      {tokens.length === 0
        ? (
          <PanelRows empty={t.t(`AdminPersonTabs.noTokens`)} dataE2E="admin-person-api-tokens">
            {[]}
          </PanelRows>
        )
        : (
          <div data-e2e="admin-person-api-tokens">
            <DataTable
              class={tokenTableClass(false)}
              columns={tokenColumns({ ...props, withOwner: false, t })}
              rows={tokens}
              sort={[]}
              onSortChange={() => {}}
              caption={t.t(`AdminApiTokens.title`)}
              captionHidden
              rowKey={(token) => token.id}
            />
          </div>
        )}
      <AdminTokensConfirmDialog
        confirm={props.confirm}
        onClose={props.onCloseConfirm}
        onConfirm={props.onConfirm}
      />
    </Stack>
  )
}

/**
 * The person's "Devices" tab (#427): the browsers and phones that get their push notifications,
 * named as the person's own profile names them. One can be removed after a confirm.
 */
export function AdminPersonDevicesPanel(
  props: PanelLoad<AdminPushDevice[]> & ActionPanelProps,
): JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null)
  const t = useAdminText()
  useFocusAfterConfirm(props.confirm, heading)
  const waiting = loadingOrError(props, t.t(`AdminPersonTabs.loadingDevices`))
  if (waiting) return waiting
  const own = props.userId === props.operatorId
  const devices = props.data!
  return (
    <Stack>
      <PanelCount
        headingRef={heading}
        dataE2E="admin-person-devices-count"
        count={t.t(`AdminPersonTabs.deviceCount`, { count: devices.length })}
      />
      <PanelRows empty={t.t(`AdminPersonTabs.noDevices`)} dataE2E="admin-person-devices">
        {devices.map((device) => (
          <li key={device.id} class={PANEL_ROW} data-e2e={`admin-person-device-${device.id}`}>
            <span class="font-medium">
              <Rich
                parts={t.parts(`AdminPersonTabs.device`, { device: device.label })}
                tags={{ device: (text) => <bdi translate={false}>{text}</bdi> }}
              />
            </span>
            <span class="text-sm text-muted">
              <Rich
                parts={t.parts(`AdminPersonTabs.deviceDates`)}
                tags={{
                  added: () => <Ago at={device.createdAt} />,
                  renewed: () => <Ago at={device.updatedAt} />,
                }}
              />
            </span>
            {!own && (
              <span class="ml-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  data-e2e={`admin-person-device-remove-${device.id}`}
                  aria-label={t.t(`AdminPersonTabs.removeDevice`, { device: device.label })}
                  onClick={() =>
                    props.onAsk({
                      kind: "remove-device",
                      userId: props.userId,
                      deviceId: device.id,
                      label: device.label,
                    })}
                >
                  {t.t(`AdminApiTokens.remove`)}
                </Button>
              </span>
            )}
          </li>
        ))}
      </PanelRows>
      <AdminTokensConfirmDialog
        confirm={props.confirm}
        onClose={props.onCloseConfirm}
        onConfirm={props.onConfirm}
      />
    </Stack>
  )
}

/**
 * The person's "Notifications" tab (#427): what the product told them, newest first, by kind, and
 * whether they read it. Never what a notification said, which names their groups.
 */
export function AdminPersonNotificationsPanel(
  props: PanelLoad<AdminNotificationsResponse>,
): JSX.Element {
  const t = useAdminText()
  const waiting = loadingOrError(props, t.t(`AdminPersonTabs.loadingNotifications`))
  if (waiting) return waiting
  const { notifications, total, unread } = props.data!
  const more = total - notifications.length
  return (
    <Stack>
      <p class="text-sm text-muted" data-e2e="admin-person-notifications-count">
        {total === 0
          ? t.t(`AdminPersonTabs.noNotifications`)
          : t.t(`AdminPersonTabs.notificationCount`, { count: total, unread })}
        {more > 0 &&
          ` ${t.t(`AdminPersonTabs.newestShown`, { count: notifications.length })}`}
      </p>
      {notifications.length > 0 && (
        <PanelRows empty="" dataE2E="admin-person-notifications">
          {notifications.map((notification) => (
            <li
              key={notification.id}
              class={PANEL_ROW}
              data-e2e={`admin-person-notification-${notification.id}`}
            >
              <span class="font-medium">{notificationKindLabel(t, notification.kind)}</span>
              <span class="text-sm text-muted">
                <Ago at={notification.createdAt} />
              </span>
              <span class="ml-auto">
                {notification.readAt
                  ? <Badge text={t.t(`AdminPersonTabs.read`)} color="gray" type="outline" />
                  : <Badge text={t.t(`AdminPersonTabs.unread`)} color="blue" />}
              </span>
            </li>
          ))}
        </PanelRows>
      )}
    </Stack>
  )
}
