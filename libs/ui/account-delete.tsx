// deno-lint-ignore-file ui-text/no-literal
import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { DialogActions } from "@spy4x/preact-ui/dialog-actions"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Link } from "@spy4x/preact-ui/link"
import { Stack } from "@spy4x/preact-ui/layout"
import { Modal } from "@spy4x/preact-ui/modal"
import {
  ACCOUNT_DELETION_GRACE_DAYS,
  type AccountDeletionBlocker,
  AccountDeletionBlockReason,
  DELETED_USER_NAME,
} from "@domain/identity"
import { TOUCH_TARGET } from "@spy4x/preact-ui/page-header"
import { GROUP_PATHS, type Navigate, profilePath, ScreenForm } from "./progressive.tsx"
import { DATA_EXPORT_ANCHOR } from "./profile-export.tsx"
import { type ProviderProof, ProviderProofNotice } from "./provider-proof.tsx"
import { SettingRow } from "@spy4x/preact-ui/setting-row"
import { useFormat } from "@spy4x/preact-ui/format"
import type { Formatters } from "@spy4x/time/format"

/** What the person has typed into the deletion dialog. */
export interface AccountDeleteValues {
  password: string
  otp: string
}

/** The deletion dialog's errors: one per field, tied to it, and one that names no field. */
export interface AccountDeleteErrors {
  password?: string | null
  otp?: string | null
  form: string | null
}

/**
 * What a blocker asks the person to do, shown under the group's name. A date is written in the
 * person's own format.
 */
export function blockerHint(
  blocker: AccountDeletionBlocker,
  format: Pick<Formatters, "date">,
): string {
  switch (blocker.reason) {
    case AccountDeletionBlockReason.Members:
      return "Other people still use it. Hand it over or remove them."
    case AccountDeletionBlockReason.Subscription:
      return "Its plan is still paid. Cancel the plan first."
    case AccountDeletionBlockReason.PlanEnding: {
      const day = blocker.endsAt ? format.date(blocker.endsAt, "long") : "the end of its period"
      return `Its plan is cancelled and runs until ${day}. Wait until the plan ends.`
    }
  }
}

export interface AccountDeleteProps {
  /** Two-factor sign-in is on: the dialog asks for a code as well as the password. */
  twoFactor: boolean
  /**
   * The groups that stop the deletion, as the API listed them, or `null` while they are not known.
   * The dialog shows either this list or the form, never both.
   */
  blockers: readonly AccountDeletionBlocker[] | null
  values: AccountDeleteValues
  onValueChange: (field: keyof AccountDeleteValues, value: string) => void
  /** Focus moves to the first field with a message each time the app passes a new object. */
  errors: AccountDeleteErrors
  pending: boolean
  /** The dialog opened: the app reads the blockers again. */
  onOpen?: () => void
  /** The person closed the dialog: the app drops what was typed and its errors. */
  onCancel?: () => void
  onDelete?: () => void
  /**
   * Set for an account with no password: the dialog asks for no password, and confirms with a
   * provider sign-in a moment ago instead. Until there is one it shows the way to it and no form.
   */
  providerProof?: ProviderProof | null
  navigate?: Navigate
}

/**
 * The profile's "Delete account" section: a danger-coloured card with one row, "Delete my
 * account". Its dialog lists the groups that stop the deletion, with a link to each, or asks for
 * the password (and the one-time code when two-factor is on) and says what happens next. An
 * account with no password signs in with its provider again in place of the password.
 */
