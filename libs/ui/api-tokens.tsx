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
import { Rich } from "@spy4x/preact-ui/i18n"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { useAppText } from "./i18n.ts"

export interface ApiTokensProps {
  /** Live tokens, newest first; `null` while the list is not known yet. */
  tokens: readonly ApiToken[] | null
  /** The person is in a group a token may be made for. Without one, "New token" is left out. */
  canCreate: boolean
  /**
   * Why the list could not be read or a revoke failed; shown above the list. One of
   * {@link API_TOKEN_MESSAGES}, or the API's own message.
   */
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
 * The messages the API tokens store sets when the API gave none, by their key in the `app` catalog.
 * The screens show them in the person's language.
 */
export const API_TOKEN_MESSAGES = {
  /** Reading or revoking failed. */
  failed: `ApiTokens.failed`,
  /** A create failed. */
  createFailed: `ApiTokenNewScreen.createFailed`,
  /** The form was sent without a name. */
  nameMissing: `ApiTokenNewScreen.nameMissing`,
  /** The form was sent without the password. */
  passwordMissing: `ApiTokenNewScreen.passwordMissing`,
  /** A create was tried offline. */
  offline: `ApiTokenNewScreen.offline`,
} as const

const MESSAGE_KEYS: readonly string[] = Object.values(API_TOKEN_MESSAGES)

/** A store's message for the screen: one of {@link API_TOKEN_MESSAGES} translated, any other as it is. */
export function tokenMessage(t: Translator<string>, message: string | null): string | null {
  return message !== null && MESSAGE_KEYS.includes(message) ? t.t(message) : message
}

/**
 * A link to the API reference, which opens in a new tab: on the create page a same-tab link would
 * lose a half-filled form, or the secret that is shown once.
 */
export function ApiDocsLink(
  { href, dataE2E, children }: { href: string; dataE2E: string; children: string },
): JSX.Element {
  const t = useAppText()
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
      <span class="sr-only">{t.t(`ApiDocsLink.newTab`)}</span>
    </a>
  )
}

/**
 * "API tokens" on the profile: each live token with its group, access, expiry and last use, and
 * "Revoke", which asks first. "New token" opens the create page (`/tokens/new`), which shows the
 * new token's secret once.
 */
export function ApiTokens(props: ApiTokensProps): JSX.Element {
  const { tokens, canCreate, error, revoking, savedAt, navigate, docsHref } = props
  const [asking, setAsking] = useState<ApiToken | null>(null)
  const t = useAppText()

  const newButton = canCreate && (
    <Button
      href={API_TOKEN_PATHS.new}
      navigate={navigate}
      variant="secondary"
      data-e2e="api-token-create-open"
    >
      {t.t(`ApiTokens.new`)}
    </Button>
  )

  const docsLine = docsHref && (
    <p class="text-sm text-muted">
      <ApiDocsLink href={docsHref} dataE2E="api-tokens-docs">
        {t.t(`ApiTokens.howToUse`)}
      </ApiDocsLink>
    </p>
  )

  return (
    <div class="flex flex-col gap-4" data-e2e="api-tokens">
      <ErrorState message={tokenMessage(t, error)} />
      <SavedCopyNotice
        savedAt={savedAt}
        // The title names the list, because the signed-in devices' notice sits on the same page and
        // a screen reader would hear two identical ones.
        labels={{
          title: t.t(`ApiTokens.savedCopyTitle`),
          body: (time) => t.t(`ApiTokens.savedCopyBody`, { time }),
        }}
        data-e2e="api-tokens-saved-copy"
      />
      {tokens === null
        ? <p class="text-sm text-muted">{t.t(`ApiTokens.loading`)}</p>
        : tokens.length === 0
        ? (
          <>
            <Card>
              {/* Inside the section's own card, like every other section, not a dashed box. */}
              <EmptyState
                icon={<IconKey class="size-6" />}
                title={t.t(`ApiTokens.emptyTitle`)}
                headingLevel={3}
                inset
                description={t.t(`ApiTokens.emptyText`)}
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
                      <Rich
                        parts={t.parts(`ApiTokens.revokeNamed`, { name: token.name })}
                        tags={{
                          name: (text) => <span class="sr-only" translate={false}>{text}</span>,
                        }}
                      />
                    </Button>
                  }
                />
              ))}
            </SettingList>
            <p class="text-sm text-muted">{t.t(`ApiTokens.passwordRevokes`)}</p>
            {docsLine}
            {newButton && <div>{newButton}</div>}
          </>
        )}

      {asking && (
        <ConfirmDialog
          title={
            <Rich
              parts={t.parts(`ApiTokens.revokeTitle`, { name: asking.name })}
              tags={{ name: (text) => <bdi translate={false}>{text}</bdi> }}
            />
          }
          message={t.t(`ApiTokens.revokeMessage`)}
          confirmLabel={t.t(`ApiTokens.revoke`)}
          cancelLabel={t.t(`ApiTokens.cancel`)}
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
  const t = useAppText()
  return (
    <span class="flex flex-col items-start gap-1" data-e2e="api-token-details">
      <span class="flex flex-wrap items-center gap-2">
        <span translate={false}>{token.groupName}</span>
        <Badge
          text={t.t(
            token.access === ApiTokenAccess.WRITE ? `ApiTokens.readWrite` : `ApiTokens.readOnly`,
          )}
          color={token.access === ApiTokenAccess.WRITE ? "orange" : "gray"}
          type="outline"
        />
      </span>
      <span>
        {token.expiresAt
          ? (
            <Rich
              parts={t.parts(`ApiTokens.expires`, { date: format.date(token.expiresAt) })}
              tags={{ date: (text) => <time dateTime={token.expiresAt!}>{text}</time> }}
            />
          )
          : t.t(`ApiTokens.neverExpires`)}
      </span>
      <span>
        {token.lastUsedAt
          ? (
            <Rich
              parts={t.parts(`ApiTokens.lastUsed`, { when: `` })}
              tags={{ when: () => <When at={token.lastUsedAt!} /> }}
            />
          )
          : t.t(`ApiTokens.neverUsed`)}
      </span>
    </span>
  )
}
