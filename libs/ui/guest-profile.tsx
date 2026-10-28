import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { IconLockClosed } from "@spy4x/preact-icons"
import { Button } from "@spy4x/preact-ui/button"
import { DialogActions } from "@spy4x/preact-ui/dialog-actions"
import { Card } from "@spy4x/preact-ui/card"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { Modal } from "@spy4x/preact-ui/modal"
import { TOUCH_TARGET } from "@spy4x/preact-ui/page-header"
import { SettingGroup, SettingList, SettingRow } from "@spy4x/preact-ui/setting-row"
import { GUEST_DELETE_WORD, type GuestLimitedAction } from "@domain/identity"
import { Rich } from "@spy4x/preact-ui/i18n"
import { GUEST_PATHS } from "./guest-screens.tsx"
import { useAppText } from "./i18n.ts"
import { type Navigate, ScreenForm } from "./progressive.tsx"

/** The Profile's parts for a guest account (#224): what it is, its missing ways in, deleting it. */

/** The first row of the Account group for a guest; a full account shows none. */
export function GuestAccountRow({ navigate }: { navigate?: Navigate }): JSX.Element {
  const t = useAppText()
  return (
    <SettingRow
      label={t.t(`GuestProfile.accountType`)}
      dataE2E="profile-account-type"
      value={t.t(`GuestProfile.guestAccount`)}
      action={
        <Button
          href={GUEST_PATHS.keep}
          navigate={navigate}
          variant="secondary"
          size="sm"
          class={TOUCH_TARGET}
          data-e2e="profile-keep"
        >
          {t.t(`GuestScreens.keep`)}
        </Button>
      }
    />
  )
}

/**
 * In place of the Security group and the sign-in methods for a guest, who has neither a password
 * nor a method to list: one empty state that leads to `/keep`.
 */
export function GuestSignInMethods({ navigate }: { navigate?: Navigate }): JSX.Element {
  const t = useAppText()
  return (
    <SettingGroup title={t.t(`GuestProfile.methods`)}>
      <Card>
        <EmptyState
          icon={<IconLockClosed class="size-6" />}
          title={t.t(`GuestProfile.noMethods`)}
          headingLevel={3}
          inset
          description={t.t(`GuestProfile.noMethodsText`)}
          action={
            <Button
              href={GUEST_PATHS.keep}
              navigate={navigate}
              variant="secondary"
              data-e2e="methods-keep"
            >
              {t.t(`GuestScreens.keep`)}
            </Button>
          }
        />
      </Card>
    </SettingGroup>
  )
}

/** What {@link GuestAccountDelete} takes. */
export interface GuestAccountDeleteProps {
  /** The delete is in flight. */
  pending: boolean
  /** Why the delete was refused, shown in the dialog. */
  error: string | null
  /** Deletes the account with the typed word. */
  onDelete: (confirm: string) => void
}

/**
 * "Delete my account" for a guest, who has no password to confirm with: the dialog asks for the
 * word {@link GUEST_DELETE_WORD} and deletes at once, with no grace period, because nobody could
 * sign in to restore it.
 */
export function GuestAccountDelete(
  { pending, error, onDelete }: GuestAccountDeleteProps,
): JSX.Element {
  const t = useAppText()
  const [open, setOpen] = useState(false)
  const [word, setWord] = useState("")
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (error) field.current?.focus()
  }, [error])
  const close = () => {
    setOpen(false)
    setWord("")
  }
  const typed = word.trim().toLowerCase() === GUEST_DELETE_WORD
  return (
    <SettingGroup title={t.t(`GuestProfile.danger`)}>
      <SettingList>
        <SettingRow
          label={t.t(`AccountDelete.title`)}
          value={t.t(`GuestProfile.deleteSummary`)}
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              class={TOUCH_TARGET}
              data-e2e="guest-delete-open"
              onClick={() => setOpen(true)}
            >
              <Rich
                parts={t.parts(`AccountDelete.deleteHidden`)}
                tags={{ hidden: (text) => <span class="sr-only">{text}</span> }}
              />
            </Button>
          }
        />
      </SettingList>
      <Modal
        open={open}
        onClose={close}
        title={t.t(`GuestProfile.deleteTitle`)}
        cancelLabel={t.t(`EmailScreen.close`)}
        tone="danger"
        dataE2E="guest-delete-dialog"
      >
        <ScreenForm pending={pending} onSubmit={() => typed && onDelete(word.trim())}>
          <Stack>
            <p class="text-sm text-muted">{t.t(`GuestProfile.deleteText`)}</p>
            <Field
              id="guest-delete-word"
              label={t.t(`GuestProfile.typeWord`, { word: GUEST_DELETE_WORD })}
              error={error}
            >
              <Input
                ref={field}
                name="confirm"
                autocomplete="off"
                value={word}
                onInput={(e) => setWord(e.currentTarget.value)}
                data-e2e="guest-delete-word"
              />
            </Field>
            <DialogActions>
              <Button type="button" variant="ghost" onClick={close}>
                {t.t(`EmailScreen.cancel`)}
              </Button>
              <Button
                type="submit"
                variant="danger"
                disabled={!typed || pending}
                data-e2e="guest-delete-confirm"
              >
                {t.t(`GuestProfile.deleteForGood`)}
              </Button>
            </DialogActions>
          </Stack>
        </ScreenForm>
      </Modal>
    </SettingGroup>
  )
}

/** The catalog keys of each refusal's title and text (#224); `other` for the rest. */
export const GUEST_REFUSALS: Record<GuestLimitedAction | "other", { title: string; text: string }> =
  {
    invite: { title: `GuestProfile.inviteTitle`, text: `GuestProfile.inviteText` },
    push: { title: `GuestProfile.pushTitle`, text: `GuestProfile.pushText` },
    "api-token": { title: `GuestProfile.apiTokenTitle`, text: `GuestProfile.apiTokenText` },
    upload: { title: `GuestProfile.uploadTitle`, text: `GuestProfile.uploadText` },
    billing: { title: `GuestProfile.billingTitle`, text: `GuestProfile.billingText` },
    telegram: { title: `GuestProfile.telegramTitle`, text: `GuestProfile.telegramText` },
    other: { title: `GuestProfile.otherTitle`, text: `GuestProfile.otherText` },
  }

/**
 * The refusal of an action a guest cannot take yet, shown where the person pressed it, with
 * "Keep your account" as the way forward and Close to stay.
 */
export function GuestRefusalDialog(
  { action, onClose, navigate }: {
    action: GuestLimitedAction | "other"
    onClose: () => void
    navigate?: Navigate
  },
): JSX.Element {
  const t = useAppText()
  const copy = GUEST_REFUSALS[action]
  return (
    <Modal
      open
      title={t.t(copy.title)}
      ariaDescribedBy="guest-refusal-text"
      onClose={onClose}
      cancelLabel={t.t(`EmailScreen.close`)}
      dataE2E="guest-refusal"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} data-e2e="guest-refusal-close">
            {t.t(`GuestProfile.notNow`)}
          </Button>
          <Button
            href={GUEST_PATHS.keep}
            navigate={navigate}
            onClick={onClose}
            data-e2e="guest-refusal-keep"
          >
            {t.t(`GuestScreens.keep`)}
          </Button>
        </>
      }
    >
      <p id="guest-refusal-text">{t.t(copy.text)}</p>
    </Modal>
  )
}