export function AccountDelete(
  {
    twoFactor,
    blockers,
    values,
    onValueChange,
    errors,
    pending,
    onOpen,
    onCancel,
    onDelete,
    providerProof,
    navigate,
  }: AccountDeleteProps,
): JSX.Element {
  const [open, setOpen] = useState(false)
  const password = useRef<HTMLInputElement>(null)
  const otp = useRef<HTMLInputElement>(null)
  const close = () => {
    setOpen(false)
    onCancel?.()
  }

  // A refused submit lands the person on the field to fix.
  useEffect(() => {
    if (errors.password) password.current?.focus()
    else if (errors.otp) otp.current?.focus()
  }, [errors])

  return (
    // The profile's last section, on a page of its own, in a danger-coloured card. The row sits
    // straight in the card: a `SettingList` here would be a card inside a card.
    <div data-e2e="danger-zone" class="pc-card border-danger">
      <dl>
        <SettingRow
          label="Delete my account"
          value={
            <span class="flex flex-col gap-1">
              <span>
                {`Your account and the groups only you use go for good ${ACCOUNT_DELETION_GRACE_DAYS} days after you ask. Signing in before then keeps them.`}
              </span>
              <span>
                Want a copy first?{" "}
                <Link
                  href={`${profilePath("account")}#${DATA_EXPORT_ANCHOR}`}
                  navigate={navigate}
                  class="pc-link"
                  data-e2e="account-delete-export-link"
                >
                  Download your data
                </Link>.
              </span>
            </span>
          }
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              class={`${TOUCH_TARGET} text-danger`}
              data-e2e="account-delete-open"
              onClick={() => {
                setOpen(true)
                onOpen?.()
              }}
            >
              Delete <span class="sr-only">my account</span>
            </Button>
          }
        />
      </dl>

      <Modal
        open={open}
        onClose={close}
        title="Delete my account"
        cancelLabel="Close"
        tone="danger"
        dataE2E="account-delete-dialog"
      >
        {blockers === null
          ? <p class="text-sm text-muted" role="status">Checking your groups…</p>
          : blockers.length > 0
          ? <BlockerList blockers={blockers} navigate={navigate} onClose={close} />
          : providerProof && !providerProof.fresh
          ? (
            <Stack>
              <ProviderProofNotice proof={providerProof} next={profilePath("danger-zone")} />
              <DialogActions>
                <Button type="button" variant="ghost" onClick={close}>Close</Button>
              </DialogActions>
            </Stack>
          )
          : (
            <ScreenForm pending={pending} onSubmit={onDelete}>
              <Stack>
                <p class="text-sm text-muted">
                  You are signed out on every device at once. Your account and the groups only you
                  use are deleted for good in {ACCOUNT_DELETION_GRACE_DAYS}{" "}
                  days; sign in before then and your account is restored. Notes you wrote in other
                  people's groups stay there, by "{DELETED_USER_NAME}".
                </p>
                {providerProof
                  ? <ProviderProofNotice proof={providerProof} next={profilePath("danger-zone")} />
                  : (
                    <Field
                      id="account-delete-password"
                      label="Password"
                      error={errors.password}
                      required
                    >
                      <Input
                        ref={password}
                        data-e2e="account-delete-password"
                        name="password"
                        type="password"
                        autocomplete="current-password"
                        value={values.password}
                        onInput={(e) => onValueChange("password", e.currentTarget.value)}
                        required
                      />
                    </Field>
                  )}
                {twoFactor && (
                  <Field
                    id="account-delete-otp"
                    label="Code from your authenticator app"
                    error={errors.otp}
                    required
                  >
                    <Input
                      ref={otp}
                      data-e2e="account-delete-otp"
                      name="otp"
                      inputMode="numeric"
                      autocomplete="one-time-code"
                      value={values.otp}
                      onInput={(e) => onValueChange("otp", e.currentTarget.value)}
                      required
                    />
                  </Field>
                )}
                <ErrorState message={errors.form} />
                <DialogActions>
                  <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
                  <Button
                    type="submit"
                    variant="danger"
                    data-e2e="account-delete-submit"
                    busy={pending}
                    busyLabel="Deleting…"
                  >
                    Delete my account
                  </Button>
                </DialogActions>
              </Stack>
            </ScreenForm>
          )}
      </Modal>
    </div>
  )
}

/** The groups that stop the deletion, each a link to its settings, and what each one needs. */
function BlockerList(
  { blockers, navigate, onClose }: {
    blockers: readonly AccountDeletionBlocker[]
    navigate?: Navigate
    onClose: () => void
  },
): JSX.Element {
  const format = useFormat()
  return (
    <Stack>
      <p class="text-sm text-muted">
        You own groups other people still use or pay for. Deal with each one first, then come back.
      </p>
      <ul class="flex flex-col gap-3" data-e2e="account-delete-blockers">
        {blockers.map((blocker) => (
          <li key={blocker.groupId} class="flex flex-col gap-1">
            <Link
              href={blocker.reason === AccountDeletionBlockReason.Members
                ? GROUP_PATHS.members(blocker.groupId)
                : GROUP_PATHS.billing(blocker.groupId)}
              navigate={navigate}
              class="pc-link inline-flex min-h-11 items-center self-start font-medium wrap-anywhere sm:min-h-9"
              data-e2e={`account-delete-blocker-${blocker.groupId}`}
            >
              {blocker.name}
            </Link>
            <span class="text-sm text-muted">{blockerHint(blocker, format)}</span>
          </li>
        ))}
      </ul>
      <DialogActions>
        <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
      </DialogActions>
    </Stack>
  )
}
