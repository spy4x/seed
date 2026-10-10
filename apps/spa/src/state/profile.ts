import { signal } from "@preact/signals"
import { RealtimeRequestError } from "@spy4x/realtime"
import type { PushSubscribeRequest } from "@spy4x/platform/model"
import type { User, UserPushTokenPublic } from "@domain/identity"
import { callCommand, callQuery } from "../modules.ts"
import { sessionState } from "./session.ts"

/** What the profile store needs from the outside. Injected so tests need no socket. */
export interface ProfileDependencies {
  query<T>(name: string): Promise<T>
  command<T>(name: string, payload: unknown): Promise<T>
}

/**
 * The outcome of a call the page shows: done, or the server's message for the form. The message is
 * empty when the call never got an answer, and the page then shows its own wording.
 */
export type ProfileOutcome = { ok: true } | { ok: false; error: string }

function failure(cause: unknown): ProfileOutcome {
  return { ok: false, error: cause instanceof RealtimeRequestError ? cause.message : "" }
}

/**
 * The profile page's data: the person's name (kept in the session) and their push devices. Reads
 * and writes go over the socket. {@link refresh} is also the pull for the hint the server sends
 * when another tab changed either, so the page follows without a reload.
 */
export function createProfileStore(dependencies: ProfileDependencies) {
  const pushDevices = signal<UserPushTokenPublic[]>([])

  /** Reads the profile and the push devices again. Rejects when the socket cannot answer. */
  async function refresh(): Promise<void> {
    const [{ user }, { devices }] = await Promise.all([
      dependencies.query<{ user: User }>("profile.get"),
      dependencies.query<{ devices: UserPushTokenPublic[] }>("push.list"),
    ])
    sessionState.value = { ...sessionState.value, user }
    pushDevices.value = devices
  }

  async function saveProfile(firstName: string, lastName: string): Promise<ProfileOutcome> {
    try {
      const { user } = await dependencies.command<{ user: User }>("profile.update", {
        firstName,
        lastName,
      })
      sessionState.value = { ...sessionState.value, user }
      return { ok: true }
    } catch (cause) {
      return failure(cause)
    }
  }

  /** Registers this browser's subscription as a device, then reads the list. */
  async function registerPush(
    deviceId: string,
    subscription: PushSubscribeRequest["subscription"],
  ): Promise<ProfileOutcome> {
    try {
      await dependencies.command("push.register", { deviceId, subscription })
      await refresh()
      return { ok: true }
    } catch (cause) {
      return failure(cause)
    }
  }

  async function removePush(deviceId: string): Promise<ProfileOutcome> {
    try {
      await dependencies.command("push.remove", { deviceId })
      await refresh()
      return { ok: true }
    } catch (cause) {
      return failure(cause)
    }
  }

  let wasOpen = false
  let dropped = false

  /**
   * Feed it every socket status. A hint for this person's own changes has no stored cursor, so
   * the transport's catch-up after a reconnect does not cover it: when the socket opens again
   * after a drop, read again here.
   */
  function onSocketStatus(status: "idle" | "connecting" | "open" | "closed"): void {
    if (status === "open") {
      if (dropped) void refresh().catch(() => {})
      wasOpen = true
      dropped = false
    } else if (wasOpen) {
      dropped = true
    }
  }

  function reset(): void {
    pushDevices.value = []
    wasOpen = false
    dropped = false
  }

  return { pushDevices, refresh, saveProfile, registerPush, removePush, onSocketStatus, reset }
}

/** The page's own store, over the socket. */
export const profileStore = createProfileStore({
  query: (name) => callQuery(name),
  command: (name, payload) => callCommand(name, payload),
})
