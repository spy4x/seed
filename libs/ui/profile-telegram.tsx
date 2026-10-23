import type { JSX } from "preact"
import { Button } from "@spy4x/preact-ui/button"
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
import { ScreenForm } from "./progressive.tsx"

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
  onUnlink: () => void
}

/**
 * The profile's Telegram row (#269), under Notifications: whether the person's Telegram account
 * is linked, with "Link Telegram" or "Unlink". Linking opens a dialog with the code: "Open
 * Telegram" sends it in one tap, and the message to send by hand is there to copy for another
 * device. The app closes the dialog once the bot has linked the account. Nothing is drawn while
 * the bot is off and nothing is linked, or before the status is known.
 */
export function TelegramLink(props: TelegramLinkProps): JSX.Element | null {
  const { status, code, error, pending } = props
  if (!status) return error ? <ErrorState message={error} /> : null
  if (!status.enabled && !status.linkedAt) return null
  const bot = status.botUsername ? `@${status.botUsername}` : "the bot"
  return (
    <SettingGroup
      title="Telegram"
      description={`Get your notifications in a chat with ${bot}, and use its commands there.`}
      dataE2E="telegram"
    >
      <ErrorState message={error} />
      <SettingList>
        <SettingRow
          label="Telegram"
          dataE2E="telegram-status"
          value={status.linkedAt
            ? (
              <>
                Linked <OnDay at={status.linkedAt} />
              </>
            )
            : "Not linked"}
          action={status.linkedAt
            ? (
              <ScreenForm pending={pending} onSubmit={props.onUnlink}>
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  class={TOUCH_TARGET}
                  data-e2e="telegram-unlink"
                  disabled={pending}
                >
                  Unlink <span class="sr-only">Telegram</span>
                </Button>
              </ScreenForm>
            )
            : (
              <ScreenForm pending={pending} onSubmit={props.onLink}>
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  class={TOUCH_TARGET}
                  data-e2e="telegram-link"
                  busy={pending}
                  busyLabel="Working…"
                >
                  Link Telegram
                </Button>
              </ScreenForm>
            )}
        />
      </SettingList>
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
              and press Start. That sends your code, and this window closes once your account is
              linked.
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
                singleLine
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
