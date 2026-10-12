import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { TOUCH_TARGET } from "@spy4x/preact-ui/page-header"
import { SettingGroup, SettingList, SettingRow } from "@spy4x/preact-ui/setting-row"
import { OAUTH_PROVIDER_NAMES, type OAuthProviderId, type SignInMethod } from "@domain/identity"

/** The message shown when linking or unlinking failed without a message of its own. */
export const SIGN_IN_METHODS_FAILURE = "Changing your sign-in methods failed"

/** What a method is called in the list. */
export function signInMethodName(kind: SignInMethod["kind"]): string {
  return kind === "password" ? "Password" : OAUTH_PROVIDER_NAMES[kind]
}

export interface SignInMethodsProps {
  /** The account's ways in; `null` while the list is not known yet. */
  methods: readonly SignInMethod[] | null
  /** The providers that are on and not linked yet: each gets a "Link" button. */
  available: readonly OAuthProviderId[]
  /** A link or an unlink is in flight: every button waits. */
  pending: boolean
  /** Why the list could not be read or a change failed; shown above the list, and focused. */
  error: string | null
  /** Starts linking `provider`: the app sends the browser to it. */
  onLink: (provider: OAuthProviderId) => void
  /** Unlinks the method with this id, after the person confirmed. */
  onUnlink: (methodId: number) => void
}

/**
 * The ways into the account: the password and each linked provider, with "Unlink" on a provider
 * while another way in remains, and "Link" for each provider not linked yet. Unlinking asks first,
 * since it signs out every device that signed in with that provider.
 */
export function SignInMethods(
  { methods, available, pending, error, onLink, onUnlink }: SignInMethodsProps,
): JSX.Element {
  const [confirming, setConfirming] = useState<SignInMethod | null>(null)
  const message = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (error) message.current?.focus()
  }, [error])
  // The "Unlink" button that had focus goes away with its row: the list takes focus, so the
  // keyboard and a screen reader stay where the change happened.
  const list = useRef<HTMLDivElement>(null)
  const shown = useRef<readonly number[]>([])
  useEffect(() => {
    const ids = methods?.map((method) => method.id) ?? []
    if (shown.current.some((id) => !ids.includes(id))) list.current?.focus()
    shown.current = ids
  }, [methods])

  return (
    <SettingGroup
      title="Sign-in methods"
      description="The ways you can sign in to this account."
      dataE2E="sign-in-methods"
    >
      <div ref={message} tabIndex={-1} data-e2e="sign-in-methods-error">
        <ErrorState message={error} />
      </div>
      {methods === null
        ? <p class="text-sm text-muted">Loading your sign-in methods…</p>
        : (
          <div ref={list} tabIndex={-1} data-e2e="sign-in-methods-list">
            <SettingList>
              {methods.map((method) => (
                <SettingRow
                  key={method.id}
                  dataE2E={`sign-in-method-${method.kind}`}
                  label={signInMethodName(method.kind)}
                  value={<MethodDetails method={method} only={methods.length === 1} />}
                  action={method.canUnlink && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      class={TOUCH_TARGET}
                      data-e2e={`sign-in-method-unlink-${method.kind}`}
                      disabled={pending}
                      onClick={() => setConfirming(method)}
                    >
                      Unlink <span class="sr-only">{signInMethodName(method.kind)}</span>
                    </Button>
                  )}
                />
              ))}
            </SettingList>
          </div>
        )}
      {available.length > 0 && (
        <div class="flex flex-col items-start gap-3">
          <div class="flex flex-wrap gap-3">
            {available.map((provider) => (
              <Button
                key={provider}
                type="button"
                variant="secondary"
                data-e2e={`sign-in-method-link-${provider}`}
                disabled={pending}
                onClick={() => onLink(provider)}
              >
                Link {OAUTH_PROVIDER_NAMES[provider]}
              </Button>
            ))}
          </div>
        </div>
      )}

      {confirming !== null && (
        <ConfirmDialog
          title={`Unlink ${signInMethodName(confirming.kind)}?`}
          message={confirming.current
            ? `You signed in on this device with ${
              signInMethodName(confirming.kind)
            }, so it will be signed out, like every other device that did.`
            : `Every device that signed in with ${
              signInMethodName(confirming.kind)
            } will be signed out. This device stays signed in.`}
          confirmLabel="Unlink"
          cancelLabel="Cancel"
          tone="danger"
          dataE2E="sign-in-method-unlink-confirm"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null)
            onUnlink(confirming.id)
          }}
        />
      )}
    </SettingGroup>
  )
}

/** The method's address, whether this device used it, and why the only one has no "Unlink". */
function MethodDetails(
  { method, only }: { method: SignInMethod; only: boolean },
): JSX.Element {
  return (
    <span class="flex flex-col items-start gap-1">
      {method.email && <span data-e2e="sign-in-method-email">{method.email}</span>}
      {method.current && <Badge text="Used on this device" color="green" type="outline" />}
      {only && method.kind !== "password" && (
        <span>Your only way to sign in, so it cannot be unlinked.</span>
      )}
    </span>
  )
}
