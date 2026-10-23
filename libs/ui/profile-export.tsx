import type { JSX } from "preact"
import { useRef } from "preact/hooks"
import { IconSpinner } from "@spy4x/preact-icons"
import { Button } from "@spy4x/preact-ui/button"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { OnDay, useFormat } from "@spy4x/preact-ui/format"
import { TOUCH_TARGET } from "@spy4x/preact-ui/page-header"
import { SettingRow } from "@spy4x/preact-ui/setting-row"
import { useFocusFallback } from "@spy4x/preact-ui/use-focus-after-removal"
import { formatBytes } from "@spy4x/platform/universal/format-number"
import { DataExportStatus, type DataExportView } from "@domain/identity"

/** The id of the row's control, which a link or a command can focus: `#your-data`. */
export const DATA_EXPORT_ANCHOR = "your-data"

/** Why the last request for a file did not go through. */
export type DataExportError =
  /** One file a day: the next may be asked for at `retryAt`. */
  | { kind: "too-soon"; retryAt: Date }
  /** The request did not reach the server, or it failed. */
  | { kind: "network" }

/** What the "Your data" row and its error take. */
export interface DataExportRowProps {
  /** The newest export; `null` when the person never asked for one, `undefined` while it is read. */
  exportState: DataExportView | null | undefined
  /** A request is in flight. */
  pending: boolean
  error: DataExportError | null
  /** Asks for a new file. */
  onRequest: () => void
  /** The address that downloads the ready file. */
  downloadHref: string
  /** The present in epoch milliseconds, for "24 hours passed". Default: the time of the render. */
  now?: number
}

const NEVER_ASKED = "A ZIP of your profile, groups and notes, as JSON and CSV files. It takes a " +
  "few minutes, and we e-mail you when it is ready."

/**
 * The Account section's "Your data" row (#229): the newest export's state and the one action it
 * allows. The value is a live region from the first render, so "Preparing your file" and the file
 * turning ready are read out without moving focus. When a render takes the focused control away,
 * such as a request that leaves the file in preparation, focus moves to the value instead of
 * falling to the page.
 */
export function DataExportRow(props: DataExportRowProps): JSX.Element {
  const { exportState, pending } = props
  const now = props.now ?? Date.now()
  const status = useRef<HTMLDivElement>(null)
  const askButton = useRef<HTMLButtonElement>(null)
  // When a render removes the focused control (the row's button, or "Prepare a new file." inside
  // the value), focus moves to the value in that same commit, so it never rests on the page. The
  // value keeps `tabIndex={-1}` in every state, so a script can always focus it and Tab never does.
  const focusStatus = () => status.current
  useFocusFallback(askButton, focusStatus)
  useFocusFallback(status, focusStatus)
  const onRequest = () => {
    if (!pending) props.onRequest()
  }
  const ask = (label: string, dataE2E: string) => (
    <Button
      ref={askButton}
      id={DATA_EXPORT_ANCHOR}
      type="button"
      variant="secondary"
      size="sm"
      class={TOUCH_TARGET}
      data-e2e={dataE2E}
      busy={pending}
      busyLabel="Asking…"
      onClick={onRequest}
    >
      {label}
    </Button>
  )

  let value: JSX.Element | string = "…"
  let action: JSX.Element | null = null
  if (exportState === null) {
    value = NEVER_ASKED
    action = ask("Download my data", "data-export-request")
  } else if (exportState) {
    switch (exportState.status) {
      case DataExportStatus.Preparing:
        value = (
          <span class="flex items-start gap-2">
            <IconSpinner class="mt-px size-4 shrink-0 text-selected" />
            <span>
              Preparing your file. We will e-mail you and send a notification when it is ready.
            </span>
          </span>
        )
        break
      case DataExportStatus.Ready:
        value = (
          <span class="flex flex-col gap-1">
            <span>
              <span class="sr-only">Your file is ready.</span> Ready:{" "}
              {formatBytes(exportState.sizeBytes ?? 0)}, until <OnDay at={exportState.expiresAt} />.
            </span>
            {now >= exportState.nextRequestAt.getTime() && (
              <span>
                Your data changed since?{" "}
                <button
                  type="button"
                  class="pc-link inline-flex min-h-11 items-center sm:min-h-0"
                  data-e2e="data-export-again"
                  onClick={onRequest}
                  aria-disabled={pending || undefined}
                >
                  Prepare a new file.
                </button>
              </span>
            )}
          </span>
        )
        action = (
          <Button
            id={DATA_EXPORT_ANCHOR}
            href={props.downloadHref}
            download
            size="sm"
            class={TOUCH_TARGET}
            data-e2e="data-export-download"
          >
            Download ZIP
          </Button>
        )
        break
      case DataExportStatus.Expired:
        value = (
          <span>
            Your last file expired on <OnDay at={exportState.expiresAt} />.
          </span>
        )
        action = ask("Prepare a new file", "data-export-request")
        break
      case DataExportStatus.Failed:
        value = <span class="text-danger">We could not prepare your file.</span>
        action = ask("Try again", "data-export-request")
        break
    }
  }

  return (
    <SettingRow
      label="Your data"
      dataE2E="data-export-row"
      value={
        <div
          ref={status}
          role="status"
          class="rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus"
          id={action ? undefined : DATA_EXPORT_ANCHOR}
          tabIndex={-1}
          data-e2e="data-export-state"
        >
          {value}
        </div>
      }
      action={action}
    />
  )
}

/**
 * The refusal of the last request, under the list: one file a day, or the request failed. It takes
 * focus when it appears.
 */
export function DataExportErrorState(
  { error }: { error: DataExportError | null },
): JSX.Element | null {
  const format = useFormat()
  let message: string | null = null
  if (error?.kind === "network") {
    message = "Could not ask for your file. Check your connection and try again."
  } else if (error?.kind === "too-soon") {
    const day = format.date(error.retryAt) === format.date(new Date()) ? "today" : "tomorrow"
    message = `You can ask for one file a day. Ask again after ${
      format.time(error.retryAt)
    } ${day}.`
  }
  return <ErrorState message={message} focusOnAppear dataE2E="data-export-error" />
}
