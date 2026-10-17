import { createPreferencesSaveHandler } from "../../features/preferences/handlers.ts"
import { db } from "../../services/db.ts"
import { eventBus } from "../../services/eventBus.ts"

export const preferencesSaveHandler = createPreferencesSaveHandler({
  preferences: db.preferences,
  emit: (event) => eventBus.emit(event),
})
