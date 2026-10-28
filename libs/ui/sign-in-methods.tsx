import type { ComponentChildren, JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { DialogActions } from "@spy4x/preact-ui/dialog-actions"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { InlineEdit } from "@spy4x/preact-ui/inline-edit"
import { Input } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { Modal } from "@spy4x/preact-ui/modal"
import { OnDay, When } from "@spy4x/preact-ui/format"
import { TOUCH_TARGET } from "@spy4x/preact-ui/page-header"
import { SettingGroup, SettingList, SettingRow } from "@spy4x/preact-ui/setting-row"
import { OAUTH_PROVIDER_NAMES, type OAuthProviderId, type SignInMethod } from "@domain/identity"
import { profilePath, ScreenForm } from "./progressive.tsx"
import { type ProviderProof, ProviderProofNotice } from "./provider-proof.tsx"
import { Rich } from "@spy4x/preact-ui/i18n"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { type Said, say } from "./app-text.ts"
import { useAppText } from "./i18n.ts"

/** The message shown when linking or unlinking failed without a message of its own. */
export const SIGN_IN_METHODS_FAILURE = `SignInMethods.failed`

/** The message shown when the list could not be read without a reason of its own, as offline. */
export const SIGN_IN_METHODS_LOAD_FAILURE = `SignInMethods.loadFailed`

/** What the card says when a rename was refused or did not arrive. */
export const PASSKEY_RENAME_FAILURE = `SignInMethods.renameFailed`

/** What a method is called in the list. */
export function signInMethodName(t: Translator<string>, kind: SignInMethod["kind"]): string {
  if (kind === "password") return t.t(`SignInMethods.password`)
  if (kind === "passkey") return t.t(`SignInMethods.passkey`)
  return OAUTH_PROVIDER_NAMES[kind]
}

/** What a method is called in a sentence or a dialog: a passkey by the name it was given. */
function shownName(t: Translator<string>, method: SignInMethod): string {
  return method.passkey?.name ?? signInMethodName(t, method.kind)
}

/** Where each kind stands in the list (#222): the password, the passkeys, then the providers. */
const ORDER: Record<SignInMethod["kind"], number> = {
  password: 0,
  passkey: 1,
  google: 2,
  github: 3,
}

/** Where adding a passkey stands, for the button and the status line under the list. */
export type PasskeyAddStatus =
  | { kind: "waiting" }
  /** Closed or timed out on the device: nothing was added. */
  | { kind: "cancelled" }
  | { kind: "added"; keyId: number; name: string }

export interface SignInMethodsProps {
  /** The account's ways in; `null` while the list is not known yet. */
  methods: readonly SignInMethod[] | null
  /**
   * A sign-in link reaches the account (#391). It is no linked method, so the list never shows
   * it; an account with no other way in is told it signs in with a link.
   */
  emailLink?: boolean
  /** The providers that are on and not linked yet: each gets a "Link" button. */
  available: readonly OAuthProviderId[]
  /** A link or an unlink is in flight: every button waits. */
  pending: boolean
  /** Why a link or an unlink failed, as the server's words or a catalog key; shown and focused. */
  error: Said | null
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
  /**
   * Starts adding a passkey (#222): the app asks the server, then the device. `password` is what
   * the person typed, for an account that has one. Left out, or without `passkeysSupported`, there
   * is no "Add a passkey" button; existing passkeys stay listed and removable.
   */
  onAddPasskey?: (password?: string) => void
  /** This browser can make and use passkeys. */
  passkeysSupported?: boolean
  /** `false` while the device is offline: adding a passkey waits for a connection. */
  online?: boolean
  /** The last passkey add, for its button and its status line. */
  passkeyStatus?: PasskeyAddStatus | null
  /** Renames a passkey; a rejection keeps the field open with the typed name. */
  onRenamePasskey?: (methodId: number, name: string) => Promise<void>
  /**
   * The password's row: its action ("Change", or "Set" for an account without one), and the value
   * shown while the account has no password, which then gets a row of its own. Left out, the
   * password is listed like any method, without an action.
   */
  password?: { action: ComponentChildren; none: ComponentChildren }
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
    onAddPasskey,
    passkeysSupported = false,
    online = true,
    passkeyStatus = null,
    onRenamePasskey,
    password: passwordRow,
  }: SignInMethodsProps,
): JSX.Element {
  /** The method whose unlink dialog is open. */
  const [confirming, setConfirming] = useState<SignInMethod | null>(null)
  const t = useAppText()
  const errorText = error && say(t, error)
  /** The provider whose link dialog is open, or `passkey` for the dialog before a new passkey. */
  const [linking, setLinking] = useState<OAuthProviderId | "passkey" | null>(null)
  const canAddPasskey = passkeysSupported && onAddPasskey !== undefined
  const sorted = methods && [...methods].sort((a, b) => ORDER[a.kind] - ORDER[b.kind])
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
  const startLink = (provider: OAuthProviderId | "passkey") => {
    // A sign-in a moment ago is the proof already: nothing to ask.
    if (!providerProof?.fresh) setLinking(provider)
    else if (provider === "passkey") onAddPasskey?.()
    else onLink(provider)
  }
  const submitLink = () => {
    const typed = providerProof ? undefined : password
    if (linking === "passkey") onAddPasskey?.(typed)
    else if (linking) onLink(linking, typed)
  }
  // Signing in again from the open dialog takes away the button that had focus: "Continue",
  // which now finishes the step, takes it. The device asks for a fresh press, so nothing runs
  // on its own.
  const continueButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (providerProof?.fresh && linking !== null) continueButton.current?.focus()
  }, [providerProof?.fresh])
  // The device's dialog took over, or the add ended: the password dialog has done its job.
  const addButton = useRef<HTMLButtonElement>(null)
  const status = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (!passkeyStatus) return
    if (linking === "passkey") closeLink()
    // Cancelled: back to the button. Added: to the new passkey's name, to rename it.
    if (passkeyStatus.kind === "cancelled") addButton.current?.focus()
    if (passkeyStatus.kind === "added") {
      list.current?.querySelector<HTMLButtonElement>(
        `[data-e2e="passkey-name-${passkeyStatus.keyId}"] button`,
      )?.focus()
    }
  }, [passkeyStatus])
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

  const hasPassword = methods?.some((method) => method.kind === "password") ?? false
  return (
    <SettingGroup
      title={t.t(`SignInMethods.title`)}
      dataE2E="sign-in-methods"
    >
      <div ref={message} tabIndex={-1} data-e2e="sign-in-methods-error">
        <ErrorState message={errorText} />
      </div>
      {loadError !== null && (
        // A failed read is not a failed change: it says the list could not be read and offers a
        // retry. While the retry runs the message and the button stay, so focus stays on it.
        <div class="flex flex-col items-start gap-3" data-e2e="sign-in-methods-load-error">
          <ErrorState message={loadError || t.t(SIGN_IN_METHODS_LOAD_FAILURE)} />
          <Button
            type="button"
            variant="secondary"
            class={TOUCH_TARGET}
            busy={loading}
            busyLabel={t.t(`SignInMethods.reloading`)}
            onClick={onRetry}
            data-e2e="sign-in-methods-retry"
          >
            {t.t(`EmailScreen.tryAgain`)}
          </Button>
        </div>
      )}
      {methods === null
        ? loadError === null && <p class="text-sm text-muted">{t.t(`SignInMethods.loading`)}</p>
        : (
          <div ref={list} tabIndex={-1} data-e2e="sign-in-methods-list">
            <SettingList>
              {passwordRow && !hasPassword && (
                <SettingRow
                  dataE2E="sign-in-method-password"
                  label={t.t(`SignInMethods.password`)}
                  value={passwordRow.none}
                  action={passwordRow.action}
                />
              )}
              {(sorted ?? []).map((method) => (
                <SettingRow
                  key={method.id}
                  dataE2E={`sign-in-method-${method.kind}`}
                  label={signInMethodName(t, method.kind)}
                  value={
                    <MethodDetails
                      method={method}
                      only={methods.length === 1}
                      pending={pending}
                      onRename={onRenamePasskey}
                    />
                  }
                  action={method.kind === "password" && passwordRow
                    ? passwordRow.action
                    : method.canUnlink && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        class={TOUCH_TARGET}
                        data-e2e={method.kind === "passkey"
                          ? `sign-in-method-remove-passkey-${method.id}`
                          : `sign-in-method-unlink-${method.kind}`}
                        disabled={pending}
                        onClick={() => setConfirming(method)}
                      >
                        <Rich
                          parts={t.parts(
                            method.kind === "passkey"
                              ? `SignInMethods.removeNamed`
                              : `SignInMethods.unlinkNamed`,
                            { name: shownName(t, method) },
                          )}
                          tags={{ name: (text) => <span class="sr-only">{text}</span> }}
                        />
                      </Button>
                    )}
                />
              ))}
            </SettingList>
          </div>
        )}
      {(available.length > 0 || canAddPasskey) && (
        <div class="flex flex-col items-start gap-3">
          <div class="flex flex-wrap gap-3">
            {canAddPasskey && (
              <Button
                ref={addButton}
                type="button"
                variant="secondary"
                data-e2e="sign-in-method-add-passkey"
                disabled={pending || !online}
                busy={passkeyStatus?.kind === "waiting"}
                busyLabel={t.t(`AuthScreen.waitingDevice`)}
                onClick={() => startLink("passkey")}
              >
                {t.t(`SignInMethods.addPasskey`)}
              </Button>
            )}
            {available.map((provider) => (
              <Button
                key={provider}
                type="button"
                variant="secondary"
                data-e2e={`sign-in-method-link-${provider}`}
                disabled={pending}
                onClick={() => startLink(provider)}
              >
                {t.t(`SignInMethods.link`, { provider: OAUTH_PROVIDER_NAMES[provider] })}
              </Button>
            ))}
          </div>
          {canAddPasskey && !online && (
            <p class="text-sm text-muted" data-e2e="passkey-offline">
              {t.t(`SignInMethods.offline`)}
            </p>
          )}
        </div>
      )}
      <p ref={status} role="status" class="text-sm empty:hidden" data-e2e="passkey-status">
        {passkeyStatus?.kind === "cancelled" && t.t(`SignInMethods.cancelled`)}
        {passkeyStatus?.kind === "added" && (
          <Rich
            parts={t.parts(`SignInMethods.added`, { name: passkeyStatus.name })}
            tags={{ name: (text) => <bdi translate={false}>{text}</bdi> }}
          />
        )}
      </p>

      <Modal
        open={linking !== null}
        onClose={closeLink}
        title={linking === "passkey"
          ? t.t(`SignInMethods.addPasskey`)
          : linking
          ? t.t(`SignInMethods.link`, { provider: OAUTH_PROVIDER_NAMES[linking] })
          : t.t(`SignInMethods.linkTitle`)}
        cancelLabel={t.t(`EmailScreen.close`)}
        dataE2E="sign-in-method-link-dialog"
      >
        {providerProof && !providerProof.fresh
          ? (
            <Stack>
              <ProviderProofNotice proof={providerProof} next={profilePath("security")} />
              <DialogActions>
                <Button type="button" variant="ghost" onClick={closeLink}>
                  {t.t(`EmailScreen.close`)}
                </Button>
              </DialogActions>
            </Stack>
          )
          : (
            <ScreenForm
              pending={pending}
              onSubmit={submitLink}
            >
              <Stack>
                {providerProof
                  // Signed in again a moment ago, from this dialog: the proof is that sign-in.
                  ? <ProviderProofNotice proof={providerProof} next={profilePath("security")} />
                  : (
                    <>
                      <p class="text-sm text-muted">
                        {t.t(
                          linking === "passkey"
                            ? `SignInMethods.passkeyAsks`
                            : `SignInMethods.linkAsks`,
                        )}
                      </p>
                      <Field
                        id="sign-in-method-link-password"
                        label={t.t(`SignInMethods.password`)}
                        required
                      >
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
                    </>
                  )}
                <ErrorState message={errorText} />
                <DialogActions>
                  <Button type="button" variant="ghost" onClick={closeLink}>
                    {t.t(`EmailScreen.cancel`)}
                  </Button>
                  <Button
                    ref={continueButton}
                    type="submit"
                    data-e2e="sign-in-method-link-submit"
                    busy={pending}
                    busyLabel={t.t(
                      linking === "passkey" ? `AuthScreen.waitingDevice` : `SignInMethods.opening`,
                    )}
                  >
                    {linking && linking !== "passkey"
                      ? t.t(`SignInMethods.continueTo`, {
                        provider: OAUTH_PROVIDER_NAMES[linking],
                      })
                      : t.t(`AuthScreen.continue`)}
                  </Button>
                </DialogActions>
              </Stack>
            </ScreenForm>
          )}
      </Modal>

      {confirming !== null && (
        <Modal
          open
          onClose={closeUnlink}
          title={confirming.kind === "passkey"
            ? t.t(`SignInMethods.removeTitle`, { name: shownName(t, confirming) })
            : t.t(`SignInMethods.unlinkTitle`, { name: signInMethodName(t, confirming.kind) })}
          cancelLabel={t.t(`EmailScreen.close`)}
          tone="danger"
          dataE2E="sign-in-method-unlink-confirm"
        >
          <Stack>
            <p class="text-sm text-muted">
              {t.t(
                confirming.kind === "passkey"
                  ? confirming.current ? `SignInMethods.removeCurrent` : `SignInMethods.remove`
                  : confirming.current
                  ? `SignInMethods.unlinkCurrent`
                  : `SignInMethods.unlink`,
                { name: signInMethodName(t, confirming.kind) },
              )}
            </p>
            {providerProof && !providerProof.fresh
              ? (
                <>
                  <ProviderProofNotice proof={providerProof} next={profilePath("security")} />
                  <DialogActions>
                    <Button type="button" variant="ghost" onClick={closeUnlink}>
                      {t.t(`EmailScreen.close`)}
                    </Button>
                  </DialogActions>
                </>
              )
              : (
                <ScreenForm
                  pending={pending}
                  onSubmit={() => onUnlink(confirming.id, providerProof ? undefined : password)}
                >
                  <Stack>
                    {!providerProof && (
                      <Field
                        id="sign-in-method-unlink-password"
                        label={t.t(`SignInMethods.password`)}
                        required
                      >
                        <Input
                          ref={passwordInput}
                          data-e2e="sign-in-method-unlink-password"
                          name="password"
                          type="password"
                          autocomplete="current-password"
                          value={password}
                          onInput={(e) => setPassword(e.currentTarget.value)}
                          required
                        />
                      </Field>
                    )}
                    <ErrorState message={errorText} />
                    <DialogActions>
                      <Button type="button" variant="ghost" onClick={closeUnlink}>
                        {t.t(`EmailScreen.cancel`)}
                      </Button>
                      <Button
                        type="submit"
                        variant="danger"
                        data-e2e="sign-in-method-unlink-submit"
                        busy={pending}
                        busyLabel={t.t(
                          confirming.kind === "passkey"
                            ? `SignInMethods.removing`
                            : `SignInMethods.unlinking`,
                        )}
                      >
                        {t.t(
                          confirming.kind === "passkey"
                            ? `SignInMethods.removePasskey`
                            : `SignInMethods.unlinkButton`,
                        )}
                      </Button>
                    </DialogActions>
                  </Stack>
                </ScreenForm>
              )}
          </Stack>
        </Modal>
      )}
    </SettingGroup>
  )
}

