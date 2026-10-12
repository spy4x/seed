import { createOnboardingMarkHandler } from "../../features/onboarding/handlers.ts"
import { db } from "../../services/db.ts"
import { eventBus } from "../../services/eventBus.ts"

export const onboardingMarkHandler = createOnboardingMarkHandler({
  onboarding: db.onboarding,
  emit: (event) => eventBus.emit(event),
})
