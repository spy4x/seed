import type { ComponentChildren, JSX, RefObject } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { IconLink, IconMail } from "@spy4x/preact-icons"
import { Avatar } from "@spy4x/preact-ui/avatar"
import { Button } from "@spy4x/preact-ui/button"
import { Card, CardBody } from "@spy4x/preact-ui/card"
import { Checkbox } from "@spy4x/preact-ui/checkbox"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { CopyBlock } from "@spy4x/preact-ui/copy-block"
import { DropdownItem } from "@spy4x/preact-ui/dropdown"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input, Select } from "@spy4x/preact-ui/input"
import { Link } from "@spy4x/preact-ui/link"
import { Cluster, Stack } from "@spy4x/preact-ui/layout"
import type { PlanRefusal } from "@domain/billing"
import {
  canManageInvitations,
  GroupRole,
  invitableRoles,
  invitableRolesOnPlan,
  INVITATION_DEFAULT_DAYS,
  INVITATION_MAX_DAYS,
  INVITATION_MAX_USES,
} from "@domain/groups"
import { ROLE_TEXT } from "./groups-screen.tsx"
import { useSucceeded } from "@spy4x/preact-ui/use-succeeded"
import { useFreshError } from "@spy4x/preact-ui/use-fresh-error"
import { useFocusAfterRemoval } from "@spy4x/preact-ui/use-focus-after-removal"
import { MoreMenu } from "@spy4x/preact-ui/page-header"
import { PlanRefusalNotice } from "./plan-refusal.tsx"
import { type Navigate, SCREEN_PATHS, ScreenForm } from "./progressive.tsx"

/** Why the role picker offers a viewer only, on a plan without `memberRoles`. */
export const VIEWERS_ONLY_HINT =
  "This group's plan lets an invitation add viewers only. A paid plan lets you invite editors and admins too."

/** A pending invitation as the group's Invitations section lists it. */
export interface InvitationRow {
  id: string
  role: GroupRole
  /** The address it is tied to, or `null` for a link anyone may use. */
  email: string | null
  maxUses: number
  uses: number
  /** When it stops working, as an ISO string. */
  expiresAt: string
  createdBy: { name: string }
}

/** What the creator has chosen in the create form. Field names match the API's create body. */
export interface InvitationDraft {
  role: GroupRole
  expiresInDays: number
  maxUses: number
  email: string
  sendEmail: boolean
}

/** The create form's starting values: an editor, seven days, one use, no address, no mail. */
export const EMPTY_INVITATION_DRAFT: InvitationDraft = {
  role: GroupRole.EDITOR,
  expiresInDays: INVITATION_DEFAULT_DAYS,
  maxUses: 1,
  email: "",
  sendEmail: false,
}

/** The invitation just created: its link, shown this once, and whether it was mailed. */
export interface CreatedInvitation {
  link: string
  /** The creator asked for a mail. */
  mailAsked: boolean
  mailSent: boolean
}

export interface InviteFormProps {
  groupId: string
  /** The role of the person inviting; it caps the roles offered. */
  actorRole: GroupRole
  /**
   * The group's plan includes `memberRoles`. Without it an invitation adds a viewer only, and the
   * role picker says why. Defaults to `true`: the server refuses what the plan does not allow.
   */
  memberRoles?: boolean
  draft: InvitationDraft
  onDraftChange?: (draft: InvitationDraft) => void
  /** A create is in flight. */
  creating?: boolean
  /** Why the create was refused, shown under the address field, or `null`. */
  createError?: string | null
  /** The group's plan refused the create: shown as a notice in place of `createError`. */
  createRefusal?: PlanRefusal | null
  /** Creates an invitation from the draft. */
  onCreate?: () => void
  /**
   * Drawn inside the form, above its buttons: the price confirmation (`SeatPriceConfirm`) of a
   * group billed per member.
   */
  seatPrice?: ComponentChildren
  /**
   * The invitation just created, or `null`. The form shows it only when it arrives while the form
   * is open, so a link from an earlier visit is never shown again.
   */
  created?: CreatedInvitation | null
  /** Closes the dialog the form sits in: Cancel, or Done once the link is copied. */
  onClose?: () => void
  navigate?: Navigate
}

/**
 * Inviting people, inside the "Invite people" dialog: a role up to the person's own limit, an
 * optional address, how long the link works and how many people it lets in. Once created, the
 * dialog shows the link once to copy, with a Done button. Only its hash is stored, so it is never
 * shown again.
 */
