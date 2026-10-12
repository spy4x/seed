import { createOnboardingGetHandler } from "../../features/onboarding/handlers.ts"
import { db } from "../../services/db.ts"

export const onboardingGetHandler = createOnboardingGetHandler({ onboarding: db.onboarding })
