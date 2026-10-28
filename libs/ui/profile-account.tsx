import type { ComponentChildren, JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { DialogActions } from "@spy4x/preact-ui/dialog-actions"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Cluster, Stack } from "@spy4x/preact-ui/layout"
import { Modal } from "@spy4x/preact-ui/modal"
import { TOUCH_TARGET } from "@spy4x/preact-ui/page-header"
import { SettingList, SettingRow } from "@spy4x/preact-ui/setting-row"
import { useSucceeded } from "@spy4x/preact-ui/use-succeeded"
import { type EmailStatus, emailToVerify } from "@domain/identity"
import {
  type EmailChangeProps,
  EmailDialog,
  EmailState,
  type EmailStep,
  EmailUnavailable,
} from "./email-screen.tsx"
import { profilePath, ScreenForm } from "./progressive.tsx"
import type { ProviderProof } from "./provider-proof.tsx"
import { DataExportErrorState, DataExportRow, type DataExportRowProps } from "./profile-export.tsx"
import { PictureErrorState, PictureRow, type PictureRowProps } from "./profile-picture.tsx"
import { Rich } from "@spy4x/preact-ui/i18n"
import { useAppText } from "./i18n.ts"

/** What the name dialog shows: the typed names, their errors and whether a save is in flight. */
export interface NameEditProps {
  firstName: string
  lastName: string
  onValueChange: (field: "firstName" | "lastName", value: string) => void
  /**
   * Each field's message, tied to it. Focus moves to the first field with a message each time the
   * app passes a new object.
   */
  fieldErrors: { firstName?: string | null; lastName?: string | null }
  /** A refusal that names no field, under the form. */
  error: string | null
  pending: boolean
  onSave?: () => void
  /** Drops what was typed and its errors, when the person closes the dialog. */
  onCancel?: () => void
}

/** What {@link AccountSection} takes. */
export interface AccountSectionProps {
  /** The saved name, shown on the row. */
  name: string
  nameEdit: NameEditProps
  /** The person's e-mail address and whether it is proven, or `null` while it is not known. */
  email: EmailStatus | null
  /**
   * The ways in of an account with no password, for a missing address: "Google", or `""` for an
   * account that signs in with a passkey only; `null` for an account with a password.
   */
  providerOnly: string | null
  /** The e-mail dialog's state and calls. Without it the address has no button. */
  emailChange?: EmailChangeProps
  /** Opens the e-mail dialog at its code on the first render, while an address waits for one. */
  openEmailCode?: boolean
  /**
   * Given only when the address could not be read: the row gives way to the failure and a way to
   * read it again.
   */
  onRetryEmail?: () => void
  /** What an account with no password confirms an address change with. */
  providerProof?: ProviderProof | null
  /**
   * A guest's account type row (#224), drawn first. With it the e-mail row is left out: a guest
   * adds an address on `/keep`, which that row leads to.
   */
  guestRow?: ComponentChildren
  /** The "Your data" row (#229). Without it the section has none. */
  dataExport?: DataExportRowProps
  /** The "Profile picture" row (#228), above the name. Without it the section has none. */
  picture?: PictureRowProps
}

/**
 * The profile's Account section: the profile picture (#228), the name, edited in a dialog, the e-mail address, changed in
 * one dialog that asks for the new address and the password, then for the code mailed there. While
 * an address waits for its code the row offers "Enter code" too, which opens the same dialog at the
 * code. Last, "Your data": a copy of everything the app keeps about the person (#229).
 */
