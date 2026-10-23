import { ConnectionLostError, type GapReport } from "@spy4x/realtime"
import { type CallPort, type RetryOptions, sendCommand, sendQuery } from "@spy4x/realtime/calls"
import { createOnlineStatus } from "@spy4x/preact-signals/online"
import { createSignedInHint } from "@spy4x/platform/browser/signed-in-hint"
import { createLocalReads, type LocalReads } from "@spy4x/realtime/read-cache"
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
  forgetDeviceCopy,
  type OfflineLayer,
  type OfflineStorage,
  type OfflineTransport,
  readsDatabase,
  startOffline as startOfflineLayer,
  stopOffline as stopOfflineLayer,
} from "./offline/index.ts"
import { offlineNotes as notesOverLayer } from "./offline/notes-collection.ts"
import { offlineTags as tagsOverLayer } from "./offline/tags-collection.ts"
import { OfflineStatus as OfflineStatusLine } from "./offline/OfflineStatus.tsx"
import {
  browserDatabases,
  type QueueDatabases,
  refusedMessage,
  sendQueueOnce,
} from "./offline/send-once.ts"
import {
  type UnsentView,
  type UnsentWait,
  watchUnsent as watchLayerUnsent,
} from "./offline/unsent.ts"
import type { RuntimeConfig } from "./runtime-config.ts"
import { canCallAs, createAppCallPort } from "./state/realtime-call.ts"
import type { SessionState, SessionUser } from "./state/session.ts"
import { toasts } from "./state/toasts.ts"

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

/**
 * Reads the switches from the runtime configuration. Called once, before the first render. A
 * switch is off only when the configuration says so (`runtime-config.ts` reads the file's text).
 */
