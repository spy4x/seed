import {
  type GuestStartResponse,
  type GuestSwitchResponse,
  type GuestSwitchResult,
  type GuestSwitchState,
  isGuest,
  type User,
} from "@domain/identity"
import { apiFetch } from "./api.ts"
import { bootstrapSession } from "./auth.ts"
import { sessionState } from "./session.ts"
import { addDays, isoDateInTz, resolveWallClock } from "@spy4x/time/tz"

/**
 * Guest accounts (#224) in the SPA: starting one from `/try`, the choice after a sign-in method
 * turned out to be another account's, deleting a guest account, and the banner's "hide" on this
 * browser. Keeping an account goes through the sign-up and sign-in method paths, which the API
 * ties to the guest's session.
 */

/** Whether the signed-in person is a guest who has not kept the account. */
export function isGuestSession(user: Pick<User, "guestSince"> | null = sessionState.value.user) {
  return isGuest(user)
}

/** How `/try` ended. */
export type TryAnswer =
  /** The guest account is open: the app goes in. */
  | { kind: "started" }
  /** This browser already has a guest's session: the app goes in too. */
  | { kind: "already-guest" }
  /** A full account is open in this browser; nothing was made. */
  | { kind: "signed-in" }
  /** Too many new accounts from this network; `message` is the server's, with the wait. */
  | { kind: "rate-limited"; message: string }
  /** Guest accounts are off here. */
  | { kind: "off" }
  /** Offline, or the server failed. */
  | { kind: "failed" }

/**
 * Starts a guest account with one `POST` (never on a `GET`: a link prefetcher must not make
 * accounts), then reads the new session, so the app opens as the guest.
 */
export async function startGuest(): Promise<TryAnswer> {
  let result
  try {
    result = await apiFetch<GuestStartResponse>("/api/auth/guest", { method: "POST" })
  } catch (_unreachable) {
    return { kind: "failed" }
  }
  if (!result.ok) {
    if (result.status === 429) return { kind: "rate-limited", message: result.error.message }
    if (result.status === 404) return { kind: "off" }
    return { kind: "failed" }
  }
  const answer = result.data.guest
  if (answer === "signed-in") return { kind: "signed-in" }
  await bootstrapSession()
  if (!sessionState.value.user) return { kind: "failed" }
  return { kind: answer === "already-guest" ? "already-guest" : "started" }
}

/** The choice that waits on `/keep/taken`; `null` when none does, `undefined` when unreachable. */
export async function readGuestSwitch(): Promise<GuestSwitchState | null | undefined> {
  try {
    const result = await apiFetch<GuestSwitchResponse>("/api/auth/guest/switch")
    return result.ok ? result.data.switch : undefined
  } catch (_unreachable) {
    return undefined
  }
}

/**
 * Switches to the other account: with `move` the guest's groups go there, with `delete` they go.
 * On success this browser is that account's now, so the session is read again.
 */
export async function switchFromGuest(
  choice: "move" | "delete",
  password?: string,
  otp?: string,
): Promise<{ ok: true; result: GuestSwitchResult } | { ok: false; error: string }> {
  let result
  try {
    result = await apiFetch<GuestSwitchResult>("/api/auth/guest/switch", {
      method: "POST",
      body: JSON.stringify({ choice, password, otp }),
    })
  } catch (_unreachable) {
    return { ok: false, error: "You are offline. Connect and try again." }
  }
  if (!result.ok) return { ok: false, error: result.error.message }
  await bootstrapSession()
  return { ok: true, result: result.data }
}

/** "Keep the guest account": forgets the waiting choice. */
export async function cancelGuestSwitch(): Promise<boolean> {
  try {
    return (await apiFetch("/api/auth/guest/switch", { method: "DELETE" })).ok
  } catch (_unreachable) {
    return false
  }
}

/** Deletes the guest account at once, confirmed by the typed word; the page is signed out. */
export async function deleteGuestAccount(
  confirm: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let result
  try {
    result = await apiFetch("/api/auth/guest/delete", {
      method: "POST",
      body: JSON.stringify({ confirm }),
    })
  } catch (_unreachable) {
    return { ok: false, error: "You are offline. Connect and try again." }
  }
  if (!result.ok) return { ok: false, error: result.error.message }
  sessionState.value = { ...sessionState.value, user: null, isMfaRequired: false }
  return { ok: true }
}

const BANNER_KEY = "guest:banner-hidden:"

/** Whether this browser hid the guest banner of user `userId`. Blocked storage: never hidden. */
export function isGuestBannerHidden(userId: number, storage = safeStorage()): boolean {
  try {
    return storage?.getItem(`${BANNER_KEY}${userId}`) === "1"
  } catch (_blocked) {
    return false
  }
}

/** Hides the guest banner of user `userId` on this browser; the Profile keeps its own entry. */
export function hideGuestBanner(userId: number, storage = safeStorage()): void {
  try {
    storage?.setItem(`${BANNER_KEY}${userId}`, "1")
  } catch (_blocked) {
    // The banner stays hidden until the page closes; the caller keeps that in its own state.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch (_blocked) {
    return undefined
  }
}

const KEEP_PENDING = "guest:keep-pending"

/** What `/keep` remembers while the browser is away at a provider: the method and the return page. */
export interface KeepPending {
  method: string
  next: string | null
}

/** Remembers the provider a guest left for, so `/keep` can name it on the way back. */
export function rememberKeep(pending: KeepPending): void {
  try {
    globalThis.sessionStorage?.setItem(KEEP_PENDING, JSON.stringify(pending))
  } catch (_blocked) {
    // The page then says "a sign-in method" without the provider's name.
  }
}

/** Takes back what {@link rememberKeep} kept, once. */
export function takeKeep(): KeepPending | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(KEEP_PENDING)
    globalThis.sessionStorage?.removeItem(KEEP_PENDING)
    const value = raw ? JSON.parse(raw) : null
    return typeof value?.method === "string" ? value : null
  } catch (_blocked) {
    return null
  }
}

/** The zone whose midnight the demo's nightly wipe runs at (docs/demo.md). */
const DEMO_WIPE_ZONE = "America/Los_Angeles"

/**
 * The demo's next nightly wipe after `now`: the next midnight in Los Angeles, so it follows
 * daylight saving. The banner shows it in the person's own time through the app's formatter.
 */
export function nextPacificMidnight(now: Date): Date {
  const tomorrow = addDays(isoDateInTz(now, DEMO_WIPE_ZONE), 1, DEMO_WIPE_ZONE)
  return resolveWallClock(tomorrow, "00:00", DEMO_WIPE_ZONE).instant
}
