// deno-lint-ignore-file ui-text/no-literal
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
import { GUEST_DELETE_WORD, GUEST_REFUSAL_MESSAGE, type GuestLimitedAction } from "@domain/identity"
import { GUEST_PATHS, KEEP_LABEL } from "./guest-screens.tsx"
import { type Navigate, ScreenForm } from "./progressive.tsx"

/** The Profile's parts for a guest account (#224): what it is, its missing ways in, deleting it. */

/** The first row of the Account group for a guest; a full account shows none. */
export function GuestAccountRow({ navigate }: { navigate?: Navigate }): JSX.Element {
  return (
    <SettingRow
      label="Account type"
      dataE2E="profile-account-type"
      value="Guest account. Only this browser can open it."
      action={
        <Button
          href={GUEST_PATHS.keep}
          navigate={navigate}
          variant="secondary"
          size="sm"
          class={TOUCH_TARGET}
          data-e2e="profile-keep"
        >
          {KEEP_LABEL}
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
  return (
    <SettingGroup title="Sign-in methods">
      <Card>
        <EmptyState
          icon={<IconLockClosed class="size-6" />}
          title="No sign-in methods yet"
          headingLevel={3}
          inset
          description="Add one so you can sign in on another device."
          action={
            <Button
              href={GUEST_PATHS.keep}
              navigate={navigate}
              variant="secondary"
              data-e2e="methods-keep"
            >
              {KEEP_LABEL}
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
    <SettingGroup title="Danger zone">
      <SettingList>
        <SettingRow
          label="Delete my account"
          value="Deletes this guest account and everything in it, right away."
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              class={TOUCH_TARGET}
              data-e2e="guest-delete-open"
              onClick={() => setOpen(true)}
            >
              Delete <span class="sr-only">my account</span>
            </Button>
          }
        />
      </SettingList>
      <Modal
        open={open}
        onClose={close}
        title="Delete this guest account?"
        cancelLabel="Close"
        tone="danger"
        dataE2E="guest-delete-dialog"
      >
        <ScreenForm pending={pending} onSubmit={() => typed && onDelete(word.trim())}>
          <Stack>
            <p class="text-sm text-muted">
              Its notes and groups are deleted now, and nobody can bring them back: a guest account
              has no sign-in method to restore it with. Export a group first to keep a copy.
            </p>
            <Field
              id="guest-delete-word"
              label={`Type "${GUEST_DELETE_WORD}" to confirm`}
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
              <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
              <Button
                type="submit"
                variant="danger"
                disabled={!typed || pending}
                data-e2e="guest-delete-confirm"
              >
                Delete for good
              </Button>
            </DialogActions>
          </Stack>
        </ScreenForm>
      </Modal>
    </SettingGroup>
  )
}

/** What a refusal says for each action a guest cannot take yet (#224); `other` for the rest. */
export const GUEST_REFUSALS: Record<GuestLimitedAction | "other", { title: string; text: string }> =
  {
    invite: {
      title: "Inviting needs a sign-in method",
      text:
        "The people you invite see who invited them, and a guest account could vanish with this browser's data. Add a sign-in method first.",
    },
    push: {
      title: "Notifications on this device need a sign-in method",
      text: "Add one, then turn them on here.",
    },
    "api-token": {
      title: "API tokens need a sign-in method",
      text: "A token opens this account from outside the browser. Add a sign-in method first.",
    },
    upload: {
      title: "Importing needs a sign-in method",
      text: "Add one to your account first, then import the file.",
    },
    billing: {
      title: "Paid plans need a sign-in method",
      text: "A plan is billed to an account you can sign in to again. Add a sign-in method first.",
    },
    telegram: {
      title: "Telegram needs a sign-in method",
      text: "A linked chat acts as you from outside the browser. Add a sign-in method first.",
    },
    other: { title: "This needs a sign-in method", text: GUEST_REFUSAL_MESSAGE },
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
  const copy = GUEST_REFUSALS[action]
  return (
    <Modal
      open
      title={copy.title}
      ariaDescribedBy="guest-refusal-text"
      onClose={onClose}
      cancelLabel="Close"
      dataE2E="guest-refusal"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} data-e2e="guest-refusal-close">
            Not now
          </Button>
          <Button
            href={GUEST_PATHS.keep}
            navigate={navigate}
            onClick={onClose}
            data-e2e="guest-refusal-keep"
          >
            {KEEP_LABEL}
          </Button>
        </>
      }
    >
      <p id="guest-refusal-text">{copy.text}</p>
    </Modal>
  )
}
