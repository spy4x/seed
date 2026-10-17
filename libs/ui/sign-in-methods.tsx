import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Cluster, Stack } from "@spy4x/preact-ui/layout"
import { Modal } from "@spy4x/preact-ui/modal"
import { TOUCH_TARGET } from "@spy4x/preact-ui/page-header"
import { SettingGroup, SettingList, SettingRow } from "@spy4x/preact-ui/setting-row"
import { OAUTH_PROVIDER_NAMES, type OAuthProviderId, type SignInMethod } from "@domain/identity"
import { SCREEN_PATHS, ScreenForm } from "./progressive.tsx"
import { type ProviderProof, ProviderProofNotice } from "./provider-proof.tsx"

/** The message shown when linking or unlinking failed without a message of its own. */
export const SIGN_IN_METHODS_FAILURE = "Changing your sign-in methods failed"

/** The message shown when the list could not be read without a reason of its own, as offline. */
export const SIGN_IN_METHODS_LOAD_FAILURE =
  "Your sign-in methods could not be loaded. Check your connection and try again."

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
  /** Why a link or an unlink failed; shown above the list, and focused. */
  error: string | null
  /**
   * Why the list could not be read, or `null`; empty for a read that failed without a reason, as
   * offline, which shows {@link SIGN_IN_METHODS_LOAD_FAILURE}. Shown with "Try again".
   */
  loadError?: string | null
  /** The list is being read: "Try again" waits, and keeps focus. */
  loading?: boolean
  /** Reads the list again, from "Try again" after a failed read. */
  onRetry?: () => void
  /**
   * What an account with no password confirms a link or an unlink with; `null` or absent for an
   * account that has a password, which types it instead.
   */
  providerProof?: ProviderProof | null
  /**
   * Starts linking `provider`: the app sends the browser to it. `password` is what the person
   * typed, for an account that has one.
   */
  onLink: (provider: OAuthProviderId, password?: string) => void
  /**
   * Unlinks the method with this id, after the person confirmed. `password` is what the person
   * typed, for an account that has one.
   */
  onUnlink: (methodId: number, password?: string) => void
}

/**
 * The ways into the account: the password and each linked provider, with "Unlink" on a provider
 * while another way in remains, and "Link" for each provider not linked yet. Linking adds a way in
 * and unlinking takes one away, so each asks in a dialog for what a deletion asks: the password,
 * or for an account without one a sign-in with a provider a moment ago. The unlink dialog also
 * says which devices it signs out, and stays open until the method has left the list, so a
 * refused password is fixed in its field.
 */
