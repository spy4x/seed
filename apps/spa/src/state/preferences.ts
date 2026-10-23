import { computed, effect, signal } from "@preact/signals"
import { createSettingsStore, type SettingsSaveOutcome } from "@spy4x/preact-signals/settings"
import { syncThemeWithSettings, type ThemeStore } from "@spy4x/preact-signals/theme"
import type {
  SettingsSaveResult,
  StoredSettings,
  VersionedSettings,
} from "@spy4x/platform/universal/settings"
import { createFormatters, type DeviceFormat, deviceFormat } from "@spy4x/time/format"
import { type Preferences, preferencesDefinition } from "@domain/identity"
import { callCommand, callQuery } from "../modules.ts"
import { themeStore } from "./theme.ts"

/** What a screen reader hears when another device changed the preferences on screen. */
export const PREFERENCES_UPDATED_ELSEWHERE = `Preferences updated from another device.`

/** The fields the "Language and region" dialog saves together. */
export type RegionDraft = Pick<Preferences, `locale` | `timeZone` | `hourCycle`>

/**
 * What a save from the dialog came to. `offline`: the device has no connection, so nothing was
 * sent. `failed`: the server could not be reached in time; the save may still arrive, and it lands
 * only on the version it was based on.
 */
export type DraftSaveOutcome =
  | { ok: true }
  | { ok: false; reason: `conflict`; current: VersionedSettings<Preferences> }
  | { ok: false; reason: `invalid` | `offline` | `failed` }

/** What the preferences store needs from the outside. Injected so tests need no socket. */
export interface PreferencesDependencies {
  query<T>(name: string): Promise<T>
  command<T>(name: string, payload: unknown): Promise<T>
  /** The page's theme store; the stored theme follows the person to every device through it. */
  theme: ThemeStore
  /** This device's region format and zone, read again on every refresh (a traveller's moves). */
  device(): DeviceFormat
  /**
   * The device zone the person chose to ignore ("Keep Berlin time"), so the row stops offering it
   * until the device moves to yet another zone. Kept on this device only, and cleared on sign-out.
   */
  keptZone: { read(): string | null; write(zone: string | null): void }
  /** Whether the device has a connection now; a dialog save is refused at once without one. */
  online(): boolean
}

/**
 * The person's display preferences (#163): theme, region format, time zone and clock, kept on the
 * server and followed by every device. preact-components' settings store holds the record and
 * saves optimistically; the theme store keeps its own copy for the paint before sign-in and syncs
 * through it. {@link format} is the one formatter every screen reads.
 *
 * A hint that the person changed something in another tab reads the record again; when that brings
 * a newer version this device did not save, {@link announcement} says so for a screen reader.
 */