export function configureModules(config: Pick<RuntimeConfig, "realtime" | "offline">): void {
  switches.realtime = config.realtime !== false
  switches.offline = config.offline !== false
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
  /** Where the local-data module keeps its data. Defaults to IndexedDB; a test passes memory. */
  storage?: OfflineStorage
  /**
   * The device's database list: for the queue left while the module is off, and for the databases
   * of a person still owed a deletion. A test passes one.
   */
  databases?: QueueDatabases
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
  let stopQueue = () => {}
  if (switches.offline) {
    const start = () => {
      startOfflineLayer(userId, offlineTransportFor(userId, port), options.storage)
    }
    // Copies an earlier page still owes a deletion are deleted before the layer opens, so none of
    // them can be shown. Until then, and for this visit when the device could not delete this
    // person's own, the stores talk to the server alone.
    const owed = owedIds()
    if (owed.length === 0) start()
    else {
      void settleOwed(options.storage)
      // A sign-out cut short (the page closed) leaves its databases too, the queue among them.
      deleteDatabases(options.databases, owed)
      void forgetting.then(() => {
        if (session === opened && !owedIds().includes(userId)) start()
      })
    }
  } else {
    // What the module kept before it was switched off is deleted; nothing is opened on a device
    // that holds no trace of it. A queue of unsent writes is the person's work: it is sent once,
    // then deleted.
    void forgetUser(options.storage)
    stopQueue = sendLeftQueue(opened, options)
  }
  // The runner runs on these events too; marking the run first makes it the pull, not the check.
  // A hidden tab reads nothing, and an open socket brings the page up to date itself.
  const wake = () => {
    if (!opened.polling || document.visibilityState === "hidden") return
    opened.full = true
    void runner.kick()
  }
  const stopNetwork = network.watch(globalThis)
  addEventListener("online", wake)
  document.addEventListener("visibilitychange", wake)
  opened.stopEvents = () => {
    stopQueue()
    removeEventListener("online", wake)
    stopNetwork()
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
 * The queue an earlier visit left while the local-data module is now off: sent once, at the start
 * and again whenever the browser comes back online, until the device holds none. Writes the server
 * refused are dropped, and one warning that stays until dismissed names them. Returns the way to
 * stop trying.
 */
function sendLeftQueue(opened: Session, options: StartOptions): () => void {
  let done = false
  let running = false
  const run = async () => {
    if (done || running || session !== opened) return
    running = true
    try {
      const result = await sendQueueOnce({
        userId: opened.userId,
        transport: offlineTransportFor(opened.userId, opened.port),
        storage: options.storage,
        databases: options.databases,
      })
      done = result.done
      if (result.refused.length > 0) {
        toasts.warning({
          body: refusedMessage(result.refused),
          duration: 0,
          dataE2E: "offline-queue-refused",
        })
      }
    } catch (error) {
      // The queue stays on the device; the next start or reconnect tries again.
      console.warn("The offline queue could not be sent. The next start tries again.", error)
    } finally {
      running = false
    }
  }
  addEventListener("online", run)
  void run()
  return () => removeEventListener("online", run)
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
  const running = offlineLayer()
  if (!running) return void stopOfflineLayer()
  // `forgetUser` got here first and owes this person's deletion. The layer still clears its own
  // copy, so an answer that arrives after the sign-out is not saved; `forgetUser` reports a refusal.
  if (settling.has(running.userId)) return void stopOfflineLayer({ forget: true }).catch(() => {})
  const { userId } = running
  // Owed until the device has deleted them: a page closed before that leaves the next start to it.
  owe(userId)
  settling.add(userId)
  const deleting = stopOfflineLayer({ forget: true }).finally(() => settling.delete(userId))
  // A refusal is reported by `settle`, which may only get to it after an earlier deletion.
  deleting.catch(() => {})
  settle(userId, () => deleting)
}

/**
 * What a sign-out leaves in `localStorage`. None of it is a person's data: the debts that finish
 * the sign-out (the server's sign-out, a deletion the device could not do yet) and the device's own
 * answers (the theme, the dismissed install offer), plus the masked hint of how someone last signed
 * in here, which the sign-in page shows and "Not you? Forget" drops (#142).
 */
const KEPT_KEYS: ReadonlySet<string> = new Set([
  "auth:sign-out-owed", // `state/auth.ts`
  "offline:owed-deletion", // below
  "theme", // `state/theme.ts`, the library's default key
  "install-prompt-dismissed", // `install.ts`
  "last-sign-in", // `state/last-sign-in.ts`
])

/**
 * What a sign-out leaves in this tab's `sessionStorage`: the sign-in link the tab just asked for,
 * so "Check your inbox" survives the reload of a signed-out page, which wipes the device (#391).
 */
const KEPT_SESSION_KEYS: ReadonlySet<string> = new Set([
  "sign-in-link:sent", // `state/sign-in-link.ts`
])

/**
 * Deletes every `localStorage` key of the app but {@link KEPT_KEYS}, and every `sessionStorage` key
 * but {@link KEPT_SESSION_KEYS}: the selected group, the socket's cursors, the kept time zone, the
 * remembered user. Blocked storage holds nothing to delete.
 */
export function clearBrowserStorage(): void {
  try {
    const keys: string[] = []
    for (let index = 0; index < localStorage.length; index++) keys.push(localStorage.key(index)!)
    for (const key of keys) if (!KEPT_KEYS.has(key)) localStorage.removeItem(key)
  } catch (_blocked) {
    // Nothing is stored where the browser refuses storage.
  }
  try {
    const keys: string[] = []
    for (let index = 0; index < sessionStorage.length; index++) {
      keys.push(sessionStorage.key(index)!)
    }
    for (const key of keys) if (!KEPT_SESSION_KEYS.has(key)) sessionStorage.removeItem(key)
  } catch (_blocked) {
    // As above.
  }
}

/** Records that the page now holds a group up to `sequence`, so a later hint for it is a repeat. */
export function advanceGroupCursor(groupId: string, sequence: number): void {
  if (switches.realtime) advanceSocketCursor(groupId, sequence)
}

/** Whether the browser has a network: what a page with no socket shows as its connection. */
const network = createOnlineStatus()

/**
 * What the connection indicator shows. A page with no socket shows the browser's network: its
 * calls go over HTTP, so it is online whenever the browser is.
 */
export function connectionDisplay(
  state: Pick<SessionState, "wsStatus" | "wsResume">,
): ReturnType<typeof socketDisplay> {
  if (switches.realtime) return socketDisplay(state)
  return network.online.value ? "open" : "closed"
}

// --- Local data --------------------------------------------------------------------------------

/** The running layer, or `null` when the module is off or nobody is signed in. */
export function currentLayer(): OfflineLayer | null {
  return offlineLayer()
}

/**
 * The queue watched for a sign-out, or `null` when nothing waits: no write is queued, nobody is
 * signed in, or the module is off. The caller disposes it when the dialog closes.
 */
export function watchUnsentChanges(): UnsentWait | null {
  const running = offlineLayer()
  if (!running || !session) return null
  if (running.entries.value.length + running.tagEntries.value.length === 0) return null
  const { userId } = running
  return watchLayerUnsent({
    layer: running,
    online: network.online,
    canSend: () => canCallAs(userId),
  })
}

export type { UnsentView, UnsentWait }

/** Sends the queued writes. Never rejects: what could not be sent stays queued. */
export function flushOutbox(): Promise<void> {
  return flushOfflineOutbox()
}

/**
 * The read copies of the offline-readable lists (ADR 003, level 2): `LocalReads` and
 * `createLocalReads` from `@spy4x/realtime/read-cache`, re-exported so the stores take this port
 * from the composition root.
 */
export { createLocalReads, type LocalReads }

/** Reads with no device behind them: every read goes to the server and nothing is kept. */
export const noLocalReads: LocalReads = createLocalReads(() => undefined)

/**
 * The read copies of the signed-in user. While the module is off, or nobody is signed in, it is
 * {@link noLocalReads}: nothing is written to the device.
 */
export const localReads: LocalReads = createLocalReads(() => offlineLayer()?.reads)

/** The notes store's server dependencies with the device copy and the queue in front of them. */
export const offlineNotes = notesOverLayer

/** The tags store's server dependencies with the device copy and the queue in front of them. */
export const offlineTags = tagsOverLayer

/** The offline status line and the conflict screen. */
export const OfflineStatus = OfflineStatusLine

/**
 * Who was signed in on this device, kept in `localStorage` under the key it has always had, so the
 * app can open with no network: the cookie says nothing until the server is reached. It is a hint
 * for what to show, never a credential.
 */
const signedInHint = createSignedInHint<SessionUser>("offline:session", {
  validate: (value): value is SessionUser =>
    typeof value === "object" && value !== null &&
    typeof (value as { id?: unknown }).id === "number",
})

/**
 * Remembers who is signed in for a start with no network; nothing while the module is off. When
 * the device remembers someone else (a provider sign-in's redirect brings a new person's cookie to
 * a page that never signed the last one out), everything the app kept in the browser is deleted at
 * once, as on sign-out ({@link wipeDevice}), their queue of unsent writes included: the next person
 * must not find them. The new person's layer opens only once the device holds none of it.
 */
export function rememberUser(
  user: SessionUser,
  storage?: OfflineStorage,
  databases?: QueueDatabases,
): void {
  if (!switches.offline) return
  const remembered = signedInHint.recall()
  const other = remembered && remembered.id !== user.id ? remembered.id : undefined
  if (other === undefined) {
    signedInHint.remember(user)
    return
  }
  // Owed before the hint names the new person, so a page closed in between still deletes them.
  owe(other)
  clearBrowserStorage()
  signedInHint.remember(user)
  void settleOwed(storage, other)
  deleteDatabases(databases, [other])
}

/**
 * The users whose copies on this device are owed a deletion, kept in `localStorage` beside the
 * remembered user (the library's holder is a safe JSON value under one key, which is all this
 * needs). An id is written before its deletion starts and removed only after the device has
 * deleted the copies, so a page that closes in between, or a device that refuses, leaves the next
 * start knowing whose copies to delete.
 */
const owedDeletions = createSignedInHint<number[]>("offline:owed-deletion", {
  validate: (value): value is number[] =>
    Array.isArray(value) && value.every((id) => typeof id === "number"),
})

function owedIds(): number[] {
  return owedDeletions.recall() ?? []
}

function owe(userId: number): void {
  const ids = owedIds()
  if (!ids.includes(userId)) owedDeletions.remember([...ids, userId])
}

function disown(userId: number): void {
  const rest = owedIds().filter((id) => id !== userId)
  if (rest.length > 0) owedDeletions.remember(rest)
  else owedDeletions.forget()
}

/** The deletions started on this page, in order; resolved when all of them have been tried. */
let forgetting: Promise<void> = Promise.resolve()

/** The users {@link settleOwed} is deleting for right now, so a second caller starts no second. */
const settling = new Set<number>()

/**
 * Queues one deletion. Only a deletion that succeeded ends the debt; a failed one is reported and
 * stays owed for the next start.
 */
function settle(userId: number, deletion: () => Promise<void>): void {
  forgetting = forgetting.then(deletion).then(
    () => disown(userId),
    (error) => {
      console.warn(
        `The copies of user ${userId} kept on this device could not be deleted. ` +
          `The next start tries again.`,
        error,
      )
    },
  )
}

/**
 * Deletes the copies of every user who is owed it, `also` included even on a device that could not
 * write the marker. Resolves once every deletion was tried; it never rejects.
 */
function settleOwed(storage?: OfflineStorage, also?: number): Promise<void> {
  const ids = new Set(owedIds())
  if (also !== undefined) ids.add(also)
  for (const id of ids) {
    if (settling.has(id)) continue
    settling.add(id)
    settle(id, () => forgetDeviceCopy(id, storage).finally(() => settling.delete(id)))
  }
  return forgetting
}

/**
 * Drops the remembered user at once, and deletes what the device kept of the server's answers for
 * them and for anyone an earlier page still owes it. The queue of unsent writes stays: a signed-in
 * start with the module off calls it, and sends that queue once. A sign-out deletes the queue too,
 * through {@link wipeDevice}. Resolves once the deletions were tried. It runs with the module off,
 * so switching the module off deletes what it kept; a device with nobody remembered and nothing owed
 * is not opened.
 */
export function forgetUser(storage?: OfflineStorage): Promise<void> {
  const remembered = signedInHint.recall()
  signedInHint.forget()
  if (remembered) owe(remembered.id)
  return settleOwed(storage, remembered?.id)
}

/** Whether the IndexedDB database `name` holds something of one of `userIds`. */
function belongsTo(name: string, userIds: readonly number[]): boolean {
  return userIds.some((id) =>
    name === readsDatabase(id) || name === `offline:user:${id}` ||
    name.startsWith(`offline:user:${id}:`)
  )
}

/**
 * Queues the deletion of the app's IndexedDB databases after the deletions already queued, so a
 * copy those finish is not opened again afterwards: every database, or only those of `userIds`.
 * The next person's layer waits for it: a start that owes a deletion opens the layer only once
 * {@link forgetting} has settled.
 */
function deleteDatabases(
  databases: QueueDatabases = browserDatabases,
  userIds?: readonly number[],
): void {
  forgetting = forgetting.then(async () => {
    try {
      const listed = await databases.list() ?? []
      const names = userIds ? listed.filter((name) => belongsTo(name, userIds)) : listed
      const results = await Promise.allSettled(names.map((name) => databases.delete(name)))
      const failed = results.find((result) => result.status === "rejected")
      if (failed) throw failed.reason
    } catch (error) {
      console.warn("The data this app kept on the device could not all be deleted.", error)
    }
  })
}

/**
 * Signing out on this device (#206): deletes everything the app keeps in the browser, so the next
 * person on a shared device finds nothing of the last one. Every IndexedDB database goes, the
 * queue of unsent writes included, and so does every `localStorage` key but the few
 * {@link KEPT_KEYS}, and `sessionStorage` but {@link KEPT_SESSION_KEYS}. What the server owns comes back at the next sign-in.
 * The app calls it whenever the page settles with nobody signed in: after the account menu's
 * sign-out, a start whose session ended (401), and a sign-out by the server. Resolves once every
 * deletion was tried; it never rejects.
 */
export function wipeDevice(storage?: OfflineStorage, databases?: QueueDatabases): Promise<void> {
  void forgetUser(storage)
  clearBrowserStorage()
  deleteDatabases(databases)
  return forgetting
}

/** The remembered user, or `null`: always `null` while the module is off. */
export function recallUser(): SessionUser | null {
  return switches.offline ? signedInHint.recall() : null
}
