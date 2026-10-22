import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { RealtimeRequestError } from "@spy4x/realtime"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import type { SettingsStore, StoredSettings } from "@spy4x/platform/universal/settings"
import {
  DEFAULT_PREFERENCES,
  type Preferences,
  type PreferencesDevice,
  UserMFAStatus,
} from "@domain/identity"
import { PreferencesDeviceCommand, PreferencesSaveCommand } from "../../cqrs/commands.ts"
import type { PreferencesUpdatedEvent } from "../../cqrs/events.ts"
import {
  createPreferencesDeviceHandler,
  createPreferencesGetHandler,
  createPreferencesSaveHandler,
} from "./handlers.ts"
import { createPreferencesOperations } from "./operations.ts"

const actorOf = (userId: number) => ({
  userId,
  userMfa: UserMFAStatus.NOT_CONFIGURED,
  sessionSecondFactor: SecondFactorStatus.NotRequired,
})
const actor = actorOf(7)
const signal = new AbortController().signal
const berlin: Preferences = {
  theme: `dark`,
  locale: `de-DE`,
  timeZone: `Europe/Berlin`,
  hourCycle: `h23`,
  overview: [],
}

/** `db.preferences` in memory: one row per person, the write a compare-and-set like the SQL. */
function memory() {
  const rows = new Map<string, StoredSettings>()
  const devices = new Map<number, PreferencesDevice>()
  const store: SettingsStore = {
    read: (owner) => Promise.resolve(rows.get(owner) ?? null),
    write: (owner, expected, next) => {
      if ((rows.get(owner)?.version ?? 0) !== expected) return Promise.resolve(false)
      rows.set(owner, next)
      return Promise.resolve(true)
    },
  }
  const recordFirstDevice = (userId: number, device: PreferencesDevice) => {
    if (!devices.has(userId)) devices.set(userId, device)
    return Promise.resolve()
  }
  return { rows, devices, preferences: { store, recordFirstDevice } }
}

function harness() {
  const { preferences, rows, devices } = memory()
  const hints: number[] = []
  const emit = (event: PreferencesUpdatedEvent) => hints.push(event.data.userId)
  const get = createPreferencesGetHandler({ preferences })
  const save = createPreferencesSaveHandler({ preferences, emit })
  const device = createPreferencesDeviceHandler({ preferences })
  const requests = createPreferencesOperations({
    get: (query) => get(query),
    save: (command) => save(command),
    device: (command) => device(command),
  })
  const call = (name: string, payload: unknown, as = actor) =>
    Promise.resolve(
      requests[name].handle({
        actor: as,
        requestId: `req`,
        signal,
        idempotencyKey: `key`,
        payload,
      }),
    )
  return { requests, call, rows, devices, hints }
}

describe(`preferences operations`, () => {
  it(`declares get as a query, and save and device as commands`, () => {
    const { requests } = harness()

    expect(requests[`preferences.get`].kind).toBe(`query`)
    expect(requests[`preferences.save`].kind).toBe(`command`)
    expect(requests[`preferences.device`].kind).toBe(`command`)
  })

  it(`answers the defaults at version 0 to a person who never saved`, async () => {
    const { call } = harness()

    expect(await call(`preferences.get`, undefined)).toEqual({
      version: 0,
      value: DEFAULT_PREFERENCES,
    })
  })

  it(`refuses a payload on get, so a read cannot name another person`, async () => {
    const { call } = harness()

    const failure = await call(`preferences.get`, { userId: 8 }).catch((error) => error)

    expect(failure).toBeInstanceOf(RealtimeRequestError)
    expect((failure as RealtimeRequestError).code).toBe(`bad_request`)
  })

  it(`saves on the version read, answers the next one and hints the person's other tabs`, async () => {
    const { call, hints } = harness()

    const result = await call(`preferences.save`, { version: 0, value: berlin })

    expect(result).toEqual({ ok: true, settings: { version: 1, value: berlin } })
    expect(await call(`preferences.get`, undefined)).toEqual({ version: 1, value: berlin })
    expect(hints).toEqual([7])
  })

  it(`refuses a save made on an older version with the record that won, and writes nothing`, async () => {
    const { call, hints } = harness()
    await call(`preferences.save`, { version: 0, value: berlin })

    const result = await call(`preferences.save`, {
      version: 0,
      value: { ...DEFAULT_PREFERENCES, theme: `light` },
    })

    expect(result).toEqual({
      ok: false,
      reason: `conflict`,
      current: { version: 1, value: berlin },
    })
    expect(await call(`preferences.get`, undefined)).toEqual({ version: 1, value: berlin })
    expect(hints).toEqual([7])
  })

  it(`refuses an unknown zone as invalid and writes nothing`, async () => {
    const { call, rows, hints } = harness()

    const result = await call(`preferences.save`, {
      version: 0,
      value: { ...berlin, timeZone: `Mars/Olympus_Mons` },
    }) as { ok: boolean; reason: string }

    expect(result.ok).toBe(false)
    expect(result.reason).toBe(`invalid`)
    expect(rows.size).toBe(0)
    expect(hints).toEqual([])
  })

  it(`writes only the session's person, whatever id the payload names`, async () => {
    const { call, rows } = harness()

    await call(`preferences.save`, { version: 0, value: berlin, userId: 8 })

    expect([...rows.keys()]).toEqual([`7`])
    expect(await call(`preferences.get`, undefined, actorOf(8))).toEqual({
      version: 0,
      value: DEFAULT_PREFERENCES,
    })
  })

  it(`keeps the first device's zone and format, and a later device changes nothing`, async () => {
    const { call, devices } = harness()

    await call(`preferences.device`, { timeZone: `Asia/Bangkok`, locale: `th-TH` })
    await call(`preferences.device`, { timeZone: `Europe/Berlin`, locale: `de-DE` })

    expect(devices.get(7)).toEqual({ timeZone: `Asia/Bangkok`, locale: `th-TH` })
  })

  it(`refuses a device payload of the wrong shape as bad_request`, async () => {
    const { call, devices } = harness()

    const failure = await call(`preferences.device`, { timeZone: 7 }).catch((error) => error)

    expect((failure as RealtimeRequestError).code).toBe(`bad_request`)
    expect(devices.size).toBe(0)
  })

  it(`dispatches the save with the actor and the call's idempotency key`, async () => {
    const seen: PreferencesSaveCommand[] = []
    const requests = createPreferencesOperations({
      get: () => Promise.resolve({ version: 0, value: DEFAULT_PREFERENCES }),
      save: (command) => {
        seen.push(command)
        return Promise.resolve({ ok: true, settings: { version: 1, value: berlin } })
      },
      device: (_command: PreferencesDeviceCommand) => Promise.resolve(),
    })

    await requests[`preferences.save`].handle({
      actor,
      requestId: `req`,
      signal,
      idempotencyKey: `key-1`,
      payload: { version: 0, value: berlin },
    })

    expect(seen[0].data).toEqual({
      actor,
      request: { version: 0, value: berlin },
      idempotencyKey: `key-1`,
    })
  })
})
