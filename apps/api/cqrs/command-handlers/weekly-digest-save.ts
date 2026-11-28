import { createWeeklyDigestSaveHandler } from "../../features/weekly-digest/handlers.ts"
import { db } from "../../services/db.ts"

export const weeklyDigestSaveHandler = createWeeklyDigestSaveHandler({
  weeklyDigest: db.weeklyDigest,
})