export function InviteForm(
  {
    groupId,
    actorRole,
    memberRoles = true,
    draft,
    onDraftChange,
    creating = false,
    createError = null,
    createRefusal = null,
    onCreate,
    seatPrice,
    created = null,
    onClose,
    navigate,
  }: InviteFormProps,
): JSX.Element {
  const emailInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (createError && !createRefusal) emailInput.current?.focus()
  }, [createError, createRefusal])
  // The link the app held when the dialog opened belongs to an earlier invitation.
  const [stale] = useState(created)
  const fresh = created !== stale ? created : null
  const createdBox = useRef<HTMLDivElement>(null)
  // The new link is the next thing to act on, so focus moves to it.
  useEffect(() => {
    if (fresh) createdBox.current?.focus()
  }, [fresh])

  const roles = invitableRolesOnPlan(actorRole, memberRoles)
  // A draft role the plan does not allow (the default editor on a free plan) becomes the first one
  // it does, so the picker and the app's draft agree.
  const role = roles.includes(draft.role) ? draft.role : roles[0]
  useEffect(() => {
    if (role !== undefined && role !== draft.role) onDraftChange?.({ ...draft, role })
  }, [role, draft.role])
  const change = (patch: Partial<InvitationDraft>) => onDraftChange?.({ ...draft, ...patch })

  if (fresh) {
    return (
      <div ref={createdBox} tabIndex={-1} class="flex flex-col gap-4" data-e2e="invitation-created">
        <p class="text-sm">
          Copy this link now: it is not shown again.
          {fresh.mailAsked &&
            (fresh.mailSent
              ? " It was also sent by e-mail."
              : " The e-mail could not be sent, so share the link yourself.")}
        </p>
        <CopyBlock text={fresh.link} copyLabel="Copy invitation link" copiedLabel="Link copied" />
        <Cluster justify="end">
          <Button type="button" onClick={onClose} data-e2e="invitation-done">Done</Button>
        </Cluster>
      </div>
    )
  }
  return (
    <ScreenForm pending={creating} onSubmit={onCreate}>
      <Stack data-e2e="invitation-form">
        <p class="text-sm text-muted">
          Anyone with the link can join with its role until it expires or is used up. Pending
          invitations do not count toward the plan's member limit; accepting one does.
        </p>
        <Field id="invitation-role" label="Role" hint={memberRoles ? undefined : VIEWERS_ONLY_HINT}>
          <Select
            name="role"
            data-e2e="invitation-role"
            value={String(role)}
            options={roles.map((value) => ({ value, label: ROLE_TEXT[value] }))}
            onChange={(e) => change({ role: Number(e.currentTarget.value) as GroupRole })}
          />
        </Field>
        <Field
          id="invitation-email"
          label="E-mail address (optional)"
          hint="Only the account that proved this address can accept. It lets in one person."
          error={createRefusal ? null : createError}
        >
          <Input
            ref={emailInput}
            type="email"
            name="email"
            data-e2e="invitation-email"
            autocomplete="off"
            maxLength={254}
            value={draft.email}
            onInput={(e) => {
              const email = e.currentTarget.value
              // A cleared address hides the "send the link" box, so its tick goes with it.
              change(email.trim() === "" ? { email, sendEmail: false } : { email })
            }}
          />
        </Field>
        {draft.email.trim() !== "" && (
          <Checkbox
            name="sendEmail"
            value="true"
            data-e2e="invitation-send-email"
            checked={draft.sendEmail}
            onChange={(e) => change({ sendEmail: e.currentTarget.checked })}
          >
            Send the link to this address
          </Checkbox>
        )}
        <div class="grid grid-cols-2 gap-4">
          <Field id="invitation-days" label="Expires after (days)">
            <Input
              type="number"
              name="expiresInDays"
              data-e2e="invitation-days"
              min={1}
              max={INVITATION_MAX_DAYS}
              value={String(draft.expiresInDays)}
              onInput={(e) => change({ expiresInDays: Number(e.currentTarget.value) })}
              required
            />
          </Field>
          <Field id="invitation-uses" label="People it lets in">
            <Input
              type="number"
              name="maxUses"
              data-e2e="invitation-uses"
              min={1}
              max={INVITATION_MAX_USES}
              value={String(draft.maxUses)}
              onInput={(e) => change({ maxUses: Number(e.currentTarget.value) })}
              required
            />
          </Field>
        </div>
        {seatPrice}
        {createRefusal && (
          <PlanRefusalNotice groupId={groupId} refusal={createRefusal} navigate={navigate} />
        )}
        <Cluster justify="end">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            data-e2e="invitation-create"
            busy={creating}
            busyLabel="Creating..."
          >
            Create link
          </Button>
        </Cluster>
      </Stack>
    </ScreenForm>
  )
}

