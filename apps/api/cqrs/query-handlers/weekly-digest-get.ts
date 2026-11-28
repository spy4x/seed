import { createWeeklyDigestGetHandler } from "../../features/weekly-digest/handlers.ts"
import { db } from "../../services/db.ts"

export const weeklyDigestGetHandler = createWeeklyDigestGetHandler({
  weeklyDigest: db.weeklyDigest,
})
