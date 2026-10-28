import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { DialogActions } from "@spy4x/preact-ui/dialog-actions"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input, Select } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { canTransfer, type GroupRole } from "@domain/groups"
import { type GroupMemberRow, memberLabel } from "./group-members.tsx"
import { ScreenForm } from "./progressive.tsx"
import { useAppText } from "./i18n.ts"

/** What the owner has filled in to hand the group over. */
export interface TransferDraft {
  /** The member who becomes the owner; `null` picks the first one offered. */
  userId: number | null
  /** The group's name, typed to confirm. */
  name: string
  /** The owner's current password. An app keeps it only until the request is sent. */
  password: string
}

export const EMPTY_TRANSFER_DRAFT: TransferDraft = { userId: null, name: "", password: "" }

/** A refused transfer: its message, under the field it is about, or under the form for none. */
export interface TransferError {
  field: "name" | "password" | null
  message: string
}

/** The field an API error code of a transfer is about, so both apps show it in the same place. */
export function transferErrorField(code: string | undefined): TransferError["field"] {
  if (code === "NAME_MISMATCH") return "name"
  if (code === "PASSWORD_INVALID") return "password"
  return null
}

export interface GroupTransferFormProps {
  groupName: string
  /** The role of the person looking. Only the owner can hand the group over. */
  role: GroupRole
  /** The members, oldest first; `null` while they are read. The owner is left out of the picker. */
  members: readonly GroupMemberRow[] | null
  draft: TransferDraft
  onDraftChange?: (draft: TransferDraft) => void
  /** A transfer is in flight. */
  transferring?: boolean
  /** Why the transfer was refused, or `null`. */
  error?: TransferError | null
  /** Hands the group to the chosen member. */
  onTransfer?: () => void
  /** Closes the dialog the form sits in. */
  onCancel?: () => void
}

/**
 * Handing the group to another member, for the owner alone, in a dialog. The owner picks the
 * member, types the group's name and enters their password, as strong a check as a password change.
 * The new owner gets the group; the old one stays as an admin. When the form leaves the page it asks
 * the app to drop the typed password.
 */
export function GroupTransferForm(
  {
    groupName,
    role,
    members,
    draft,
    onDraftChange,
    transferring = false,
    error = null,
    onTransfer,
    onCancel,
  }: GroupTransferFormProps,
): JSX.Element | null {
  const t = useAppText()
  const nameInput = useRef<HTMLInputElement>(null)
  const passwordInput = useRef<HTMLInputElement>(null)
  const message = useRef<HTMLDivElement>(null)
  // A refused transfer lands the person on the field to fix, or on the message when it names none.
  useEffect(() => {
    if (!error) return
    const target = error.field === "name"
      ? nameInput
      : error.field === "password"
      ? passwordInput
      : message
    target.current?.focus()
  }, [error])

  // The dialog closing takes the form away: the typed password goes with it, however it closed, so
  // opening the dialog again never shows it.
  const latest = useRef({ draft, onDraftChange })
  latest.current = { draft, onDraftChange }
  useEffect(() => () => {
    const { draft, onDraftChange } = latest.current
    if (draft.password) onDraftChange?.({ ...draft, password: "" })
  }, [])

  const candidates = transferCandidates(role, members)
  // A draft member who is not offered (none picked yet, or one who left) becomes the first one
  // offered, so the picker and the app's draft agree.
  const userId = candidates.some((member) => member.userId === draft.userId)
    ? draft.userId
    : candidates[0]?.userId ?? null
  useEffect(() => {
    if (userId !== draft.userId) onDraftChange?.({ ...draft, userId })
  }, [userId, draft.userId])

  if (candidates.length === 0) return null
  const change = (patch: Partial<TransferDraft>) => onDraftChange?.({ ...draft, userId, ...patch })
  const errorOf = (field: TransferError["field"]) => error?.field === field ? error.message : null

  return (
    <ScreenForm pending={transferring} onSubmit={onTransfer}>
      <Stack data-e2e="group-section-transfer">
        <p class="text-sm text-muted" data-e2e="group-transfer-explanation">
          {t.t(`GroupTransfer.explanation`)}
        </p>
        <Field id="group-transfer-member" label={t.t(`GroupTransfer.newOwner`)}>
          <Select
            name="userId"
            data-e2e="group-transfer-member"
            value={String(userId)}
            options={candidates.map((member) => ({
              value: member.userId,
              label: memberLabel(t, member),
            }))}
            onChange={(e) => change({ userId: Number(e.currentTarget.value) })}
          />
        </Field>
        <Field
          id="group-transfer-name"
          label={t.t(`GroupTransfer.typeName`, { name: groupName })}
          error={errorOf("name")}
          required
        >
          <Input
            ref={nameInput}
            name="name"
            data-e2e="group-transfer-name"
            autocomplete="off"
            maxLength={200}
            value={draft.name}
            onInput={(e) => change({ name: e.currentTarget.value })}
            required
          />
        </Field>
        <Field
          id="group-transfer-password"
          label={t.t(`GroupTransfer.password`)}
          error={errorOf("password")}
          required
        >
          <Input
            ref={passwordInput}
            type="password"
            name="password"
            data-e2e="group-transfer-password"
            autocomplete="current-password"
            maxLength={1024}
            value={draft.password}
            onInput={(e) => change({ password: e.currentTarget.value })}
            required
          />
        </Field>
        <div ref={message} tabIndex={-1} data-e2e="group-transfer-error">
          <ErrorState message={error && error.field === null ? error.message : null} />
        </div>
        <DialogActions>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t.t(`GroupTransfer.cancel`)}
          </Button>
          <Button
            type="submit"
            variant="danger"
            data-e2e="group-transfer"
            busy={transferring}
            busyLabel={t.t(`GroupTransfer.transferring`)}
          >
            {t.t(`GroupTransfer.transfer`)}
          </Button>
        </DialogActions>
      </Stack>
    </ScreenForm>
  )
}

/** The members the owner may hand the group to: everyone but the owner. */
export function transferCandidates(
  role: GroupRole,
  members: readonly GroupMemberRow[] | null,
): GroupMemberRow[] {
  return (members ?? []).filter((member) => canTransfer(role, member.role))
}
