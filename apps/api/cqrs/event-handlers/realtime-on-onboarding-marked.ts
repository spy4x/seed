import { realtime } from "@api/services/realtimeHub.ts"
import { createOnboardingHintListener } from "./user-change-hints.ts"

export const realtimeOnOnboardingMarkedHandler = createOnboardingHintListener((userId) =>
  realtime.notifyUserChange(userId)
)
