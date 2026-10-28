// deno-lint-ignore-file ui-text/no-literal
import type { JSX } from "preact"
import { IconBell } from "@spy4x/preact-icons"
import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { useFormat } from "@spy4x/preact-ui/format"
import { TOUCH_TARGET } from "@spy4x/preact-ui/page-header"
import { SettingList, SettingRow } from "@spy4x/preact-ui/setting-row"
import type { UserPushTokenPublic } from "@domain/identity"
import { ScreenForm } from "./progressive.tsx"

/** What {@link PushDevicesSection} takes. */
export interface PushDevicesSectionProps {
  devices: readonly UserPushTokenPublic[]
  /** Why adding or removing a device failed, above the list. */
  error: string | null
  /** An add or a remove is in flight. */
  pending: boolean
  /**
   * Registering a device needs the browser's push manager. Without it there is no "Add this
   * device" button.
   */
  onRegister?: () => void
  onRemove: (deviceId: string) => void
}

/**
 * The profile's Notifications section: the devices that get a push notification, each with
 * "Remove" (one click, since turning notifications on there adds it back), and "Add this device".
 */
export function PushDevicesSection(
  { devices, error, pending, onRegister, onRemove }: PushDevicesSectionProps,
): JSX.Element {
  const format = useFormat()
  return (
    <div class="flex flex-col gap-4" data-e2e="push-devices">
      <ErrorState message={error} />
      {devices.length === 0
        ? (
          <Card>
            <EmptyState
              icon={<IconBell class="size-6" />}
              title="No devices yet"
              headingLevel={3}
              inset
              description="Add this browser to get notifications on it."
              action={onRegister && <AddDevice onClick={onRegister} busy={pending} />}
            />
          </Card>
        )
        : (
          <>
            <SettingList>
              {devices.map((device) => (
                <SettingRow
                  key={device.id}
                  dataE2E={`push-device-${device.deviceId}`}
                  label={`Device ${device.deviceId.slice(-8)}`}
                  value={`Added ${format.dateTime(device.createdAt)}`}
                  action={
                    <ScreenForm pending={pending} onSubmit={() => onRemove(device.deviceId)}>
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        class={TOUCH_TARGET}
                        data-e2e={`push-remove-${device.deviceId}`}
                        disabled={pending}
                      >
                        Remove <span class="sr-only">device {device.deviceId.slice(-8)}</span>
                      </Button>
                    </ScreenForm>
                  }
                />
              ))}
            </SettingList>
            {onRegister && (
              <div>
                <AddDevice onClick={onRegister} busy={pending} />
              </div>
            )}
          </>
        )}
    </div>
  )
}

function AddDevice({ onClick, busy }: { onClick: () => void; busy: boolean }): JSX.Element {
  return (
    <Button
      type="button"
      variant="secondary"
      data-e2e="push-register"
      onClick={onClick}
      busy={busy}
      busyLabel="Working…"
    >
      Add this device
    </Button>
  )
}