/**
 * The method's address, or a passkey's name (renamed in place) and dates; whether this device
 * used it; and why the only one has no "Unlink" or "Remove".
 */
function MethodDetails(
  { method, only, pending, onRename }: {
    method: SignInMethod
    only: boolean
    pending: boolean
    onRename?: (methodId: number, name: string) => Promise<void>
  },
): JSX.Element {
  const { passkey } = method
  const t = useAppText()
  return (
    <span class="flex flex-col items-start gap-1">
      {passkey && (
        <>
          {onRename
            ? (
              // The control cuts a long name off on a narrow screen; the title shows it in full.
              <span title={passkey.name} class="max-w-full min-w-0" data-e2e="passkey-full-name">
                <InlineEdit
                  value={passkey.name}
                  onSave={(name) => onRename(method.id, name)}
                  editLabel={(name) => t.t(`SignInMethods.rename`, { name })}
                  inputLabel={t.t(`SignInMethods.passkeyName`)}
                  errorMessage={() => t.t(PASSKEY_RENAME_FAILURE)}
                  disabled={pending}
                  dataE2E={`passkey-name-${method.id}`}
                  // The button's own padding would push the name off the line under it.
                  class="-ml-2 font-medium text-foreground"
                />
              </span>
            )
            : (
              <span class="font-medium break-words text-foreground" translate={false}>
                {passkey.name}
              </span>
            )}
          <span data-e2e="passkey-dates">
            <Rich
              parts={t.parts(
                passkey.lastUsedAt ? `SignInMethods.addedUsed` : `SignInMethods.addedUnused`,
              )}
              tags={{
                added: () => <OnDay at={passkey.createdAt} />,
                used: () => passkey.lastUsedAt && <When at={passkey.lastUsedAt} />,
              }}
            />
          </span>
        </>
      )}
      {method.email && <span data-e2e="sign-in-method-email" translate={false}>{method.email}
      </span>}
      {method.current && (
        <Badge
          text={t.t(`SignInMethods.usedHere`)}
          color="green"
          type="outline"
        />
      )}
      {only && method.kind !== "password" && (
        <span>
          {t.t(
            method.kind === "passkey" ? `SignInMethods.onlyPasskey` : `SignInMethods.onlyLinked`,
          )}
        </span>
      )}
    </span>
  )
}
