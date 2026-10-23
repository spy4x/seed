import type { JSX } from "preact"
import { Badge } from "@spy4x/preact-ui/badge"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { OnDay, When } from "@spy4x/preact-ui/format"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { formatBytes } from "@spy4x/platform/universal/format-number"
import { type DataExportJson, DataExportStatus } from "@domain/identity"
import { PANEL_ROW, PanelRows } from "./admin-api-tokens-screen.tsx"

/** What the "Data exports" tab takes: the API's answer, `null` while it loads or after a failure. */
export interface AdminPersonDataExportsPanelProps {
  exports: readonly DataExportJson[] | null
  error: string | null
}

const BADGES: Record<DataExportStatus, JSX.Element> = {
  [DataExportStatus.Preparing]: <Badge text="Preparing" color="gray" />,
  [DataExportStatus.Ready]: <Badge text="Ready" color="green" />,
  [DataExportStatus.Expired]: <Badge text="Expired" color="gray" type="outline" />,
  [DataExportStatus.Failed]: <Badge text="Failed" color="red" />,
}

/**
 * The person's "Data exports" tab (#229): each copy of their data they asked for, newest first,
 * with its state, size and expiry. Metadata only: the file holds the person's data, so the
 * operator has no download here.
 */
export function AdminPersonDataExportsPanel(
  { exports, error }: AdminPersonDataExportsPanelProps,
): JSX.Element {
  if (error) return <ErrorState message={error} />
  if (exports === null) {
    return (
      <div role="status" aria-label="Loading data exports">
        <LoadingSkeleton rows={3} />
      </div>
    )
  }
  return (
    <PanelRows empty="No data exports." dataE2E="admin-person-data-exports">
      {exports.map((item) => (
        <li key={item.id} class={PANEL_ROW} data-e2e={`admin-person-data-export-${item.id}`}>
          <span class="font-medium">
            Requested <When at={item.requestedAt} />
          </span>
          {BADGES[item.status]}
          {item.sizeBytes !== null && (
            <span class="text-sm text-muted">{formatBytes(item.sizeBytes)}</span>
          )}
          {item.expiresAt && (
            <span class="ml-auto text-sm text-muted">
              {item.status === DataExportStatus.Expired ? "Expired" : "Expires"}{" "}
              <OnDay at={item.expiresAt} />
            </span>
          )}
        </li>
      ))}
    </PanelRows>
  )
}
