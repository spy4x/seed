import type { JSX } from "preact"
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
} from "./admin-api-tokens-screen.tsx"

/** What each notification kind is called; a kind this page does not know shows as stored. */
const KIND_LABELS: Record<string, string> = {
  [NotificationKind.InvitationReceived]: "Invitation received",
  [NotificationKind.RoleChanged]: "Group role changed",
  [NotificationKind.RemovedFromGroup]: "Removed from a group",
  [NotificationKind.OwnershipReceived]: "Group handed over",
}

/** What a notification kind is called on the person's tab. */
export function notificationKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind
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
  const waiting = loadingOrError(props, "Loading API tokens")
  if (waiting) return waiting
  const tokens = props.data!
  return (
    <Stack>
      {tokens.length === 0
        ? <PanelRows empty="No API tokens." dataE2E="admin-person-api-tokens">{[]}</PanelRows>
        : (
          <div data-e2e="admin-person-api-tokens">
            <DataTable
              columns={tokenColumns({ ...props, withOwner: false })}
              rows={tokens}
              sort={[]}
              onSortChange={() => {}}
              caption="API tokens"
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
  const waiting = loadingOrError(props, "Loading devices")
  if (waiting) return waiting
  const own = props.userId === props.operatorId
  return (
    <Stack>
      <PanelRows empty="No device gets push notifications." dataE2E="admin-person-devices">
        {props.data!.map((device) => (
          <li key={device.id} class={PANEL_ROW} data-e2e={`admin-person-device-${device.id}`}>
            <span class="font-medium">Device {device.label}</span>
            <span class="text-sm text-muted">
              Added <Ago at={device.createdAt} />, renewed <Ago at={device.updatedAt} />
            </span>
            {!own && (
              <span class="ml-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  data-e2e={`admin-person-device-remove-${device.id}`}
                  aria-label={`Remove device ${device.label}`}
                  onClick={() =>
                    props.onAsk({
                      kind: "remove-device",
                      userId: props.userId,
                      deviceId: device.id,
                      label: device.label,
                    })}
                >
                  Remove
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
  const waiting = loadingOrError(props, "Loading notifications")
  if (waiting) return waiting
  const { notifications, total, unread } = props.data!
  const more = total - notifications.length
  return (
    <Stack>
      <p class="text-sm text-muted" data-e2e="admin-person-notifications-count">
        {total === 0
          ? "No notifications."
          : `${total} ${total === 1 ? "notification" : "notifications"}, ${unread} unread.`}
        {more > 0 && ` The newest ${notifications.length} are below.`}
      </p>
      {notifications.length > 0 && (
        <PanelRows empty="" dataE2E="admin-person-notifications">
          {notifications.map((notification) => (
            <li
              key={notification.id}
              class={PANEL_ROW}
              data-e2e={`admin-person-notification-${notification.id}`}
            >
              <span class="font-medium">{notificationKindLabel(notification.kind)}</span>
              <span class="text-sm text-muted">
                <Ago at={notification.createdAt} />
              </span>
              <span class="ml-auto">
                {notification.readAt
                  ? <Badge text="Read" color="gray" type="outline" />
                  : <Badge text="Unread" color="blue" />}
              </span>
            </li>
          ))}
        </PanelRows>
      )}
    </Stack>
  )
}
