import type { CommandHandler, QueryHandler } from "@spy4x/platform/cqrs"
import { saveSettings, type SettingsStore } from "@spy4x/platform/universal/settings"
import { isRecord } from "@spy4x/platform/universal/is-record"
import { preferencesDefinition, type PreferencesDevice } from "@domain/identity"
import type { PreferencesDeviceCommand, PreferencesSaveCommand } from "../../cqrs/commands.ts"
import { PreferencesUpdatedEvent } from "../../cqrs/events.ts"
import type { PreferencesGetQuery } from "../../cqrs/queries.ts"

/**
 * What the preferences handlers need from the app: `db.preferences` of `AppDbBase`. The files
 * under `cqrs/` pass the real one; the tests pass a fake.
 */
export interface PreferencesHandlerDependencies {
  preferences: {
    /** The record store, keyed by the person's id. */
    store: SettingsStore
    /** Keeps the first device's zone and region format; a later one changes nothing. */
    recordFirstDevice(userId: number, device: PreferencesDevice): Promise<void>
  }
}

/** Answers the actor's own preferences, resolved: the defaults at version `0` when none. */
export function createPreferencesGetHandler(
  { preferences }: PreferencesHandlerDependencies,
): QueryHandler<PreferencesGetQuery> {
  return async ({ data: { actor } }) =>
    preferencesDefinition.resolve(await preferences.store.read(String(actor.userId)))
}

/**
 * Saves the actor's preferences. The record is always the session's person: the request carries
 * no id, so nobody can name someone else's. A save based on an older version, a value the schema
 * refuses and one over the size cap come back as the refusal, and nothing is written. The event
 * goes out after an accepted write only, so the person's other tabs read what was kept.
 */
export function createPreferencesSaveHandler(
  { preferences, emit }: PreferencesHandlerDependencies & {
    emit(event: PreferencesUpdatedEvent): void
  },
): CommandHandler<PreferencesSaveCommand> {
  return async ({ data: { actor, request } }) => {
    const owner = String(actor.userId)
    const result = await saveSettings(
      preferencesDefinition,
      preferences.store,
      owner,
      await withStoredLanguage(preferences.store, owner, request),
    )
    if (result.ok) emit(new PreferencesUpdatedEvent({ userId: actor.userId }))
    return result
  }
}

/**
 * A tab loaded before `language` existed (#216) saves a record without it. Its language is taken
 * as unchanged, the stored one, so the save goes through instead of being refused as invalid. Any
 * other request is passed on as it is, for the schema to check.
 */
async function withStoredLanguage(
  store: SettingsStore,
  owner: string,
  request: unknown,
): Promise<unknown> {
  if (!isRecord(request) || !isRecord(request.value) || `language` in request.value) return request
  const { language } = preferencesDefinition.resolve(await store.read(owner)).value
  return { ...request, value: { ...request.value, language } }
}

/** Keeps the zone and region format the actor's device reports, once (the sign-up device). */
export function createPreferencesDeviceHandler(
  { preferences }: PreferencesHandlerDependencies,
): CommandHandler<PreferencesDeviceCommand> {
  return async ({ data: { actor, device } }) => {
    await preferences.recordFirstDevice(actor.userId, device)
  }
}