export interface PendingInvitationsProps {
  /** The role of the person looking. Only the owner and an admin see the list. */
  actorRole: GroupRole
  /** The pending invitations, newest first; `null` while they are read. */
  invitations: readonly InvitationRow[] | null
  /** Why the invitations could not be read, or `null`. */
  error?: string | null
  /** The invitation whose revoke is in flight, or `null`. */
  revokingId?: string | null
  /** The last refused revoke, shown in its dialog, or `null`. */
  revokeError?: { invitationId: string; message: string } | null
  /** Revokes an invitation, once the person confirmed it. */
  onRevoke?: (invitationId: string) => void
}

/**
 * The pending invitations of a group, under its members, for the owner and admins. Each row has a
 * menu with Revoke, behind a confirmation. Nothing is drawn while there are none.
 */
export function PendingInvitations(
  { actorRole, invitations, error = null, revokingId = null, revokeError = null, onRevoke }:
    PendingInvitationsProps,
): JSX.Element | null {
  const wrapper = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  // A revoked invitation's menu goes with its row: focus moves to the next row's menu, else to the
  // main button of the section around this one ("Invite people" of the members).
  useFocusAfterRemoval(
    list,
    invitations?.map((invitation) => invitation.id) ?? null,
    revokingId,
    {
      earlier: false,
      fallback: () => wrapper.current?.parentElement?.closest("section")?.querySelector("button"),
    },
  )
  if (!canManageInvitations(actorRole)) return null
  // The wrapper draws no box of its own, and stays when the last row goes, for the focus above.
  return (
    <div ref={wrapper} class="contents">
      {error
        ? <ErrorState message={error} />
        : invitations && invitations.length > 0 && (
          <InvitationList
            list={list}
            actorRole={actorRole}
            invitations={invitations}
            revokingId={revokingId}
            revokeError={revokeError}
            onRevoke={onRevoke}
          />
        )}
    </div>
  )
}

function InvitationList(
  { list, actorRole, invitations, revokingId, revokeError, onRevoke }:
    & Pick<PendingInvitationsProps, "actorRole" | "revokingId" | "revokeError" | "onRevoke">
    & { list: RefObject<HTMLUListElement>; invitations: readonly InvitationRow[] },
): JSX.Element {
  return (
    <section
      aria-labelledby="group-invitations"
      class="flex flex-col gap-2"
      data-e2e="group-section-invitations"
    >
      <h3 id="group-invitations" class="text-sm font-medium text-muted">Pending invitations</h3>
      <Card>
        <ul ref={list} class="divide-y divide-subtle">
          {invitations.map((invitation) => (
            <InvitationItem
              key={invitation.id}
              invitation={invitation}
              // Revoking is not a plan feature: whoever could give the role may withdraw it.
              canRevoke={invitableRoles(actorRole).includes(invitation.role)}
              pending={revokingId === invitation.id}
              error={revokeError?.invitationId === invitation.id ? revokeError.message : null}
              onRevoke={onRevoke}
            />
          ))}
        </ul>
      </Card>
    </section>
  )
}

