import type { CommandHandler, QueryHandler } from "@spy4x/platform/cqrs"
import type { WeeklyDigestSetting, WeeklyDigestState } from "@domain/notifications"
import type { WeeklyDigestSaveCommand } from "../../cqrs/commands.ts"
import type { WeeklyDigestGetQuery } from "../../cqrs/queries.ts"

/**
 * What the weekly digest handlers need from the app: `db.weeklyDigest` of `AppDbBase`. The files
 * under `cqrs/` pass the real one; the tests pass a fake.
 */
export interface WeeklyDigestHandlerDependencies {
  weeklyDigest: {
    read(userId: number): Promise<WeeklyDigestState>
    save(userId: number, setting: WeeklyDigestSetting): Promise<WeeklyDigestState>
  }
}

/** Answers the actor's own digest setting. */
export function createWeeklyDigestGetHandler(
  { weeklyDigest }: WeeklyDigestHandlerDependencies,
): QueryHandler<WeeklyDigestGetQuery> {
  return async ({ data: { actor } }) => await weeklyDigest.read(actor.userId)
}

/**
 * Saves the actor's digest setting and answers it as stored. The setting is always the session's
 * person's: the request carries no id, so nobody can change someone else's.
 */
export function createWeeklyDigestSaveHandler(
  { weeklyDigest }: WeeklyDigestHandlerDependencies,
): CommandHandler<WeeklyDigestSaveCommand> {
  return async ({ data: { actor, setting } }) => await weeklyDigest.save(actor.userId, setting)
}