export function AccountSection(
  {
    name,
    nameEdit,
    email,
    providerOnly,
    emailChange,
    openEmailCode,
    onRetryEmail,
    providerProof,
    guestRow,
    dataExport,
    picture,
  }: AccountSectionProps,
): JSX.Element {
  const [editingName, setEditingName] = useState(false)
  const t = useAppText()
  const hidden = (text: string) => <span class="sr-only">{text}</span>
  const firstName = useRef<HTMLInputElement>(null)
  const lastName = useRef<HTMLInputElement>(null)
  const target = email ? emailToVerify(email) : null
  const [emailStep, setEmailStep] = useState<EmailStep | null>(null)
  // A link asks for the code (`?verify`): open it whenever that ask arrives, also while the section
  // stays on screen, and once the address it is for has been read.
  useEffect(() => {
    if (openEmailCode && target) setEmailStep("code")
  }, [openEmailCode, Boolean(target)])
  const cancelName = () => {
    setEditingName(false)
    nameEdit.onCancel?.()
  }
  useSucceeded(
    nameEdit.pending,
    Boolean(nameEdit.error || nameEdit.fieldErrors.firstName || nameEdit.fieldErrors.lastName),
    () => setEditingName(false),
  )
  // A refused save lands the person on the field to fix. The app passes a new object per check.
  useEffect(() => {
    if (nameEdit.fieldErrors.firstName) firstName.current?.focus()
    else if (nameEdit.fieldErrors.lastName) lastName.current?.focus()
  }, [nameEdit.fieldErrors])

  return (
    <>
      <SettingList>
        {guestRow}
        {picture && <PictureRow {...picture} />}
        <SettingRow
          label={t.t(`ProfileAccount.name`)}
          value={name
            ? <span data-e2e="profile-name" translate={false}>{name}</span>
            : <span data-e2e="profile-name">{t.t(`ProfileAccount.notSet`)}</span>}
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              class={TOUCH_TARGET}
              data-e2e="profile-edit"
              onClick={() => setEditingName(true)}
            >
              <Rich parts={t.parts(`ProfileAccount.editName`)} tags={{ hidden }} />
            </Button>
          }
        />
        {guestRow || (!email && onRetryEmail) ? null : (
          <SettingRow
            label={t.t(`ProfileAccount.email`)}
            value={<EmailValue email={email} provider={providerOnly} />}
            action={email && emailChange && (
              <Cluster gap="sm" justify="end">
                {target && (
                  <Button
                    type="button"
                    size="sm"
                    class={TOUCH_TARGET}
                    data-e2e="email-code-open"
                    onClick={() => setEmailStep("code")}
                  >
                    {t.t(`ProfileAccount.enterCode`)}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  class={TOUCH_TARGET}
                  data-e2e="email-change-open"
                  onClick={() => setEmailStep("address")}
                >
                  <Rich
                    parts={t.parts(
                      email.email === null
                        ? `ProfileAccount.addEmail`
                        : `ProfileAccount.changeEmail`,
                    )}
                    tags={{ hidden }}
                  />
                </Button>
              </Cluster>
            )}
          />
        )}
        {dataExport && <DataExportRow {...dataExport} />}
      </SettingList>
      {!guestRow && !email && onRetryEmail && <EmailUnavailable onRetry={onRetryEmail} />}
      {picture && <PictureErrorState error={picture.error} />}
      {dataExport && <DataExportErrorState error={dataExport.error} />}

      <Modal
        open={editingName}
        onClose={cancelName}
        title={t.t(`ProfileAccount.editTitle`)}
        cancelLabel={t.t(`EmailScreen.close`)}
        dataE2E="profile-dialog"
      >
        <ScreenForm pending={nameEdit.pending} onSubmit={nameEdit.onSave}>
          <Stack>
            <Field
              id="profile-first-name"
              label={t.t(`ProfileAccount.firstName`)}
              error={nameEdit.fieldErrors.firstName}
              required
            >
              <Input
                ref={firstName}
                data-e2e="profile-first-name"
                name="firstName"
                autocomplete="given-name"
                value={nameEdit.firstName}
                onInput={(e) => nameEdit.onValueChange("firstName", e.currentTarget.value)}
                required
              />
            </Field>
            <Field
              id="profile-last-name"
              label={t.t(`ProfileAccount.lastName`)}
              error={nameEdit.fieldErrors.lastName}
              required
            >
              <Input
                ref={lastName}
                data-e2e="profile-last-name"
                name="lastName"
                autocomplete="family-name"
                value={nameEdit.lastName}
                onInput={(e) => nameEdit.onValueChange("lastName", e.currentTarget.value)}
                required
              />
            </Field>
            <ErrorState message={nameEdit.error} />
            <DialogActions>
              <Button type="button" variant="ghost" onClick={cancelName}>
                {t.t(`EmailScreen.cancel`)}
              </Button>
              <Button
                type="submit"
                data-e2e="profile-save"
                busy={nameEdit.pending}
                busyLabel={t.t(`PasswordResetScreen.saving`)}
              >
                {t.t(`ProfileAccount.save`)}
              </Button>
            </DialogActions>
          </Stack>
        </ScreenForm>
      </Modal>

      {email && emailChange && (
        <EmailDialog
          {...emailChange}
          step={emailStep}
          onStepChange={setEmailStep}
          status={email}
          providerProof={providerProof}
          next={profilePath("account")}
        />
      )}
    </>
  )
}

/** The address and whether it is proven, or a placeholder while it is not known. */
function EmailValue(
  { email, provider }: { email: EmailStatus | null; provider: string | null },
): JSX.Element {
  const t = useAppText()
  if (!email) return <span>…</span>
  if (email.email === null) {
    return (
      <span data-e2e="email-current">
        {provider === null ? t.t(`ProfileAccount.noneUsername`) : provider === ""
          // A passkey carries no address (#222).
          ? t.t(`ProfileAccount.none`)
          : t.t(`ProfileAccount.noneProvider`, { provider })}
      </span>
    )
  }
  return (
    <span class="flex flex-wrap items-center gap-2">
      <span class="wrap-anywhere" data-e2e="email-current" translate={false}>{email.email}</span>
      <EmailState proven={email.proven} />
    </span>
  )
}
