import { ConnectionLostError, type GapReport } from "@spy4x/realtime"
import { type CallPort, type RetryOptions, sendCommand, sendQuery } from "@spy4x/realtime/calls"
import { signal } from "@preact/signals"
import { createSyncRunner, type SyncRunner } from "@spy4x/realtime/sync-runner"
import {
  advanceGroupCursor as advanceSocketCursor,
  connectionDisplay as socketDisplay,
  connectRealtime,
  disconnectRealtime,
  socketCalls,
  socketFirstOpen,
} from "./realtime/index.ts"
import {
  currentLayer as offlineLayer,
  flushOutbox as flushOfflineOutbox,
  type OfflineLayer,
  type OfflineTransport,
  startOffline as startOfflineLayer,
  stopOffline as stopOfflineLayer,
} from "./offline/index.ts"
import { offlineGroups as groupsOverLayer } from "./offline/groups-offline.ts"
import { offlineNotes as notesOverLayer } from "./offline/notes-offline.ts"
import { OfflineStatus as OfflineStatusLine } from "./offline/OfflineStatus.tsx"
import {
  forgetUser as forgetCachedUser,
  recallUser as recallCachedUser,
  rememberUser as rememberCachedUser,
} from "./offline/session-cache.ts"
import type { RuntimeConfig } from "./runtime-config.ts"
import { canCallAs, createAppCallPort } from "./state/realtime-call.ts"
import type { SessionState, SessionUser } from "./state/session.ts"

/**
 * The composition root (ADR 003): the one file that imports the WebSocket module
 * (`./realtime/`) and the local-data module (`./offline/`), and the one place that decides which of
 * them run. Stores and views import the ports below, never a module.
 *
 * Two switches from `/config.json` choose: `realtime` and `offline`, both on unless the file says
 * `false`. A product that never wants a module deletes its folder and its lines here;
 * `tests/realtime-removal.test.ts` and `tests/offline-removal.test.ts` fail when any other file
 * imports the folder. `docs/offline.md` lists the steps.
 */

/** Which optional modules run. */
export interface ModuleSwitches {
  /** The WebSocket module: hints the moment a change commits, and calls over the socket. */
  realtime: boolean
  /** The local-data module: the device copy and the queue of writes. */
  offline: boolean
}

const switches: ModuleSwitches = { realtime: true, offline: true }

/** A switch is off only when the configuration says `false`; the container writes it as text. */
function isOn(value: boolean | "true" | "false" | undefined): boolean {
  return value !== false && value !== "false"
}

/** Reads the switches from the runtime configuration. Called once, before the first render. */
export function configureModules(config: Pick<RuntimeConfig, "realtime" | "offline">): void {
  switches.realtime = isOn(config.realtime)
  switches.offline = isOn(config.offline)
}

/** The switches as they are now. */
export function moduleSwitches(): Readonly<ModuleSwitches> {
  return switches
}

// --- Calls -------------------------------------------------------------------------------------

/** How often a visible page whose socket is not open checks for changes. */
export const POLL_INTERVAL_MS = 30_000

interface Session {
  userId: number
  /**
   * The calls port of this user: HTTP always, the socket in front of it while the WebSocket module
   * runs and its socket is open.
   */
  port: CallPort
  /** The timer and page events that trigger the pull while no socket is open. */
  runner: SyncRunner
  /** Whether the runner is started: it is while no socket is open. */
  polling: boolean
  /** Whether the next run of the runner is the full pull, not the cheap check. */
  full: boolean
  stopEvents: () => void
}

let session: Session | null = null

/** The signed-in session. Before sign-in every call fails as a dropped connection. */
function sessionOrThrow(): Session {
  if (!session) throw new ConnectionLostError("nobody is signed in")
  return session
}

/**
 * A command with an idempotency key, sent again with the same key when its outcome is unknown.
 * Every try goes through the port of the user who was signed in when the command started: when
 * somebody else signs in on this page during a wait between tries, the command is still sent as
 * its own user, and the server refuses it. While no socket is open no hint follows the write, so
 * the page checks for changes itself.
 */
export async function callCommand<T>(
  name: string,
  payload: unknown,
  options?: RetryOptions,
): Promise<T> {
  const started = sessionOrThrow()
  const result = await sendCommand<T>(started.port, name, payload, options)
  // A stopped runner (the socket is open, or the session ended) does nothing.
  void started.runner.kick()
  return result
}

/** A query, sent again when the server could not be reached, always as the user who asked. */
export async function callQuery<T>(
  name: string,
  payload?: unknown,
  options?: RetryOptions,
): Promise<T> {
  return await sendQuery<T>(sessionOrThrow().port, name, payload, options)
}

/** Whether a call made now reaches the server as the signed-in user. */
export function canCall(): boolean {
  return session !== null && canCallAs(session.userId)
}

// --- Changes -----------------------------------------------------------------------------------

/** What triggers a read: the pull the socket's hints ask for, and the check the timer runs. */
export interface ChangeReads {
  /** The pull (ADR 002). `gap` names the group a hint was about; none means "read all". */
  pull(gap?: GapReport): void | Promise<void>
  /** `full` runs the pull; otherwise the cheap check (`createChangeCheck` in `state/pull.ts`). */
  check(full: boolean): Promise<void>
}