export function createPreferencesState(dependencies: PreferencesDependencies) {
  const store = createSettingsStore<Preferences>(preferencesDefinition, {
    load: () => dependencies.query<StoredSettings | null>(`preferences.get`),
    save: (request) =>
      dependencies.command<SettingsSaveResult<unknown>>(`preferences.save`, request),
  })
  syncThemeWithSettings(dependencies.theme, store, `theme`)

  const device = signal<DeviceFormat>(dependencies.device())
  const kept = signal<string | null>(dependencies.keptZone.read())
  const announcement = signal(``)
  /** The record that won when a dialog save was refused: its draft was made on an older one. */
  const draftConflict = signal<VersionedSettings<Preferences> | null>(null)
  /**
   * The versions this device saved. A hint for one of them is this device's own change, whatever
   * order the hint and the save's answer arrive in, so it is never announced.
   */
  const own = new Set<number>()
  /** Dialog saves on their way or waiting their turn: a record read meanwhile may be one of them. */
  let drafting = 0
  /** The last dialog draft not yet answered: shown at once, as the store shows its own saves. */
  const draft = signal<RegionDraft | null>(null)
  /** Dialog saves go out one at a time, each after the answer to the one before. */
  let queue: Promise<unknown> = Promise.resolve()
  /**
   * The version each of this device's dialog saves was made on, mapped to the version its answer
   * made. A draft made while an earlier one was on its way was built on what that one saved, so it
   * is sent on the version that one made, not refused as if another device had saved meanwhile.
   */
  const saved = new Map<number, number>()
  let wasSaving = false
  // Every save of the store (the theme, "Use Tokyo time") ends with the version it made held.
  effect(() => {
    const saving = store.saving.value
    if (wasSaving && !saving) own.add(store.record.peek().version)
    wasSaving = saving
  })

  /** The record with every change still on its way: the store's own saves and the dialog's. */
  const shown = computed<Preferences>(() =>
    draft.value ? { ...store.value.value, ...draft.value } : store.value.value
  )

  /** Every date and time on screen, in the person's settings. */
  const format = computed(() => createFormatters(shown.value, { device: device.value }))

  /**
   * This device's zone when the person pinned another one and has not chosen to keep it: the Time
   * zone row then offers to switch. `null` when the zone is automatic, or the two agree.
   */
  const otherZone = computed(() => {
    const chosen = shown.value.timeZone
    const here = device.value.timeZone
    if (chosen === null || chosen === here || kept.value === here) return null
    return here
  })

  /** Counts the sign-outs, so a read sent for the person before never touches the next one. */
  let person = 0

  /**
   * Reads the record again: at start-up, after a reconnect, and after a hint that the person
   * changed something in another tab. Rejects when the server cannot be reached.
   */
  async function refresh(): Promise<void> {
    const signedIn = person
    const wasLoaded = store.loaded.peek()
    const before = store.record.peek().version
    device.value = dependencies.device()
    await store.load()
    if (signedIn !== person) return
    // Only a newer record this device did not make, read while nothing of it was waiting, came
    // from another device.
    const now = store.record.peek().version
    if (wasLoaded && now > before && !own.has(now) && !store.saving.peek() && drafting === 0) {
      announcement.value = PREFERENCES_UPDATED_ELSEWHERE
    }
  }

  /**
   * The person signed in: tell the server this device's zone, which it keeps from the first device
   * only (the sign-up device), to show operators. The pull that follows the start reads the record.
   */
  function start(): void {
    void dependencies.command(`preferences.device`, dependencies.device()).catch(() => {})
  }

  /** Saves a change. Shown at once; the outcome says whether the server kept it. */
  function save(patch: Partial<Preferences>): Promise<SettingsSaveOutcome<Preferences>> {
    announcement.value = ``
    return store.save(patch)
  }

  /**
   * Saves the dialog's draft on the version it was made on, so a change another device saved
   * meanwhile is never overwritten: the server refuses it, and {@link conflict} holds the record
   * that won. Without a connection nothing is sent. The draft shows at once; a second one made
   * before the first is answered waits for that answer and is sent on the version it made.
   */
  function saveDraft(baseVersion: number, next: RegionDraft): Promise<DraftSaveOutcome> {
    announcement.value = ``
    draftConflict.value = null
    if (!dependencies.online()) return Promise.resolve({ ok: false, reason: `offline` })
    const checked = preferencesDefinition.parse({ ...store.value.peek(), ...next })
    if (!checked.ok) return Promise.resolve({ ok: false, reason: `invalid` })
    const signedIn = person
    drafting++
    draft.value = next
    const turn = queue.then(() => sendDraft(signedIn, baseVersion, checked.value)).finally(() => {
      if (--drafting > 0 || signedIn !== person) return
      draft.value = null
      saved.clear()
    })
    queue = turn.catch(() => {})
    return turn
  }

  /** Sends one dialog draft; {@link saveDraft} runs these one after another. */
  async function sendDraft(
    signedIn: number,
    baseVersion: number,
    value: Preferences,
  ): Promise<DraftSaveOutcome> {
    if (signedIn !== person) return { ok: false, reason: `failed` }
    let version = baseVersion
    while (saved.has(version)) version = saved.get(version)!
    let answer: SettingsSaveResult<unknown>
    try {
      answer = await dependencies.command<SettingsSaveResult<unknown>>(`preferences.save`, {
        version,
        value,
      })
    } catch (_error) {
      return { ok: false, reason: `failed` }
    }
    if (signedIn !== person) return { ok: false, reason: `failed` }
    if (answer.ok) {
      const record = preferencesDefinition.resolve(answer.settings)
      own.add(record.version)
      saved.set(version, record.version)
      store.apply(answer.settings)
      return { ok: true }
    }
    if (answer.reason === `conflict`) {
      const current = preferencesDefinition.resolve(answer.current)
      store.apply(answer.current)
      draftConflict.value = current
      return { ok: false, reason: `conflict`, current }
    }
    return { ok: false, reason: `invalid` }
  }

  /** "Use Tokyo time": this device's zone becomes the person's zone on every device. */
  function useDeviceZone(): Promise<SettingsSaveOutcome<Preferences>> {
    return save({ timeZone: device.value.timeZone })
  }

  /** "Keep Berlin time": stop offering this device's zone until the device moves again. */
  function keepZone(): void {
    kept.value = device.value.timeZone
    dependencies.keptZone.write(kept.value)
  }

  /** Signing out: nothing of the person stays in memory or on the device but the theme. */
  function reset(): void {
    person++
    store.reset()
    own.clear()
    saved.clear()
    draft.value = null
    draftConflict.value = null
    announcement.value = ``
    kept.value = null
    dependencies.keptZone.write(null)
  }

  return {
    /** The record with any change still on its way: what the screen shows. */
    value: shown,
    loaded: store.loaded,
    saving: store.saving,
    /** The version the shown record has; a dialog's draft is saved on it. */
    version: computed(() => store.record.value.version),
    /** The record that won when this device's save was refused; cleared by the next save. */
    conflict: computed(() => draftConflict.value ?? store.conflict.value),
    dismissConflict: () => {
      draftConflict.value = null
      store.dismissConflict()
    },
    device,
    otherZone,
    format,
    announcement,
    start,
    refresh,
    save,
    saveDraft,
    useDeviceZone,
    keepZone,
    reset,
  }
}

export type PreferencesState = ReturnType<typeof createPreferencesState>

const KEPT_ZONE_KEY = `preferences:kept-zone`

/** The device's copy of "Keep Berlin time": `localStorage`, or nothing when the browser blocks it. */
const browserKeptZone = {
  read(): string | null {
    try {
      return localStorage.getItem(KEPT_ZONE_KEY)
    } catch (_error) {
      return null
    }
  },
  write(zone: string | null): void {
    try {
      if (zone === null) localStorage.removeItem(KEPT_ZONE_KEY)
      else localStorage.setItem(KEPT_ZONE_KEY, zone)
    } catch (_error) {
      // Blocked storage: the row offers the device's zone again on the next start.
    }
  },
}

/** The page's own store, over the socket. */
export const preferencesState = createPreferencesState({
  query: (name) => callQuery(name),
  command: (name, payload) => callCommand(name, payload),
  theme: themeStore,
  device: deviceFormat,
  keptZone: browserKeptZone,
  online: () => globalThis.navigator?.onLine !== false,
})
