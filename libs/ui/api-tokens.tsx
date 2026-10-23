import type { JSX } from "preact"
import { useState } from "preact/hooks"
import { IconExternalLink, IconKey } from "@spy4x/preact-icons"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { Card } from "@spy4x/preact-ui/card"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { SavedCopyNotice } from "@spy4x/preact-system/saved-copy-notice"
import { type ApiToken, ApiTokenAccess } from "@domain/api-tokens"
import { TOUCH_TARGET } from "@spy4x/preact-ui/page-header"
import { API_TOKEN_PATHS, type Navigate } from "./progressive.tsx"
import { SettingList, SettingRow } from "@spy4x/preact-ui/setting-row"
import { useFormat, When } from "@spy4x/preact-ui/format"

export interface ApiTokensProps {
  /** Live tokens, newest first; `null` while the list is not known yet. */
  tokens: readonly ApiToken[] | null
  /** The person is in a group a token may be made for. Without one, "New token" is left out. */
  canCreate: boolean
  /** Why the list could not be read or a revoke failed; shown above the list. */
  error: string | null
  /** A revoke is in flight. */
  revoking: boolean
  /**
   * When the list was taken from the server, in epoch milliseconds, while it is the copy saved on
   * this device (the server is unreachable). The screen then says how old the list is. Leave it
   * out, or pass `null`, for the server's answer.
   */
  savedAt?: number | null
  /** Revokes one token, after the person confirmed. */
  onRevoke: (tokenId: string) => void
  navigate?: Navigate
  /** The API reference on the product's website; without one, no link to it shows. */
  docsHref?: string | null
}

/**
 * A link to the API reference, which opens in a new tab: on the create page a same-tab link would
 * lose a half-filled form, or the secret that is shown once.
 */
export function ApiDocsLink(
  { href, dataE2E, children }: { href: string; dataE2E: string; children: string },
): JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      class="pc-link inline-flex items-center gap-1"
      data-e2e={dataE2E}
    >
      {children}
      <IconExternalLink class="size-4" aria-hidden="true" />
      <span class="sr-only">, opens in a new tab</span>
    </a>
  )
}

/**
 * The words of the notice over a saved copy of this list. The title names the list, because the
 * signed-in devices' notice sits on the same page and a screen reader would hear two identical ones.
 */
const API_TOKENS_SAVED_COPY_LABELS = {
  title: "Saved copy of your API tokens",
  body: (time: string) =>
    `The server is out of reach. This list was saved on this device: ${time}. Tokens created or revoked since then are missing from it.`,
}

/**
 * "API tokens" on the profile: each live token with its group, access, expiry and last use, and
 * "Revoke", which asks first. "New token" opens the create page (`/tokens/new`), which shows the
 * new token's secret once.
 */
export function ApiTokens(props: ApiTokensProps): JSX.Element {
  const { tokens, canCreate, error, revoking, savedAt, navigate, docsHref } = props
  const [asking, setAsking] = useState<ApiToken | null>(null)

  const newButton = canCreate && (
    <Button
      href={API_TOKEN_PATHS.new}
      navigate={navigate}
      variant="secondary"
      data-e2e="api-token-create-open"
    >
      New token
    </Button>
  )

  const docsLine = docsHref && (
    <p class="text-sm text-muted">
      <ApiDocsLink href={docsHref} dataE2E="api-tokens-docs">How to use a token</ApiDocsLink>
    </p>
  )

  return (
    <div class="flex flex-col gap-4" data-e2e="api-tokens">
      <ErrorState message={error} />
      <SavedCopyNotice
        savedAt={savedAt}
        labels={API_TOKENS_SAVED_COPY_LABELS}
        data-e2e="api-tokens-saved-copy"
      />
      {tokens === null
        ? <p class="text-sm text-muted">Loading your tokens…</p>
        : tokens.length === 0
        ? (
          <>
            <Card>
              {/* Inside the section's own card, like every other section, not a dashed box. */}
              <EmptyState
                icon={<IconKey class="size-6" />}
                title="No API tokens"
                headingLevel={3}
                inset
                description="A token acts as you in one group, read only or read and write."
                action={newButton || undefined}
              />
            </Card>
            {docsLine}
          </>
        )
        : (
          <>
            <SettingList>
              {tokens.map((token) => (
                <SettingRow
                  key={token.id}
                  dataE2E={`api-token-${token.id}`}
                  label={token.name}
                  value={<TokenDetails token={token} />}
                  action={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      class={TOUCH_TARGET}
                      data-e2e={`api-token-revoke-${token.id}`}
                      disabled={revoking}
                      onClick={() => setAsking(token)}
                    >
                      Revoke <span class="sr-only">{token.name}</span>
                    </Button>
                  }
                />
              ))}
            </SettingList>
            <p class="text-sm text-muted">
              Changing or resetting your password revokes every token.
            </p>
            {docsLine}
            {newButton && <div>{newButton}</div>}
          </>
        )}

      {asking && (
        <ConfirmDialog
          title={`Revoke "${asking.name}"?`}
          message="Anything that uses this token stops working at once. This cannot be undone."
          confirmLabel="Revoke"
          cancelLabel="Cancel"
          tone="danger"
          dataE2E="api-token-revoke-confirm"
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            setAsking(null)
            props.onRevoke(asking.id)
          }}
        />
      )}
    </div>
  )
}

/**
 * The group and access on one line, then when the token expires and when it was last used, one
 * line each, so a narrow screen never strands a separator.
 */
function TokenDetails({ token }: { token: ApiToken }): JSX.Element {
  const format = useFormat()
  return (
    <span class="flex flex-col items-start gap-1" data-e2e="api-token-details">
      <span class="flex flex-wrap items-center gap-2">
        <span>{token.groupName}</span>
        <Badge
          text={token.access === ApiTokenAccess.WRITE ? "Read and write" : "Read only"}
          color={token.access === ApiTokenAccess.WRITE ? "orange" : "gray"}
          type="outline"
        />
      </span>
      <span>
        {token.expiresAt
          ? (
            <>
              Expires <time dateTime={token.expiresAt}>{format.date(token.expiresAt)}</time>
            </>
          )
          : "Never expires"}
      </span>
      <span>
        {token.lastUsedAt
          ? (
            <>
              Last used <When at={token.lastUsedAt} />
            </>
          )
          : "Never used"}
      </span>
    </span>
  )
}
