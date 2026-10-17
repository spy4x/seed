import { createPreferencesGetHandler } from "../../features/preferences/handlers.ts"
import { db } from "../../services/db.ts"

export const preferencesGetHandler = createPreferencesGetHandler({ preferences: db.preferences })
