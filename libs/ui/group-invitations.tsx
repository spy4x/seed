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
import { Notice } from "@spy4x/preact-ui/notice"
import { Cluster, Stack } from "@spy4x/preact-ui/layout"
import { SettingGroup } from "@spy4x/preact-ui/setting-row"
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
import { roleName } from "./groups-screen.tsx"
import { Rich } from "@spy4x/preact-ui/i18n"
import { useAppText } from "./i18n.ts"
import { useSucceeded } from "@spy4x/preact-ui/use-succeeded"
import { useFreshError } from "@spy4x/preact-ui/use-fresh-error"
import { useFocusAfterRemoval } from "@spy4x/preact-ui/use-focus-after-removal"
import { MoreMenu } from "@spy4x/preact-ui/page-header"
import { PlanRefusalNotice } from "./plan-refusal.tsx"
import { GROUP_PATHS, type Navigate, SCREEN_PATHS, ScreenForm } from "./progressive.tsx"

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
  /** Why the create did not start, when no field owns it (offline): shown above the buttons. */
  formError?: string | null
  /**
   * The create was refused because the creator's own address is not verified: the message, shown
   * above the buttons as a notice with a way to the profile's Account section.
   */
  addressRefusal?: string | null
  /** Creates an invitation from the draft. */
  onCreate?: () => void
  /**
   * Drawn inside the form, above its buttons: the price confirmation (`SeatPriceConfirm`) of a
   * group billed per member.
   */
  seatPrice?: ComponentChildren
  /** The invitation just created, or `null`. Given, the form gives way to its link, shown once. */
  created?: CreatedInvitation | null
  /** Done, after the link: the app forgets it and goes back to the group's page. */
  onDone?: () => void
  navigate?: Navigate
}