function InvitationItem(
  { invitation, canRevoke, pending, error, onRevoke }: {
    invitation: InvitationRow
    canRevoke: boolean
    pending: boolean
    error: string | null
    onRevoke?: (invitationId: string) => void
  },
): JSX.Element {
  const [revoking, setRevoking] = useState(false)
  useSucceeded(pending, error !== null, () => setRevoking(false))
  const [revokeError, opened] = useFreshError(error, pending)
  const who = invitation.email ?? "Anyone with the link"
  return (
    <li
      class="flex items-center gap-3 px-4 py-3 sm:px-6"
      data-e2e="invitation"
      data-invitation-id={invitation.id}
    >
      <span
        class="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-subtle text-muted"
        aria-hidden="true"
      >
        {invitation.email ? <IconMail class="size-4" /> : <IconLink class="size-4" />}
      </span>
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <span class="truncate text-sm font-medium" title={who} data-e2e="invitation-who">
          {who}
        </span>
        <span class="truncate text-xs text-muted">
          {`used ${invitation.uses} of ${invitation.maxUses} · expires `}
          <time dateTime={invitation.expiresAt}>{invitation.expiresAt.slice(0, 10)}</time>
          {invitation.createdBy.name.trim() && ` · by ${invitation.createdBy.name}`}
        </span>
      </div>
      <span class="shrink-0 text-sm text-muted" data-e2e="invitation-role-text">
        {ROLE_TEXT[invitation.role]}
      </span>
      {canRevoke
        ? (
          <MoreMenu label={`Actions for the invitation for ${who}`} dataE2E="invitation-menu">
            <DropdownItem
              danger
              disabled={pending}
              dataE2E="invitation-revoke-open"
              onClick={() => {
                opened()
                setRevoking(true)
              }}
            >
              Revoke
            </DropdownItem>
          </MoreMenu>
        )
        : <span class="w-11 shrink-0 sm:w-9" aria-hidden="true" />}
      {revoking && (
        <ConfirmDialog
          title="Revoke this invitation?"
          confirmLabel="Revoke"
          cancelLabel="Cancel"
          tone="danger"
          dataE2E="invitation-revoke-dialog"
          onConfirm={() => {
            if (!pending) onRevoke?.(invitation.id)
          }}
          onCancel={() => setRevoking(false)}
        >
          <div class="flex flex-col gap-4">
            <p class="text-sm text-muted">
              The link for {who} stops working right away. People who joined with it stay.
            </p>
            <ErrorState focusOnAppear message={revokeError} dataE2E="invitation-error" />
          </div>
        </ConfirmDialog>
      )}
    </li>
  )
}

/** An invitation as the person invited sees it. */
export interface InvitationPreviewRow {
  id: string
  groupId: string
  groupName: string
  /** Empty when the inviter set no name. */
  inviterName: string
  role: GroupRole
  /** Tied to one e-mail address. */
  addressed: boolean
  /** The person looking may accept it. */
  forYou: boolean
  /** When it stops working, as an ISO string. */
  expiresAt: string
}

export interface InvitationScreenProps {
  /** The invitation, or `null` while it is read or when it no longer works. */
  invitation: InvitationPreviewRow | null
  loading: boolean
  /** Why the invitation cannot be used (expired, revoked, used up, missing), or `null`. */
  error?: string | null
  /** An accept or decline is in flight. */
  answering?: boolean
  /** Why the accept or decline was refused, or `null`. */
  answerError?: string | null
  /** The group's plan refused the accept: shown as a notice in place of `answerError`. */
  answerRefusal?: PlanRefusal | null
  onAccept?: () => void
  onDecline?: () => void
  navigate?: Navigate
}

/**
 * The page an invitation's link opens: one centred card with the group's name, who invited and the
 * role, Accept as the primary button and Decline as a quiet one.
 */
