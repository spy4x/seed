import type { JSX } from "preact"
import { Badge } from "@spy4x/preact-ui/badge"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { OnDay, When } from "@spy4x/preact-ui/format"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { formatBytes } from "@spy4x/platform/universal/format-number"
import { type DataExportJson, DataExportStatus } from "@domain/identity"
import { Rich } from "@spy4x/preact-ui/i18n"
import { PANEL_ROW, PanelRows } from "./admin-api-tokens-screen.tsx"
import { useAdminText } from "./i18n.ts"

/** What the "Data exports" tab takes: the API's answer, `null` while it loads or after a failure. */
export interface AdminPersonDataExportsPanelProps {
  exports: readonly DataExportJson[] | null
  error: string | null
}

/** Each state's badge: its word's key and its look. */
const BADGES = {
  [DataExportStatus.Preparing]: { key: `AdminDataExports.preparing`, color: `gray` },
  [DataExportStatus.Ready]: { key: `AdminDataExports.ready`, color: `green` },
  [DataExportStatus.Expired]: { key: `AdminDataExports.expired`, color: `gray`, outline: true },
  [DataExportStatus.Failed]: { key: `AdminDataExports.failed`, color: `red` },
} as const satisfies Record<
  DataExportStatus,
  { key: string; color: `gray` | `green` | `red`; outline?: true }
>

/**
 * The person's "Data exports" tab (#229): each copy of their data they asked for, newest first,
 * with its state, size and expiry. Metadata only: the file holds the person's data, so the
 * operator has no download here.
 */
export function AdminPersonDataExportsPanel(
  { exports, error }: AdminPersonDataExportsPanelProps,
): JSX.Element {
  const t = useAdminText()
  if (error) return <ErrorState message={error} />
  if (exports === null) {
    return (
      <div role="status" aria-label={t.t(`AdminDataExports.loading`)}>
        <LoadingSkeleton rows={3} />
      </div>
    )
  }
  return (
    <PanelRows empty={t.t(`AdminDataExports.empty`)} dataE2E="admin-person-data-exports">
      {exports.map((item) => {
        const badge: { key: string; color: `gray` | `green` | `red`; outline?: true } =
          BADGES[item.status]
        return (
          <li key={item.id} class={PANEL_ROW} data-e2e={`admin-person-data-export-${item.id}`}>
            <span class="font-medium">
              <Rich
                parts={t.parts(`AdminDataExports.requested`)}
                tags={{ when: () => <When at={item.requestedAt} /> }}
              />
            </span>
            <Badge
              text={t.t(badge.key)}
              color={badge.color}
              type={badge.outline ? `outline` : undefined}
            />
            {item.sizeBytes !== null && (
              <span class="text-sm text-muted">{formatBytes(item.sizeBytes)}</span>
            )}
            {item.expiresAt && (
              <span class="ml-auto text-sm text-muted">
                <Rich
                  parts={t.parts(
                    item.status === DataExportStatus.Expired
                      ? `AdminDataExports.expiredOn`
                      : `AdminDataExports.expiresOn`,
                  )}
                  tags={{ day: () => <OnDay at={item.expiresAt} /> }}
                />
              </span>
            )}
          </li>
        )
      })}
    </PanelRows>
  )
}
