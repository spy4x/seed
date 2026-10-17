import { createPreferencesDeviceHandler } from "../../features/preferences/handlers.ts"
import { db } from "../../services/db.ts"

export const preferencesDeviceHandler = createPreferencesDeviceHandler({
  preferences: db.preferences,
})
