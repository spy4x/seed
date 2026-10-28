// deno-lint-ignore-file ui-text/no-literal
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

/** The messages shown when a Telegram call failed without a message of its own. */
export const TELEGRAM_FAILURES = {
  status: "Could not read your Telegram link. Check your connection and try again.",
  code: "Could not make a link code. Check your connection and try again.",
  unlink: "Could not unlink Telegram. Check your connection and try again.",
} as const

/** What {@link TelegramLink} takes. */
export interface TelegramLinkProps {
  /** Whether the bot is on and when the person linked, or `null` while it is not known. */
  status: TelegramStatusResponse | null
  /** The code the open dialog shows, or `null` while no dialog is open. */
  code: TelegramLinkCodeResponse | null
  /** Why the last call failed, above the row. */
  error: string | null
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

  if (!status) return error ? <ErrorState message={error} /> : null
  if (!status.enabled && !linkedAt) return null
  const bot = status.botUsername ? `@${status.botUsername}` : "the bot"
  return (
    <SettingGroup
      title="Telegram"
      description={`Get your notifications in a chat with ${bot}, and use its commands there.`}
      dataE2E="telegram"
    >
      {!(confirming && linkedAt) && <ErrorState message={error} />}
      <SettingList>
        <SettingRow
          label="Chat"
          dataE2E="telegram-status"
          value={linkedAt
            ? (
              <>
                Linked <OnDay at={linkedAt} />
              </>
            )
            : "Not linked"}
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
                Unlink <span class="sr-only">Telegram</span>
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
                busyLabel="Working…"
              >
                Link Telegram
              </Button>
            )}
        />
      </SettingList>
      {confirming && linkedAt && (
        <ConfirmDialog
          title="Unlink Telegram?"
          tone="danger"
          confirmLabel="Unlink"
          busy={pending}
          busyLabel="Unlinking…"
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
              Your notifications stop reaching Telegram, and {bot}{" "}
              can no longer act for you there. To link it again you need a new code.
            </p>
            <ErrorState message={error} />
          </Stack>
        </ConfirmDialog>
      )}
      <Modal
        open={code !== null}
        onClose={props.onCloseCode}
        title="Link Telegram"
        cancelLabel="Close"
        dataE2E="telegram-code-dialog"
      >
        {code && (
          <Stack>
            <p class="text-sm text-muted">
              Open the chat with <strong class="text-foreground">{bot}</strong>{" "}
              and press Start, then Link. This window closes once your account is linked.
            </p>
            <Button
              href={code.url}
              target="_blank"
              rel="noopener noreferrer"
              class="min-h-11 w-full sm:min-h-9 sm:w-auto sm:self-start"
              data-e2e="telegram-open"
            >
              Open Telegram
            </Button>
            <p class="text-sm text-muted">Telegram on another device? Send {bot} this message:</p>
            <div data-e2e="telegram-code">
              <CopyBlock
                text={`/link ${code.code}`}
                textLabel="Message to send"
                copyLabel="Copy message"
                copiedLabel="Message copied"
              />
            </div>
            <p class="text-sm text-muted" role="status">
              Waiting for Telegram… The code works once, for {TELEGRAM_LINK_MINUTES} minutes.
            </p>
          </Stack>
        )}
      </Modal>
    </SettingGroup>
  )
}
