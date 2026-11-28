import type { Actor } from "@domain/identity"
import { weeklyDigestSettingSchema, type WeeklyDigestState } from "@domain/notifications"
import type { Operations } from "@spy4x/realtime/operations"
import { expectNoPayload, parsePayload } from "@spy4x/realtime"
import { WeeklyDigestSaveCommand } from "../../cqrs/commands.ts"
import { WeeklyDigestGetQuery } from "../../cqrs/queries.ts"

/** What the weekly digest operations need from the app. */
export interface WeeklyDigestOperationDependencies {
  get(query: WeeklyDigestGetQuery): Promise<WeeklyDigestState>
  save(command: WeeklyDigestSaveCommand): Promise<WeeklyDigestState>
}

/**
 * `weekly-digest.get` and `weekly-digest.save`, over the socket and `POST /api/call/<name>`. The
 * person is always the session's, never named in the payload. A save's payload is `{ on: false }`
 * or `{ on: true, weekday, hour, timeZone }` (`weeklyDigestSettingSchema`); anything else is
 * refused as invalid before a command is made.
 */
export function createWeeklyDigestOperations(
  dependencies: WeeklyDigestOperationDependencies,
): Operations<Actor> {
  return {
    "weekly-digest.get": {
      kind: "query",
      handle: async ({ actor, payload }) => {
        expectNoPayload(payload)
        return await dependencies.get(new WeeklyDigestGetQuery({ actor }))
      },
    },
    "weekly-digest.save": {
      kind: "command",
      handle: async ({ actor, payload, idempotencyKey }) => {
        const setting = parsePayload(weeklyDigestSettingSchema, payload)
        return await dependencies.save(
          new WeeklyDigestSaveCommand({ actor, setting, idempotencyKey }),
        )
      },
    },
  }
}
