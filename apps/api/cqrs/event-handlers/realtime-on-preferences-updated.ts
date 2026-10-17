import { realtime } from "@api/services/realtimeHub.ts"
import { createPreferencesHintListener } from "./user-change-hints.ts"

export const realtimeOnPreferencesUpdatedHandler = createPreferencesHintListener((userId) =>
  realtime.notifyUserChange(userId)
)