export function SignInMethods(
  {
    methods,
    available,
    pending,
    error,
    loadError = null,
    loading = false,
    onRetry,
    providerProof = null,
    onLink,
    onUnlink,
  }: SignInMethodsProps,
): JSX.Element {
  /** The method whose unlink dialog is open. */
  const [confirming, setConfirming] = useState<SignInMethod | null>(null)
  /** The provider whose link dialog is open. */
  const [linking, setLinking] = useState<OAuthProviderId | null>(null)
  // Typed here and handed to `onLink` or `onUnlink` once: the password is kept nowhere else.
  const [password, setPassword] = useState("")
  const passwordInput = useRef<HTMLInputElement>(null)
  const message = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!error) return
    // A dialog is over the list: a refused password is fixed in its field, any other refusal is
    // read in the dialog.
    if ((linking !== null || confirming !== null) && passwordInput.current) {
      passwordInput.current.focus()
    } else if (confirming === null) message.current?.focus()
  }, [error])
  const closeLink = () => {
    setLinking(null)
    setPassword("")
  }
  const closeUnlink = () => {
    setConfirming(null)
    setPassword("")
  }
  const startLink = (provider: OAuthProviderId) => {
    // A sign-in a moment ago is the proof already: nothing to ask.
    if (providerProof?.fresh) onLink(provider)
    else setLinking(provider)
  }
  // The "Unlink" button that had focus goes away with its row: the list takes focus, so the
  // keyboard and a screen reader stay where the change happened. The unlink dialog closes once its
  // method has gone, and the list takes focus after it, since the dialog keeps it while open.
  const list = useRef<HTMLDivElement>(null)
  const shown = useRef<readonly number[]>([])
  const focusListAfterDialog = useRef(false)
  useEffect(() => {
    const ids = methods?.map((method) => method.id) ?? []
    const gone = shown.current.some((id) => !ids.includes(id))
    shown.current = ids
    if (!gone) return
    if (confirming !== null && !ids.includes(confirming.id)) {
      focusListAfterDialog.current = true
      closeUnlink()
    } else list.current?.focus()
  }, [methods])
  useEffect(() => {
    if (confirming !== null || !focusListAfterDialog.current) return
    focusListAfterDialog.current = false
    list.current?.focus()
  }, [confirming])

  return (
    <SettingGroup
      title="Sign-in methods"
      description="The ways you can sign in to this account."
      dataE2E="sign-in-methods"
    >
      <div ref={message} tabIndex={-1} data-e2e="sign-in-methods-error">
        <ErrorState message={error} />
      </div>
      {loadError !== null && (
        // A failed read is not a failed change: it says the list could not be read and offers a
        // retry. While the retry runs the message and the button stay, so focus stays on it.
        <div class="flex flex-col items-start gap-3" data-e2e="sign-in-methods-load-error">
          <ErrorState message={loadError || SIGN_IN_METHODS_LOAD_FAILURE} />
          <Button
            type="button"
            variant="secondary"
            class={TOUCH_TARGET}
            busy={loading}
            busyLabel="Loading sign-in methods…"
            onClick={onRetry}
            data-e2e="sign-in-methods-retry"
          >
            Try again
          </Button>
        </div>
      )}
      {methods === null
        ? loadError === null && <p class="text-sm text-muted">Loading your sign-in methods…</p>
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
                onClick={() => startLink(provider)}
              >
                Link {OAUTH_PROVIDER_NAMES[provider]}
              </Button>
            ))}
          </div>
        </div>
      )}

      <Modal
        open={linking !== null}
        onClose={closeLink}
        title={linking ? `Link ${OAUTH_PROVIDER_NAMES[linking]}` : "Link"}
        cancelLabel="Close"
        dataE2E="sign-in-method-link-dialog"
      >
        {providerProof
          ? (
            <Stack>
              <ProviderProofNotice proof={providerProof} next={SCREEN_PATHS.profile} />
              <Cluster justify="end">
                <Button type="button" variant="ghost" onClick={closeLink}>Close</Button>
              </Cluster>
            </Stack>
          )
          : (
            <ScreenForm
              pending={pending}
              onSubmit={() => {
                if (linking) onLink(linking, password)
              }}
            >
              <Stack>
                <p class="text-sm text-muted">
                  A linked account is another way to sign in, so your password is asked first.
                </p>
                <Field id="sign-in-method-link-password" label="Password" required>
                  <Input
                    ref={passwordInput}
                    data-e2e="sign-in-method-link-password"
                    name="password"
                    type="password"
                    autocomplete="current-password"
                    value={password}
                    onInput={(e) => setPassword(e.currentTarget.value)}
                    required
                  />
                </Field>
                <ErrorState message={error} />
                <Cluster justify="end">
                  <Button type="button" variant="ghost" onClick={closeLink}>Cancel</Button>
                  <Button
                    type="submit"
                    data-e2e="sign-in-method-link-submit"
                    busy={pending}
                    busyLabel="Opening…"
                  >
                    Continue{linking ? ` to ${OAUTH_PROVIDER_NAMES[linking]}` : ""}
                  </Button>
                </Cluster>
              </Stack>
            </ScreenForm>
          )}
      </Modal>

      {confirming !== null && (
        <Modal
          open
          onClose={closeUnlink}
          title={`Unlink ${signInMethodName(confirming.kind)}?`}
          cancelLabel="Close"
          tone="danger"
          dataE2E="sign-in-method-unlink-confirm"
        >
          <Stack>
            <p class="text-sm text-muted">
              {confirming.current
                ? `You signed in on this device with ${
                  signInMethodName(confirming.kind)
                }, so it will be signed out, like every other device that did.`
                : `Every device that signed in with ${
                  signInMethodName(confirming.kind)
                } will be signed out. This device stays signed in.`}
            </p>
            {providerProof && !providerProof.fresh
              ? (
                <>
                  <ProviderProofNotice proof={providerProof} next={SCREEN_PATHS.profile} />
                  <Cluster justify="end">
                    <Button type="button" variant="ghost" onClick={closeUnlink}>Close</Button>
                  </Cluster>
                </>
              )
              : (
                <ScreenForm
                  pending={pending}
                  onSubmit={() => onUnlink(confirming.id, providerProof ? undefined : password)}
                >
                  <Stack>
                    {!providerProof && (
                      <Field id="sign-in-method-unlink-password" label="Password" required>
                        <Input
                          ref={passwordInput}
                          data-e2e="sign-in-method-unlink-password"
                          name="password"
                          type="password"
                          autocomplete="current-password"
                          value={password}
                          onInput={(e) =>
                            setPassword(e.currentTarget.value)}
                          required
                        />
                      </Field>
                    )}
                    <ErrorState message={error} />
                    <Cluster justify="end">
                      <Button type="button" variant="ghost" onClick={closeUnlink}>Cancel</Button>
                      <Button
                        type="submit"
                        variant="danger"
                        data-e2e="sign-in-method-unlink-submit"
                        busy={pending}
                        busyLabel="Unlinking…"
                      >
                        Unlink
                      </Button>
                    </Cluster>
                  </Stack>
                </ScreenForm>
              )}
          </Stack>
        </Modal>
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