/**
 * How the local-data module reaches the server for `userId`: through that user's own port, and
 * only while they are the one signed in on this page, owe no second factor and the browser has a
 * network. So one person's queue is never sent as another.
 */
export function offlineTransportFor(userId: number, port: CallPort): OfflineTransport {
  return { calls: port, canSend: () => session?.userId === userId && canCallAs(userId) }
}

/** Options of {@link startModules}. */
export interface StartOptions {
  /** How often the page checks for changes while no socket is open. A test passes a short one. */
  pollIntervalMs?: number
}

/**
 * Starts everything that talks to the server for a signed-in user: the calls port, the local-data
 * module, and what triggers the pull. An open socket triggers it with its hints and reconnects.
 * While no socket is open (the WebSocket module is off, or its socket is connecting, dropped or
 * blocked) the page triggers it itself: at the start, when the browser is back online, when the
 * tab is shown again, after its own write, and on a timer while the tab is visible. Calling it
 * again for the same user does nothing.
 */
export function startModules(userId: number, reads: ChangeReads, options: StartOptions = {}): void {
  if (session?.userId === userId) return
  stopChanges()
  const port = createAppCallPort(
    switches.realtime ? { userId, socket: socketCalls, socketFirstOpen } : { userId },
  )
  const runner = createSyncRunner({
    flush: async () => {
      const full = opened.full
      opened.full = false
      try {
        await reads.check(full)
      } catch (error) {
        // The retry must read what this run did not.
        opened.full ||= full
        throw error
      }
    },
    pollIntervalMs: options.pollIntervalMs ?? POLL_INTERVAL_MS,
  })
  const opened: Session = {
    userId,
    port,
    runner,
    polling: false,
    full: true,
    stopEvents: () => {},
  }
  session = opened
  if (switches.offline) startOfflineLayer(userId, offlineTransportFor(userId, port))
  // The runner runs on these events too; marking the run first makes it the pull, not the check.
  // A hidden tab reads nothing, and an open socket brings the page up to date itself.
  const wake = () => {
    if (!opened.polling || document.visibilityState === "hidden") return
    opened.full = true
    void runner.kick()
  }
  const network = () => browserOnline.value = navigator.onLine !== false
  network()
  addEventListener("online", wake)
  addEventListener("online", network)
  addEventListener("offline", network)
  document.addEventListener("visibilitychange", wake)
  opened.stopEvents = () => {
    removeEventListener("online", wake)
    removeEventListener("online", network)
    removeEventListener("offline", network)
    document.removeEventListener("visibilitychange", wake)
  }
  /** Starts the runner (it runs once at once, then on its timer), or stops it. */
  const poll = (on: boolean) => {
    if (session !== opened || opened.polling === on) return
    opened.polling = on
    if (on) runner.start()
    else runner.stop()
  }
  // The socket's hints replace the timer while it is open, and only then. It starts opening before
  // the first call is made: the calls port decides once, at its first call, whether to wait for
  // the first open, and must find it pending.
  if (switches.realtime) connectRealtime(userId, reads.pull, (open) => poll(!open))
  // The first run is the start-up pull.
  poll(true)
}

/**
 * Stops what triggers the pull and closes the calls port; the local-data module keeps running, so
 * the same user starting again finds their queue. The app calls it when the session changes.
 */
export function stopChanges(): void {
  const closing = session
  session = null
  closing?.runner.stop()
  closing?.stopEvents()
  disconnectRealtime()
}

/** Signing out: stops everything and drops the cursors and the device copy. */
export function forgetModules(): void {
  stopChanges()
  disconnectRealtime({ forget: true })
  void stopOfflineLayer({ forget: true })
}

/** Records that the page now holds a group up to `sequence`, so a later hint for it is a repeat. */
export function advanceGroupCursor(groupId: string, sequence: number): void {
  if (switches.realtime) advanceSocketCursor(groupId, sequence)
}

/** Whether the browser has a network: what a page with no socket shows as its connection. */
const browserOnline = signal(navigator.onLine !== false)

/**
 * What the connection indicator shows. A page with no socket shows the browser's network: its
 * calls go over HTTP, so it is online whenever the browser is.
 */
export function connectionDisplay(
  state: Pick<SessionState, "wsStatus" | "wsResume">,
): ReturnType<typeof socketDisplay> {
  if (switches.realtime) return socketDisplay(state)
  return browserOnline.value ? "open" : "closed"
}

// --- Local data --------------------------------------------------------------------------------

/** The running layer, or `null` when the module is off or nobody is signed in. */
export function currentLayer(): OfflineLayer | null {
  return offlineLayer()
}

/** Sends the queued writes. Never rejects: what could not be sent stays queued. */
export function flushOutbox(): Promise<void> {
  return flushOfflineOutbox()
}

/** The stores' server dependencies with the device copy and the queue in front of them. */
export const offlineGroups = groupsOverLayer
export const offlineNotes = notesOverLayer

/** The offline status line and the conflict screen. */
export const OfflineStatus = OfflineStatusLine

/** Remembers who is signed in for a start with no network; nothing while the module is off. */
export function rememberUser(user: SessionUser): void {
  if (switches.offline) rememberCachedUser(user)
}

/** Drops the remembered user. */
export function forgetUser(): void {
  forgetCachedUser()
}

/** The remembered user, or `null`: always `null` while the module is off. */
export function recallUser(): SessionUser | null {
  return switches.offline ? recallCachedUser() : null
}
