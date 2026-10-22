import { useEffect, useState } from "preact/hooks"
import { useLocation } from "wouter-preact"
import { createOnlineStatus } from "@spy4x/preact-signals/online"
import { UnsavedGuard } from "@spy4x/preact-ui/unsaved-guard"
import { entitlementsOf } from "@domain/billing"
import { canManageInvitations, type InvitationErrorCode } from "@domain/groups"
import { SeatPriceConfirm } from "@ui/billing-screen.tsx"
import { EMPTY_INVITATION_DRAFT } from "@ui/group-invitations.tsx"
import { InvitationNewScreen } from "@ui/invitation-new-screen.tsx"
import { GuestRefusalDialog } from "@ui/guest-profile.tsx"
import { GROUP_PATHS } from "@ui/progressive.tsx"
import { billingStore } from "../state/billing.ts"
import { groupsStore } from "../state/groups.ts"
import { invitationsStore } from "../state/invitations.ts"
import { isGuestSession } from "../state/guest.ts"
import { isSpaPath } from "./spa-paths.ts"

const network = createOnlineStatus()

/**
 * Wires `/groups/:groupId/invitations/new` to the invitations store. The group's plan is read when
 * the page opens, so the role choice and the per-member price confirmation show before the submit;
 * until it is read, the server alone judges the role. The new link lives in the store only while
 * this page is open: Done and leaving both forget it, so it is shown once. Leaving earlier asks
 * first: with the form changed, "Discard your changes?"; with the link on screen, "Leave without
 * copying?".
 */
export function InvitationNewView({ groupId }: { groupId: string }) {
  const [, navigate] = useLocation()
  const invites = invitationsStore
  useEffect(() => network.watch(), [])
  const groups = groupsStore.groups.value
  const group = groups.find((candidate) => candidate.id === groupId) ?? null
  const allowed = group !== null && canManageInvitations(group.role)
  // The page starts from an empty form and no link, whatever an earlier page left in the store.
  useEffect(() => {
    invites.closeGroup()
    return () => invites.closeGroup()
  }, [groupId])
  useEffect(() => {
    if (!allowed) return
    void invites.open(groupId)
    // The group's page has read the plan already. A second read drops it until the server answers,
    // and the form would offer every role in that moment.
    if (billingStore.current.value?.groupId !== groupId) void billingStore.load(groupId)
  }, [groupId, allowed])

  const offline = !network.online.value
  const [refusedOffline, setRefusedOffline] = useState(false)
  const createFailure = invites.createError.value
  const current = billingStore.current.value
  const billing = current?.groupId === groupId ? current.billing : null
  // A create refused for want of the price confirmation shows its message at the confirmation, when
  // the confirmation is on screen; until the billing is read, it shows under the form.
  const seatRefused = !!billing?.seatPrice &&
    createFailure?.code === ("SEAT_PRICE_NOT_ACCEPTED" satisfies InvitationErrorCode)
  // The creator's own address is not verified: no field of the form can fix that, so the message
  // stands above the buttons, with the way to the profile, rather than at the invitee's address.
  const unproven = createFailure?.code === ("ADDRESS_NOT_PROVEN" satisfies InvitationErrorCode)
  const created = invites.created.value
  const draft = invites.draft.value
  // The role is left out: the form itself moves it to the first one the plan allows.
  const changed = draft.email !== EMPTY_INVITATION_DRAFT.email ||
    draft.expiresInDays !== EMPTY_INVITATION_DRAFT.expiresInDays ||
    draft.maxUses !== EMPTY_INVITATION_DRAFT.maxUses ||
    invites.acceptSeatPrice.value

  // A guest cannot invite yet (#224): the refusal shows at once, before any form is filled in.
  if (isGuestSession()) {
    return (
      <GuestRefusalDialog
        action="invite"
        navigate={navigate}
        onClose={() => navigate(GROUP_PATHS.members(groupId), { replace: true })}
      />
    )
  }

  return (
    <>
      <InvitationNewScreen
        groupId={groupId}
        group={group && { name: group.name, role: group.role }}
        // A person always has a group, so an empty list means the first read has not answered yet.
        loading={groupsStore.loading.value || groups.length === 0}
        error={groupsStore.loadError.value}
        offline={offline}
        refusedOffline={refusedOffline}
        memberRoles={billing
          ? entitlementsOf(billing.planId, billing.enabled).features.memberRoles
          : true}
        draft={draft}
        onDraftChange={(next) => (invites.draft.value = next)}
        creating={invites.creating.value}
        createError={createFailure?.plan || seatRefused || unproven ? null : createFailure?.message}
        addressRefusal={unproven ? createFailure.message : null}
        createRefusal={createFailure?.plan ?? null}
        onCreate={() => {
          setRefusedOffline(offline)
          if (offline) return
          void invites.create()
        }}
        seatPrice={billing?.seatPrice && (
          <SeatPriceConfirm
            seatPrice={billing.seatPrice}
            checked={invites.acceptSeatPrice.value}
            onChange={(checked) => (invites.acceptSeatPrice.value = checked)}
            error={seatRefused ? createFailure.message : null}
          />
        )}
        created={created}
        onDone={() => {
          invites.closeGroup()
          navigate(GROUP_PATHS.members(groupId))
        }}
        navigate={navigate}
      />
      <UnsavedGuard
        when={created !== null || (allowed && changed)}
        owns={(url) => isSpaPath(url.pathname)}
        navigate={navigate}
        labels={created
          ? {
            title: "Leave without copying?",
            message: "You will not be able to see this link again.",
            leave: "Leave",
            stay: "Stay",
          }
          : {
            title: "Discard your changes?",
            message: "This invitation is not created yet.",
            leave: "Discard changes",
            stay: "Keep editing",
          }}
        onDiscard={() => invites.closeGroup()}
      />
    </>
  )
}
