import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { CopyBlock } from "@spy4x/preact-ui/copy-block"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { OnDay } from "@spy4x/preact-ui/format"
import { Stack } from "@spy4x/preact-ui/layout"
import { Modal } from "@spy4x/preact-ui/modal"
import { TOUCH_TARGET } from "@spy4x/preact-ui/page-header"
import { SettingGroup, SettingList, SettingRow } from "@spy4x/preact-ui/setting-row"
import {
  TELEGRAM_LINK_MINUTES,
  type TelegramLinkCodeResponse,
  type TelegramStatusResponse,
} from "@domain/identity"
import { Rich } from "@spy4x/preact-ui/i18n"
import { type Said, say } from "./app-text.ts"
import { useAppText } from "./i18n.ts"

/** The catalog keys of what shows when a Telegram call failed without a message of its own. */
export const TELEGRAM_FAILURES = {
  status: `ProfileTelegram.statusFailed`,
  code: `ProfileTelegram.codeFailed`,
  unlink: `ProfileTelegram.unlinkFailed`,
} as const

/** What {@link TelegramLink} takes. */
export interface TelegramLinkProps {
  /** Whether the bot is on and when the person linked, or `null` while it is not known. */
  status: TelegramStatusResponse | null
  /** The code the open dialog shows, or `null` while no dialog is open. */
  code: TelegramLinkCodeResponse | null
  /** Why the last call failed, above the row: the server's words or a catalog key. */
  error: Said | null
  /** A code or an unlink is in flight. */
  pending: boolean
  /** "Link Telegram": the app makes a code and opens the dialog with it. */
  onLink: () => void
  /** The person closed the dialog: the app stops waiting for the link. */
  onCloseCode: () => void
  /** The person confirmed "Unlink" in its dialog. */
  onUnlink: () => void
}

/**
 * The profile's Telegram row (#269), under Notifications: whether the person's Telegram account
 * is linked, with "Link Telegram" or "Unlink". Linking opens a dialog with the code: "Open
 * Telegram" sends it in one tap, and the message to send by hand is there to copy for another
 * device. The app closes the dialog once the bot has linked the account. Unlinking asks first,
 * since undoing it takes a new code and a trip to Telegram.
 *
 * Focus: closing the dialog returns it to "Link Telegram" (the dialog's own restore). A link or an
 * unlink swaps that row's button for the other one, so focus moves to the new button. Nothing is
 * drawn while the bot is off and nothing is linked, or before the status is known.
 */
export function TelegramLink(props: TelegramLinkProps): JSX.Element | null {
  const { status, code, error, pending } = props
  const [confirming, setConfirming] = useState(false)
  const t = useAppText()
  const shown = error && say(t, error)
  const linkButton = useRef<HTMLButtonElement>(null)
  const unlinkButton = useRef<HTMLButtonElement>(null)
  const linkedAt = status?.linkedAt ?? null
  const seen = useRef<{ linkedAt: string | null } | null>(null)
  useEffect(() => {
    // The first status read is no change of the person's: focus stays where it is. The unlink's
    // dialog goes in the render that swaps the buttons, so its own focus restore runs before this.
    const before = seen.current
    seen.current = status ? { linkedAt } : null
    if (!before || !status || Boolean(before.linkedAt) === Boolean(linkedAt)) return
    if (linkedAt) unlinkButton.current?.focus()
    else {
      setConfirming(false)
      linkButton.current?.focus()
    }
  }, [status === null, linkedAt])

  if (!status) return shown ? <ErrorState message={shown} /> : null
  if (!status.enabled && !linkedAt) return null
  const bot = status.botUsername ? `@${status.botUsername}` : t.t(`ProfileTelegram.theBot`)
  const strong = (text: string) => <strong class="text-foreground">{text}</strong>
  return (
    <SettingGroup
      title={t.t(`ProfileTelegram.title`)}
      description={t.t(`ProfileTelegram.description`, { bot })}
      dataE2E="telegram"
    >
      {!(confirming && linkedAt) && <ErrorState message={shown} />}
      <SettingList>
        <SettingRow
          label={t.t(`ProfileTelegram.chat`)}
          dataE2E="telegram-status"
          value={linkedAt
            ? (
              <Rich
                parts={t.parts(`ProfileTelegram.linked`)}
                tags={{ day: () => <OnDay at={linkedAt} /> }}
              />
            )
            : t.t(`ProfileTelegram.notLinked`)}
          action={linkedAt
            ? (
              <Button
                key="unlink"
                ref={unlinkButton}
                type="button"
                variant="ghost"
                size="sm"
                class={TOUCH_TARGET}
                data-e2e="telegram-unlink"
                onClick={() => setConfirming(true)}
              >
                <Rich
                  parts={t.parts(`ProfileTelegram.unlinkHidden`)}
                  tags={{ hidden: (text) => <span class="sr-only">{text}</span> }}
                />
              </Button>
            )
            : (
              <Button
                key="link"
                ref={linkButton}
                type="button"
                variant="secondary"
                data-e2e="telegram-link"
                onClick={props.onLink}
                busy={pending}
                busyLabel={t.t(`ProfileNotifications.working`)}
              >
                {t.t(`ProfileTelegram.link`)}
              </Button>
            )}
        />
      </SettingList>
      {confirming && linkedAt && (
        <ConfirmDialog
          title={t.t(`ProfileTelegram.unlinkTitle`)}
          tone="danger"
          confirmLabel={t.t(`SignInMethods.unlinkButton`)}
          cancelLabel={t.t(`EmailScreen.cancel`)}
          busy={pending}
          busyLabel={t.t(`SignInMethods.unlinking`)}
          onConfirm={() => {
            props.onUnlink()
            return false
          }}
          onCancel={() => setConfirming(false)}
          dataE2E="telegram-unlink-dialog"
          confirmDataE2E="telegram-unlink-confirm"
        >
          <Stack>
            <p class="text-sm text-muted">
              {t.t(`ProfileTelegram.unlinkText`, { bot })}
            </p>
            <ErrorState message={shown} />
          </Stack>
        </ConfirmDialog>
      )}
      <Modal
        open={code !== null}
        onClose={props.onCloseCode}
        title={t.t(`ProfileTelegram.link`)}
        cancelLabel={t.t(`EmailScreen.close`)}
        dataE2E="telegram-code-dialog"
      >
        {code && (
          <Stack>
            <p class="text-sm text-muted">
              <Rich parts={t.parts(`ProfileTelegram.open`, { bot })} tags={{ strong }} />
            </p>
            <Button
              href={code.url}
              target="_blank"
              rel="noopener noreferrer"
              class="min-h-11 w-full sm:min-h-9 sm:w-auto sm:self-start"
              data-e2e="telegram-open"
            >
              {t.t(`ProfileTelegram.openButton`)}
            </Button>
            <p class="text-sm text-muted">{t.t(`ProfileTelegram.elsewhere`, { bot })}</p>
            <div data-e2e="telegram-code">
              <CopyBlock
                text={`/link ${code.code}`}
                textLabel={t.t(`ProfileTelegram.message`)}
                copyLabel={t.t(`ProfileTelegram.copy`)}
                copiedLabel={t.t(`ProfileTelegram.copied`)}
              />
            </div>
            <p class="text-sm text-muted" role="status">
              {t.t(`ProfileTelegram.waiting`, { count: TELEGRAM_LINK_MINUTES })}
            </p>
          </Stack>
        )}
      </Modal>
    </SettingGroup>
  )
}