/**
 * The form of the invitation page: a role up to the person's own limit, an optional address, how
 * long the link works and how many people it lets in, with Cancel (back to the group's page) and
 * "Create invitation". Once created, it shows the link once to copy, with a Done button. Only its
 * hash is stored, so it is never shown again.
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
    formError = null,
    addressRefusal = null,
    onCreate,
    seatPrice,
    created = null,
    onDone,
    navigate,
  }: InviteFormProps,
): JSX.Element {
  const t = useAppText()
  const emailInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (createError && !createRefusal) emailInput.current?.focus()
  }, [createError, createRefusal])
  const createdBox = useRef<HTMLDivElement>(null)
  // The new link is the next thing to act on, so focus moves to its copy button.
  useEffect(() => {
    if (created) createdBox.current?.querySelector<HTMLElement>("button")?.focus()
  }, [created])

  const roles = invitableRolesOnPlan(actorRole, memberRoles)
  // A draft role the plan does not allow (the default editor on a free plan) becomes the first one
  // it does, so the picker and the app's draft agree. It checks after every render, not only when
  // the role changes: an app that resets its draft in the same moment as the move would otherwise
  // keep the default, and send a role the plan refuses.
  const role = roles.includes(draft.role) ? draft.role : roles[0]
  useEffect(() => {
    if (role !== undefined && role !== draft.role) onDraftChange?.({ ...draft, role })
  })
  const change = (patch: Partial<InvitationDraft>) => onDraftChange?.({ ...draft, ...patch })

  if (created) {
    return (
      <div ref={createdBox} class="flex flex-col gap-4" data-e2e="invitation-created">
        <p class="text-sm">
          {!created.mailAsked
            ? t.t(`GroupInvitations.copyNow`)
            : created.mailSent
            ? t.t(`GroupInvitations.copyNowMailed`)
            : t.t(`GroupInvitations.copyNowMailFailed`)}
        </p>
        <CopyBlock
          text={created.link}
          copyLabel={t.t(`GroupInvitations.copyLink`)}
          copiedLabel={t.t(`GroupInvitations.linkCopied`)}
        />
        <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            class="min-h-11 w-full sm:min-h-9 sm:w-auto"
            onClick={onDone}
            data-e2e="invitation-done"
          >
            {t.t(`GroupInvitations.done`)}
          </Button>
        </div>
      </div>
    )
  }
  return (
    <ScreenForm pending={creating} onSubmit={onCreate}>
      <Stack data-e2e="invitation-form">
        <p class="text-sm text-muted">
          {t.t(`GroupInvitations.formHint`)}
        </p>
        <Field
          id="invitation-role"
          label={t.t(`GroupInvitations.role`)}
          hint={memberRoles ? undefined : t.t(`GroupInvitations.viewersOnly`)}
        >
          <Select
            name="role"
            data-e2e="invitation-role"
            value={String(role)}
            options={roles.map((value) => ({ value, label: roleName(t, value) }))}
            onChange={(e) => change({ role: Number(e.currentTarget.value) as GroupRole })}
          />
        </Field>
        <Field
          id="invitation-email"
          label={t.t(`GroupInvitations.email`)}
          hint={t.t(`GroupInvitations.emailHint`)}
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
            {t.t(`GroupInvitations.sendEmail`)}
          </Checkbox>
        )}
        <div class="grid grid-cols-2 gap-4">
          <Field id="invitation-days" label={t.t(`GroupInvitations.days`)}>
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
          <Field id="invitation-uses" label={t.t(`GroupInvitations.uses`)}>
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
        {addressRefusal && <AddressRefusalNotice message={addressRefusal} navigate={navigate} />}
        <ErrorState focusOnAppear message={formError} dataE2E="invitation-error" />
        {
          // On a phone the primary button is on top at full width, Cancel under it; from `sm` up
          // they are a row at the right, the primary button last.
        }
        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            href={GROUP_PATHS.members(groupId)}
            navigate={navigate}
            variant="ghost"
            class="min-h-11 w-full sm:min-h-9 sm:w-auto"
            data-e2e="invitation-cancel"
          >
            {t.t(`GroupInvitations.cancel`)}
          </Button>
          <Button
            type="submit"
            class="min-h-11 w-full sm:min-h-9 sm:w-auto"
            data-e2e="invitation-create"
            busy={creating}
            busyLabel={t.t(`GroupInvitations.creating`)}
          >
            {t.t(`GroupInvitations.create`)}
          </Button>
        </div>
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
  // main button of the section around this one ("Invite" of the members).
  useFocusAfterRemoval(
    list,
    invitations?.map((invitation) => invitation.id) ?? null,
    revokingId,
    {
      earlier: false,
      fallback: () =>
        wrapper.current?.parentElement?.closest("section")?.querySelector<HTMLElement>(
          "a[href], button",
        ),
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
  const t = useAppText()
  return (
    <section
      aria-labelledby="group-invitations"
      class="mt-3 flex flex-col gap-3"
      data-e2e="group-section-invitations"
    >
      <h3 id="group-invitations" class="text-sm font-semibold text-foreground">
        {t.t(`GroupInvitations.pending`)}
      </h3>
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
  const t = useAppText()
  const who = invitation.email ?? t.t(`GroupInvitations.anyone`)
  return (
    <li
      class="flex min-h-14 items-center gap-3 px-4 py-3 sm:px-6"
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
        <span
          class="line-clamp-2 break-words text-sm font-medium"
          title={who}
          translate={invitation.email ? false : undefined}
          data-e2e="invitation-who"
        >
          {who}
        </span>
        <span class="text-sm text-muted">
          <Rich
            parts={t.parts(
              invitation.createdBy.name.trim()
                ? `GroupInvitations.usageBy`
                : `GroupInvitations.usage`,
              {
                uses: invitation.uses,
                count: invitation.maxUses,
                date: invitation.expiresAt.slice(0, 10),
                name: invitation.createdBy.name,
              },
            )}
            tags={{
              value: (date) => <time dateTime={invitation.expiresAt}>{date}</time>,
              name: (name) => <bdi translate={false}>{name}</bdi>,
            }}
          />
        </span>
      </div>
      <span class="shrink-0 text-sm text-muted" data-e2e="invitation-role-text">
        {roleName(t, invitation.role)}
      </span>
      {canRevoke
        ? (
          <MoreMenu
            label={t.t(`GroupInvitations.actions`, { who })}
            dataE2E="invitation-menu"
          >
            <DropdownItem
              danger
              disabled={pending}
              dataE2E="invitation-revoke-open"
              onClick={() => {
                opened()
                setRevoking(true)
              }}
            >
              {t.t(`GroupInvitations.revoke`)}
            </DropdownItem>
          </MoreMenu>
        )
        : <span class="w-11 shrink-0 sm:w-9" aria-hidden="true" />}
      {revoking && (
        <ConfirmDialog
          title={t.t(`GroupInvitations.revokeTitle`)}
          confirmLabel={t.t(`GroupInvitations.revoke`)}
          cancelLabel={t.t(`GroupInvitations.cancel`)}
          tone="danger"
          dataE2E="invitation-revoke-dialog"
          onConfirm={() => {
            if (!pending) onRevoke?.(invitation.id)
          }}
          onCancel={() => setRevoking(false)}
        >
          <div class="flex flex-col gap-4">
            <p class="text-sm text-muted">
              <Rich
                parts={t.parts(
                  invitation.email
                    ? `GroupInvitations.revokeConfirmation`
                    : `GroupInvitations.revokeConfirmationLink`,
                  { email: invitation.email ?? `` },
                )}
                tags={{ value: (email) => <bdi translate={false}>{email}</bdi> }}
              />
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
  const t = useAppText()
  if (!invitation) {
    return (
      <Card>
        <EmptyState
          headingLevel={1}
          inset
          title={loading ? t.t(`GroupInvitations.opening`) : t.t(`GroupInvitations.unusable`)}
          description={loading ? undefined : error ?? undefined}
          action={!loading && (
            <Button
              href={SCREEN_PATHS.groups}
              navigate={navigate}
              variant="outline"
              class="min-h-11 sm:min-h-9"
            >
              {t.t(`GroupInvitations.toGroups`)}
            </Button>
          )}
        />
      </Card>
    )
  }
  const inviter = invitation.inviterName.trim()
  return (
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
              <Rich
                parts={t.parts(
                  inviter ? `GroupInvitations.invitedYou` : `GroupInvitations.invitedYouSomeone`,
                  { name: inviter },
                )}
                tags={{
                  name: (name) => (
                    <bdi translate={inviter ? false : undefined} data-e2e="invitation-inviter">
                      {name}
                    </bdi>
                  ),
                }}
              />
            </p>
            <h1
              class="break-words text-xl font-semibold"
              translate={false}
              data-e2e="invitation-group"
            >
              {invitation.groupName}
            </h1>
            <p class="text-sm text-muted">
              <Rich
                parts={t.parts(`GroupInvitations.asRole`, {
                  role: roleName(t, invitation.role),
                  date: invitation.expiresAt.slice(0, 10),
                })}
                tags={{
                  role: (role) => <span class="font-medium text-foreground">{role}</span>,
                  value: (date) => <time dateTime={invitation.expiresAt}>{date}</time>,
                }}
              />
            </p>
          </div>
          {invitation.forYou
            ? (
              <div class="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
                <Button
                  type="button"
                  class="min-h-11 w-full justify-center sm:min-h-9 sm:w-auto"
                  data-e2e="invitation-accept"
                  busy={answering}
                  busyLabel={t.t(`GroupInvitations.joining`)}
                  onClick={() => !answering && onAccept?.()}
                >
                  {t.t(`GroupInvitations.accept`)}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  class="min-h-11 w-full justify-center sm:min-h-9 sm:w-auto"
                  data-e2e="invitation-decline"
                  disabled={answering}
                  onClick={onDecline}
                >
                  {t.t(`GroupInvitations.decline`)}
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

/**
 * The invitations sent to the person's e-mail address, on their groups page: one row each. An
 * answered invitation's row leaves with its buttons: focus moves to the next invitation, else to
 * the first link or button of the page around the section ("New group" on the groups page).
 */
