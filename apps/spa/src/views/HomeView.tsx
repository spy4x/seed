import { useEffect } from "preact/hooks"
import { useLocation } from "wouter-preact"
import { LoadingSpinner } from "@spy4x/preact-ui/loading-spinner"
import {
  freePlanAllowsNothing,
  type GroupBilling,
  needsFirstPlan,
  type Plan,
  PLANS,
} from "@domain/billing"
import { GroupRole } from "@domain/groups"
import { GROUP_PATHS, homePath, SCREEN_PATHS } from "@ui/progressive.tsx"
import { useAppText } from "@ui/i18n.ts"
import { billingStore } from "../state/billing.ts"
import { groupsStore } from "../state/groups.ts"
import { selectionStore } from "../state/selection.ts"
import { sessionState } from "../state/session.ts"
import { isGuestSession } from "../state/guest.ts"
import { notesOn } from "../modules.ts"

/** What {@link landingPath} decides from. */
export interface Landing {
  /** The person is signed in. */
  signedIn: boolean
  /** The person is a guest, who cannot pay. */
  guest: boolean
  /** Every group the person belongs to with their role, or `null` until the list is read. */
  groups: readonly { id: string; role: GroupRole }[] | null
  /** The selected group, or `null` until it is known. */
  selectedGroupId: string | null
  /**
   * The selected group's billing: `undefined` while it is read, `null` when it could not be read.
   */
  billing: GroupBilling | null | undefined
  /** The plan catalog, `PLANS` unless a test passes its own. */
  plans?: readonly Plan[]
  /** Whether the notes example is on (`SPA_NOTES`); left out, it is. Off, home is the overview. */
  notes?: boolean
}

/**
 * Where the app's home sends a person, or `null` while it cannot tell yet. Without a `next`, every
 * sign-in lands here. When the free plan allows nothing, the owner of a group that never paid opens
 * its Billing tab, so their first screen is not a row of refusals; anyone else, and everyone under
 * a free plan that allows something, opens the app's first page ({@link homePath}): the notes, or
 * the overview when the product turns the notes off.
 *
 * A person in any group they do not own came for that group, so they never meet the plan, even
 * though sign-up gave them an empty first group of their own. A guest cannot pay. A billing that
 * could not be read opens the first page rather than leave the person on a spinner.
 */
export function landingPath(landing: Landing): string | null {
  const plans = landing.plans ?? PLANS
  const home = homePath(landing.notes)
  if (!landing.signedIn) return SCREEN_PATHS.signIn
  if (!freePlanAllowsNothing(plans) || landing.guest) return home
  if (landing.groups === null) return null
  if (landing.groups.some((group) => group.role !== GroupRole.OWNER)) return home
  if (landing.groups.length === 0) return home
  if (landing.selectedGroupId === null) return null
  if (landing.billing === undefined) return null
  return landing.billing !== null && needsFirstPlan(landing.billing, plans)
    ? GROUP_PATHS.billing(landing.selectedGroupId)
    : home
}

/**
 * `/`, the app's home: where sign-in lands without a `next`, and where the rail's logo goes. It
 * draws nothing of its own and replaces itself with {@link landingPath}'s answer, so Back never
 * returns here.
 */
export function HomeView() {
  const [, navigate] = useLocation()
  const t = useAppText()
  const signedIn = sessionState.value.user !== null
  const groupId = selectionStore.groupId.value
  const asks = signedIn && freePlanAllowsNothing() && !isGuestSession()
  useEffect(() => {
    if (asks && groupId !== null) void billingStore.load(groupId)
  }, [asks, groupId])
  const current = billingStore.current.value
  const failure = billingStore.error.value
  const target = landingPath({
    signedIn,
    guest: isGuestSession(),
    groups: groupsStore.loading.value ? null : groupsStore.groups.value,
    selectedGroupId: groupId,
    notes: notesOn(),
    billing: current?.groupId === groupId
      ? current.billing
      : failure?.groupId === groupId
      ? null
      : undefined,
  })
  useEffect(() => {
    if (target !== null) navigate(target, { replace: true })
  }, [target])
  return <LoadingSpinner size="lg" label={t.t(`HomeView.opening`)} class="min-h-[50vh]" />
}