export function InvitationScreen(
  {
    invitation,
    loading,
    error = null,
    answering = false,
    answerError = null,
    answerRefusal = null,
    onAccept,
    onDecline,
    navigate,
  }: InvitationScreenProps,
): JSX.Element {
  if (!invitation) {
    return (
      <div class="mx-auto flex w-full max-w-md flex-col gap-4">
        <EmptyState
          headingLevel={1}
          title={loading ? "Opening the invitation..." : "This invitation cannot be used"}
          description={loading ? undefined : error ?? undefined}
          action={!loading && (
            <Button href={SCREEN_PATHS.groups} navigate={navigate} variant="outline">
              Go to your groups
            </Button>
          )}
        />
      </div>
    )
  }
  const inviter = invitation.inviterName.trim() || "Someone"
  return (
    <div class="mx-auto w-full max-w-md">
      <Card>
        <CardBody>
          <div
            class="flex flex-col items-center gap-6 text-center"
            data-e2e="invitation-card"
            data-invitation-id={invitation.id}
          >
            <Avatar name={invitation.groupName} alt="" size="lg" />
            <div class="flex w-full min-w-0 flex-col gap-2">
              <p class="text-sm text-muted">
                <span data-e2e="invitation-inviter">{inviter}</span> invited you to join
              </p>
              <h1 class="break-words text-xl font-semibold" data-e2e="invitation-group">
                {invitation.groupName}
              </h1>
              <p class="text-sm text-muted">
                as <span class="font-medium text-foreground">{ROLE_TEXT[invitation.role]}</span>
                {" · expires "}
                <time dateTime={invitation.expiresAt}>{invitation.expiresAt.slice(0, 10)}</time>
              </p>
            </div>
            {invitation.forYou
              ? (
                <div class="flex w-full flex-col gap-2">
                  <Button
                    type="button"
                    class="w-full justify-center"
                    data-e2e="invitation-accept"
                    busy={answering}
                    busyLabel="Joining..."
                    onClick={() => !answering && onAccept?.()}
                  >
                    Accept invitation
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    class="w-full justify-center"
                    data-e2e="invitation-decline"
                    disabled={answering}
                    onClick={onDecline}
                  >
                    Decline
                  </Button>
                </div>
              )
              : <NotForYou navigate={navigate} />}
            <AnswerError
              groupId={invitation.groupId}
              error={answerError}
              refusal={answerRefusal}
              navigate={navigate}
            />
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

export interface MyInvitationsSectionProps {
  /** Pending invitations sent to an address the person proved; the section hides when empty. */
  invitations: readonly InvitationPreviewRow[]
  /** The invitation whose accept or decline is in flight, or `null`. */
  answeringId?: string | null
  /** The last refused answer, shown under that invitation, or `null`. */
  answerError?: { invitationId: string; message: string; plan?: PlanRefusal | null } | null
  onAccept?: (invitationId: string) => void
  onDecline?: (invitationId: string) => void
  navigate?: Navigate
}

/** The invitations sent to the person's e-mail address, on their groups page: one row each. */
export function MyInvitationsSection(
  { invitations, answeringId = null, answerError = null, onAccept, onDecline, navigate }:
    MyInvitationsSectionProps,
): JSX.Element | null {
  if (invitations.length === 0) return null
  return (
    <section aria-labelledby="my-invitations" class="flex flex-col gap-2" data-e2e="my-invitations">
      <h2 id="my-invitations" class="text-sm font-medium text-muted">Invitations for you</h2>
      <Card>
        <ul class="divide-y divide-subtle">
          {invitations.map((invitation) => {
            const failed = answerError?.invitationId === invitation.id ? answerError : null
            const answering = answeringId === invitation.id
            const inviter = invitation.inviterName.trim() || "Someone"
            return (
              <li
                key={invitation.id}
                class="flex flex-col gap-3 px-4 py-3 sm:px-6"
                data-e2e="invitation-card"
                data-invitation-id={invitation.id}
              >
                <div class="flex flex-wrap items-center gap-3">
                  <div class="flex min-w-0 flex-1 flex-col gap-1">
                    <h3
                      class="truncate text-sm font-medium"
                      title={invitation.groupName}
                      data-e2e="invitation-group"
                    >
                      {invitation.groupName}
                    </h3>
                    <p class="text-xs text-muted">
                      <span data-e2e="invitation-inviter">{inviter}</span> invited you as{" "}
                      {ROLE_TEXT[invitation.role]}
                    </p>
                  </div>
                  {invitation.forYou && (
                    <Cluster gap="sm">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        data-e2e="invitation-decline"
                        aria-label={`Decline the invitation to ${invitation.groupName}`}
                        disabled={answering}
                        onClick={() => onDecline?.(invitation.id)}
                      >
                        Decline
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        data-e2e="invitation-accept"
                        aria-label={`Accept the invitation to ${invitation.groupName}`}
                        busy={answering}
                        busyLabel="Joining..."
                        onClick={() =>
                          !answering && onAccept?.(invitation.id)}
                      >
                        Accept
                      </Button>
                    </Cluster>
                  )}
                </div>
                {!invitation.forYou && <NotForYou navigate={navigate} />}
                <AnswerError
                  groupId={invitation.groupId}
                  error={failed?.message ?? null}
                  refusal={failed?.plan ?? null}
                  navigate={navigate}
                />
              </li>
            )
          })}
        </ul>
      </Card>
    </section>
  )
}

/** Why the person cannot answer an invitation sent to another address. */
function NotForYou({ navigate }: { navigate?: Navigate }): JSX.Element {
  return (
    <p class="text-sm text-muted" data-e2e="invitation-not-for-you">
      This invitation was sent to another e-mail address. If the address is yours, confirm it on the
      {" "}
      <Link href={SCREEN_PATHS.email} navigate={navigate} class="pc-link">E-mail page</Link>{" "}
      first, or sign in with the account that uses it.
    </p>
  )
}

/** A refused answer: the plan's notice, or the message, which takes focus. */
function AnswerError(
  { groupId, error, refusal, navigate }: {
    groupId: string
    error: string | null
    refusal: PlanRefusal | null
    navigate?: Navigate
  },
): JSX.Element {
  return refusal
    ? <PlanRefusalNotice groupId={groupId} refusal={refusal} navigate={navigate} />
    : <ErrorState focusOnAppear message={error} dataE2E="invitation-answer-error" />
}
