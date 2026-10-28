import type { JSX } from "preact"
import { useState } from "preact/hooks"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { SavedCopyNotice } from "@spy4x/preact-system/saved-copy-notice"
import type { SignedInDevice } from "@domain/identity"
import { TOUCH_TARGET } from "@spy4x/preact-ui/page-header"
import { SettingGroup, SettingList, SettingRow } from "@spy4x/preact-ui/setting-row"
import { When } from "@spy4x/preact-ui/format"
import { Rich } from "@spy4x/preact-ui/i18n"
import { useAppText } from "./i18n.ts"

/** The message shown when ending a session failed without a message of its own. */
export const SESSIONS_FAILURE = `SignedInDevices.failed`

export interface SignedInDevicesProps {
  /** This device first, then the rest; `null` while the list is not known yet. */
  sessions: readonly SignedInDevice[] | null
  /** A sign-out is in flight: every sign-out button waits. */
  pending: boolean
  /** Why the list could not be read or a sign-out failed; shown above the list. */
  error: string | null
  /**
   * When the list was taken from the server, in epoch milliseconds, while it is the copy saved on
   * this device (the server is unreachable). The screen then says how old the list is. Leave it
   * out, or pass `null`, for the server's answer.
   */
  savedAt?: number | null
  /** Ends one other session, after the person confirmed. */
  onEnd: (sessionId: number) => void
  /** Ends every session but this device's, after the person confirmed. */
  onEndOthers: () => void
}

/**
 * The words of the notice over a saved copy of this list. The title names the list, because the API
 * tokens' notice sits on the same page and a screen reader would hear two identical ones.
 */

/** What waits for the person's confirmation: one device, or all the others. */
type Confirming = { session: SignedInDevice } | "others" | null

/**
 * The devices the person is signed in on, this one marked, each other one with "Sign out", and
 * "Sign out of all other devices" under the list while there is another. Both ask first.
 */
export function SignedInDevices(
  { sessions, pending, error, savedAt, onEnd, onEndOthers }: SignedInDevicesProps,
): JSX.Element {
  const [confirming, setConfirming] = useState<Confirming>(null)
  const others = sessions?.filter((session) => !session.current) ?? []
  const t = useAppText()

  return (
    <SettingGroup
      title={t.t(`SignedInDevices.title`)}
      description={t.t(`SignedInDevices.description`)}
      dataE2E="sessions"
    >
      <ErrorState message={error} />
      <SavedCopyNotice
        savedAt={savedAt}
        labels={{
          title: t.t(`SignedInDevices.savedTitle`),
          body: (time) => t.t(`SignedInDevices.savedBody`, { time }),
        }}
        data-e2e="sessions-saved-copy"
      />
      {sessions === null
        ? <p class="text-sm text-muted">{t.t(`SignedInDevices.loading`)}</p>
        : (
          <SettingList>
            {sessions.map((session) => (
              <SettingRow
                key={session.id}
                dataE2E={session.current ? "session-current" : `session-${session.id}`}
                label={session.deviceName}
                value={<DeviceDetails session={session} />}
                action={!session.current && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    class={TOUCH_TARGET}
                    data-e2e={`session-end-${session.id}`}
                    disabled={pending}
                    onClick={() => setConfirming({ session })}
                  >
                    <Rich
                      parts={t.parts(`SignedInDevices.signOutDevice`, {
                        device: session.deviceName,
                      })}
                      tags={{ device: (text) => <span class="sr-only">{text}</span> }}
                    />
                  </Button>
                )}
              />
            ))}
          </SettingList>
        )}
      {others.length > 0 && (
        <div>
          <Button
            type="button"
            variant="secondary"
            data-e2e="sessions-end-others"
            busy={pending}
            busyLabel={t.t(`SignedInDevices.signingOut`)}
            onClick={() => setConfirming("others")}
          >
            {t.t(`SignedInDevices.signOutOthers`)}
          </Button>
        </div>
      )}

      {confirming === "others" && (
        <ConfirmDialog
          title={t.t(`SignedInDevices.othersTitle`)}
          message={t.t(`SignedInDevices.othersMessage`, { count: others.length })}
          confirmLabel={t.t(`SignedInDevices.signOut`)}
          cancelLabel={t.t(`EmailScreen.cancel`)}
          tone="danger"
          dataE2E="sessions-end-others-confirm"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null)
            onEndOthers()
          }}
        />
      )}
      {confirming !== null && confirming !== "others" && (
        <ConfirmDialog
          title={t.t(`SignedInDevices.oneTitle`, { device: confirming.session.deviceName })}
          message={t.t(`SignedInDevices.oneMessage`)}
          confirmLabel={t.t(`SignedInDevices.signOut`)}
          cancelLabel={t.t(`EmailScreen.cancel`)}
          tone="danger"
          dataE2E="session-end-confirm"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null)
            onEnd(confirming.session.id)
          }}
        />
      )}
    </SettingGroup>
  )
}

/**
 * "This device" or when it was last active, and under it the address with its last part hidden.
 * One line each, so a narrow screen never strands a separator at the start of a wrapped line.
 */
function DeviceDetails({ session }: { session: SignedInDevice }): JSX.Element {
  const t = useAppText()
  return (
    <span class="flex flex-col items-start gap-1" data-e2e="session-details">
      {session.current
        ? <Badge text={t.t(`SignedInDevices.thisDevice`)} color="green" type="outline" />
        : (
          <span>
            <Rich
              parts={t.parts(`SignedInDevices.lastActive`)}
              tags={{ when: () => <When at={session.lastUsedAt} /> }}
            />
          </span>
        )}
      {session.ipHint && (
        <span>
          <Rich
            parts={t.parts(`SignedInDevices.ip`, { ip: session.ipHint })}
            tags={{
              label: (text) => <span class="sr-only">{text}</span>,
              ip: (text) => <bdi data-e2e="session-ip">{text}</bdi>,
            }}
          />
        </span>
      )}
    </span>
  )
}
