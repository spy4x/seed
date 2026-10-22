import { useEffect } from "preact/hooks"
import { useLocation } from "wouter-preact"
import { pageHeading } from "@spy4x/preact-system/route-announcer"
import { ONBOARDING_FAILURE, OnboardingCard } from "@ui/onboarding-card.tsx"
import { onboardingStore } from "../state/onboarding.ts"
import { selectionStore } from "../state/selection.ts"
import { isGuestSession } from "../state/guest.ts"

/**
 * The first-steps card above the notes list, where a new account lands. It reads the steps each
 * time the list opens, so a step the person did on another page is ticked when they come back,
 * and follows hints only while it is on the page. After Dismiss the card leaves
 * and focus moves to the page's `<h1>`, the element a route change moves focus to.
 */
export function OnboardingView({ store = onboardingStore }: { store?: typeof onboardingStore }) {
  const [, navigate] = useLocation()
  useEffect(() => {
    // Without an answer there is no card; the next visit to the notes asks again.
    void store.open().catch(() => {})
    // A tour left by following one of its links is closed, and still offered on the next visit.
    return store.close
  }, [])
  const status = store.status.value
  if (!status || !store.visible.value) return null
  const error = store.error.value
  return (
    <OnboardingCard
      steps={status.steps}
      groupId={selectionStore.groupId.value}
      navigate={navigate}
      guest={isGuestSession()}
      onDismiss={() => {
        // The card hides at once, before the server answers, so focus moves now.
        void store.dismiss()
        if (!store.visible.value) pageHeading()?.focus()
      }}
      error={error === null ? null : error || ONBOARDING_FAILURE}
      tourOffered={store.tourOffered.value}
      tourOpen={store.tourOpen.value}
      tourIndex={store.tourIndex.value}
      onTourStart={store.startTour}
      onTourIndexChange={(index) => store.tourIndex.value = index}
      onTourEnd={() => void store.endTour()}
    />
  )
}
