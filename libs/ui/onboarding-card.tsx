import type { JSX } from "preact"
import { useLayoutEffect, useRef } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Stack } from "@spy4x/preact-ui/layout"
import { OnboardingChecklist, type OnboardingStep } from "@spy4x/preact-ui/onboarding-checklist"
import { Tour, type TourStep } from "@spy4x/preact-ui/tour"
import type { OnboardingSteps } from "@domain/identity"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { useAppText } from "./i18n.ts"
import { GUEST_PATHS, KEEP_LABEL, KEEP_STEP } from "./guest-screens.tsx"
import {
  GROUP_PATHS,
  type Navigate,
  NOTE_PATHS,
  profilePath,
  SCREEN_PATHS,
} from "./progressive.tsx"

/**
 * Shown when closing the card or the tour could not be saved and the server gave no message, by its
 * key in the `app` catalog.
 */
export const ONBOARDING_FAILURE = `OnboardingCard.failed`

/**
 * The first steps in the order a new person takes them, each with the link to the page that does
 * it. `groupId` is the person's selected group, where an invitation is made; without one the
 * step opens the groups page. For a guest (#224) the e-mail step is "Keep your account", and
 * the invitation and notification steps wait until the account is kept, since both are refused.
 * The words are `t`'s.
 */
export function onboardingSteps(
  t: Translator<string>,
  steps: OnboardingSteps,
  groupId: string | null,
  navigate?: Navigate,
  guest = false,
): OnboardingStep[] {
  const all: OnboardingStep[] = [
    {
      id: "email",
      title: t.t(`OnboardingCard.emailTitle`),
      description: t.t(`OnboardingCard.emailText`),
      done: steps.emailVerified,
      action: { label: t.t(`OnboardingCard.emailAction`), href: SCREEN_PATHS.email, navigate },
    },
    {
      id: "note",
      title: t.t(`OnboardingCard.noteTitle`),
      description: t.t(`OnboardingCard.noteText`),
      done: steps.noteCreated,
      action: { label: t.t(`OnboardingCard.noteAction`), href: NOTE_PATHS.new, navigate },
    },
    {
      id: "invite",
      title: t.t(`OnboardingCard.inviteTitle`),
      description: t.t(`OnboardingCard.inviteText`),
      done: steps.memberInvited,
      action: {
        label: t.t(`OnboardingCard.inviteAction`),
        href: groupId ? GROUP_PATHS.members(groupId) : SCREEN_PATHS.groups,
        navigate,
      },
    },
    {
      id: "notifications",
      title: t.t(`OnboardingCard.notificationsTitle`),
      description: t.t(`OnboardingCard.notificationsText`),
      done: steps.notificationsOn,
      action: {
        label: t.t(`OnboardingCard.notificationsAction`),
        href: profilePath("notifications"),
        navigate,
      },
    },
    {
      id: "two-factor",
      title: t.t(`OnboardingCard.twoFactorTitle`),
      description: t.t(`OnboardingCard.twoFactorText`),
      done: steps.twoFactorOn,
      action: {
        label: t.t(`OnboardingCard.twoFactorAction`),
        href: profilePath("security"),
        navigate,
      },
    },
  ]
  if (!guest) return all
  const keep: OnboardingStep = {
    id: "keep",
    title: KEEP_STEP.title,
    description: KEEP_STEP.text,
    done: false,
    action: { label: KEEP_LABEL, href: GUEST_PATHS.keep, navigate },
  }
  return [keep, ...all.filter((step) => step.id === "note")]
}

/** The link of the side navigation that opens `href`; hidden on a phone, where a step is a sheet. */
const railLink = (href: string) => `[data-e2e="rail-shell-rail"] a[href="${href}"]`

/** A control of the rail's bottom zone: the Notifications cell or the account trigger. */
const railBottom = (selector: string) => `[data-e2e="rail-shell-bottom"] ${selector}`

/** The tour: the main screens, each shown by the control that opens it, in `t`'s words. */
export function tourSteps(t: Translator<string>): TourStep[] {
  return [
    {
      id: "notes",
      target: railLink(NOTE_PATHS.list),
      title: t.t(`OnboardingCard.tourNotesTitle`),
      body: t.t(`OnboardingCard.tourNotesText`),
      placement: "right",
    },
    {
      id: "groups",
      target: railLink(SCREEN_PATHS.groups),
      title: t.t(`OnboardingCard.tourGroupsTitle`),
      body: t.t(`OnboardingCard.tourGroupsText`),
      placement: "right",
    },
    {
      id: "notifications",
      target: railBottom(`a[href="${SCREEN_PATHS.notifications}"]`),
      title: t.t(`OnboardingCard.tourNotificationsTitle`),
      body: t.t(`OnboardingCard.tourNotificationsText`),
      placement: "right",
    },
    {
      id: "profile",
      target: railBottom(`[data-e2e="account-menu-button"]`),
      title: t.t(`OnboardingCard.tourProfileTitle`),
      body: t.t(`OnboardingCard.tourProfileText`),
      placement: "right",
    },
  ]
}

