import type { Actor, Preferences, VersionedPreferences } from "@domain/identity"
import { preferencesDeviceSchema } from "@domain/identity"
import type { Operations } from "@spy4x/realtime/operations"
import { expectNoPayload, parsePayload } from "@spy4x/realtime"
import type { SettingsSaveResult } from "@spy4x/platform/universal/settings"
import { PreferencesDeviceCommand, PreferencesSaveCommand } from "../../cqrs/commands.ts"
import { PreferencesGetQuery } from "../../cqrs/queries.ts"

/** What the preferences operations need from the app. */
export interface PreferencesOperationDependencies {
  get(query: PreferencesGetQuery): Promise<VersionedPreferences>
  save(command: PreferencesSaveCommand): Promise<SettingsSaveResult<Preferences>>
  device(command: PreferencesDeviceCommand): Promise<void>
}

/**
 * `preferences.get`, `preferences.save` and `preferences.device`, over the socket and
 * `POST /api/call/<name>`. The person is always the session's, never named in the payload. A save's
 * payload is `{ version, value }` and is checked by the handler, which answers a refusal (a
 * conflict, an invalid value) as data, so the page can show the record that won.
 */
export function createPreferencesOperations(
  dependencies: PreferencesOperationDependencies,
): Operations<Actor> {
  return {
    "preferences.get": {
      kind: "query",
      handle: async ({ actor, payload }) => {
        expectNoPayload(payload)
        return await dependencies.get(new PreferencesGetQuery({ actor }))
      },
    },
    "preferences.save": {
      kind: "command",
      handle: async ({ actor, payload, idempotencyKey }) =>
        await dependencies.save(
          new PreferencesSaveCommand({ actor, request: payload, idempotencyKey }),
        ),
    },
    "preferences.device": {
      kind: "command",
      handle: async ({ actor, payload, idempotencyKey }) => {
        const device = parsePayload(preferencesDeviceSchema, payload)
        await dependencies.device(new PreferencesDeviceCommand({ actor, device, idempotencyKey }))
        return null
      },
    },
  }
}