export function MyInvitationsSection(
  { invitations, answeringId = null, answerError = null, onAccept, onDecline, navigate }:
    MyInvitationsSectionProps,
): JSX.Element | null {
  const t = useAppText()
  const list = useRef<HTMLUListElement>(null)
  // The section goes with its last row, so what holds it is remembered while it is drawn.
  const around = useRef<Element | null>(null)
  useEffect(() => {
    const section = list.current?.closest("section")
    if (section) around.current = section.parentElement
  })
  useFocusAfterRemoval(list, invitations.map((invitation) => invitation.id), answeringId, {
    fallback: () => around.current?.querySelector<HTMLElement>("a[href], button"),
  })
  if (invitations.length === 0) return null
  return (
    <SettingGroup title={t.t(`GroupInvitations.forYou`)} dataE2E="my-invitations">
      <Card>
        <ul ref={list} class="divide-y divide-subtle">
          {invitations.map((invitation) => {
            const failed = answerError?.invitationId === invitation.id ? answerError : null
            const answering = answeringId === invitation.id
            const inviter = invitation.inviterName.trim()
            return (
              <li
                key={invitation.id}
                class="flex min-h-14 flex-col justify-center gap-3 px-4 py-3 sm:px-6"
                data-e2e="invitation-card"
                data-invitation-id={invitation.id}
              >
                <div class="flex flex-wrap items-center gap-3">
                  <div class="flex min-w-0 flex-1 flex-col gap-1">
                    <h3
                      class="line-clamp-2 break-words text-sm font-medium"
                      title={invitation.groupName}
                      translate={false}
                      data-e2e="invitation-group"
                    >
                      {invitation.groupName}
                    </h3>
                    <p class="text-sm text-muted">
                      <Rich
                        parts={t.parts(
                          inviter
                            ? `GroupInvitations.invitedYouAs`
                            : `GroupInvitations.invitedYouAsSomeone`,
                          { name: inviter, role: roleName(t, invitation.role) },
                        )}
                        tags={{
                          name: (name) => (
                            <bdi
                              translate={inviter ? false : undefined}
                              data-e2e="invitation-inviter"
                            >
                              {name}
                            </bdi>
                          ),
                        }}
                      />
                    </p>
                  </div>
                  {invitation.forYou && (
                    <Cluster gap="sm">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        class="min-h-11 sm:min-h-9"
                        data-e2e="invitation-decline"
                        aria-label={t.t(`GroupInvitations.declineNamed`, {
                          name: invitation.groupName,
                        })}
                        disabled={answering}
                        onClick={() => onDecline?.(invitation.id)}
                      >
                        {t.t(`GroupInvitations.decline`)}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        class="min-h-11 sm:min-h-9"
                        data-e2e="invitation-accept"
                        aria-label={t.t(`GroupInvitations.acceptNamed`, {
                          name: invitation.groupName,
                        })}
                        busy={answering}
                        busyLabel={t.t(`GroupInvitations.joining`)}
                        onClick={() => !answering && onAccept?.(invitation.id)}
                      >
                        {t.t(`GroupInvitations.acceptShort`)}
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
    </SettingGroup>
  )
}

/**
 * A create refused because the creator's own address is not verified: the API's sentence and the
 * way to the profile's Account section. It takes focus when it appears, as `PlanRefusalNotice` does.
 */
function AddressRefusalNotice(
  { message, navigate }: { message: string; navigate?: Navigate },
): JSX.Element {
  const t = useAppText()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => box.current?.focus(), [message])
  return (
    <div ref={box} tabIndex={-1} data-e2e="invitation-error">
      <Notice
        tone="danger"
        urgent
        action={
          <Button
            href={SCREEN_PATHS.email}
            navigate={navigate}
            size="sm"
            class="min-h-11 sm:min-h-9"
            data-e2e="invitation-verify-email"
          >
            {t.t(`GroupInvitations.verifyEmail`)}
          </Button>
        }
      >
        {message}
      </Notice>
    </div>
  )
}

/** Why the person cannot answer an invitation sent to another address. */
function NotForYou({ navigate }: { navigate?: Navigate }): JSX.Element {
  const t = useAppText()
  return (
    <p class="text-sm text-muted" data-e2e="invitation-not-for-you">
      <Rich
        parts={t.parts(`GroupInvitations.notForYou`)}
        tags={{
          link: (text) => (
            <Link href={SCREEN_PATHS.email} navigate={navigate} class="pc-link">{text}</Link>
          ),
        }}
      />
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