/**
 * The tour's Go to button, named by the place only: the account button's name goes on with the
 * person's address ("Account: ada@example.com"), which would wrap the button to two lines.
 */
export function tourGoToLabel(t: Translator<string>, targetName: string): string {
  const place = targetName.split(`:`)[0].trim()
  return place ? t.t(`OnboardingCard.goTo`, { place }) : t.t(`OnboardingCard.goToHighlighted`)
}

/** What {@link OnboardingCard} takes. */
export interface OnboardingCardProps {
  /** Which first steps the person's own data says are done. */
  steps: OnboardingSteps
  /** The person's selected group, for the invitation step's link. */
  groupId: string | null
  /** The app's router, for the steps that open another page. */
  navigate?: Navigate
  /** The person is a guest (#224): the steps lead to keeping the account first. */
  guest?: boolean
  /** Called by Dismiss and, once every step is done, by Finish. The app stops rendering the card. */
  onDismiss: () => void
  /**
   * Why the last Dismiss or tour answer was not saved, shown under the card: {@link ONBOARDING_FAILURE}
   * or the server's own message.
   */
  error?: string | null
  /** Whether the tour is still offered: the person has neither finished nor skipped it. */
  tourOffered: boolean
  /** Whether the tour is running. */
  tourOpen: boolean
  /** The tour step shown. */
  tourIndex: number
  /** Called by "Take the tour". */
  onTourStart: () => void
  /** Called by the tour's Next and Back. */
  onTourIndexChange: (index: number) => void
  /**
   * Called when the tour is over: Done, Skip, × or Escape in the tour, or "Skip the tour" on the
   * card. The app closes the tour and stops offering it.
   */
  onTourEnd: () => void
}

/**
 * The first-steps card of the home page: preact-components' `OnboardingChecklist` over this
 * template's five steps, and its `Tour` over the main screens. It holds no state: the steps tick
 * themselves from `steps`, and the app owns what is dismissed and where the tour stands.
 *
 * The tour is offered on the card, never opened unasked. Every way out of the tour ("Skip the
 * tour" on the card; Done, Skip tour, Close and Escape in the tour) moves focus to the card's
 * heading. The library would hand focus back to "Take the tour", which leaves with the offer, or to
 * the step's target, which a narrow window hides, so focus would be lost there.
 */
export function OnboardingCard(
  {
    steps,
    groupId,
    navigate,
    guest = false,
    onDismiss,
    error = null,
    tourOffered,
    tourOpen,
    tourIndex,
    onTourStart,
    onTourIndexChange,
    onTourEnd,
  }: OnboardingCardProps,
): JSX.Element {
  const card = useRef<HTMLDivElement>(null)
  const t = useAppText()
  /** Set when the person ends the tour: the control that had focus is about to leave the page. */
  const ended = useRef(false)
  const end = () => {
    ended.current = true
    onTourEnd()
  }

  // After the library's own hand-back, which runs first (a child's layout effect).
  useLayoutEffect(() => {
    if (!ended.current || tourOpen) return
    ended.current = false
    card.current?.querySelector<HTMLElement>(`[role="region"] h2`)?.focus()
  }, [tourOffered, tourOpen])

  return (
    <div ref={card} data-e2e="onboarding">
      <Stack gap="sm">
        <OnboardingChecklist
          title={t.t(`OnboardingCard.title`)}
          steps={onboardingSteps(t, steps, groupId, navigate, guest)}
          onDismiss={onDismiss}
          description={tourOffered
            ? (
              <span
                class="inline-flex flex-wrap items-center gap-2"
                data-e2e="onboarding-tour-offer"
              >
                {t.t(`OnboardingCard.tourOffer`)}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onTourStart}
                  data-e2e="onboarding-tour-start"
                >
                  {t.t(`OnboardingCard.tourStart`)}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={end}
                  data-e2e="onboarding-tour-skip"
                >
                  {t.t(`OnboardingCard.tourSkip`)}
                </Button>
              </span>
            )
            : undefined}
        />
        <ErrorState
          message={error === ONBOARDING_FAILURE ? t.t(ONBOARDING_FAILURE) : error}
          dataE2E="onboarding-error"
        />
      </Stack>
      <Tour
        steps={tourSteps(t)}
        open={tourOpen}
        index={tourIndex}
        onIndexChange={onTourIndexChange}
        onClose={end}
        goToLabel={(name) => tourGoToLabel(t, name)}
      />
    </div>
  )
}
