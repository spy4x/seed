import {
  adaptWebSocket,
  type BackoffConfig,
  ClientTransport,
  ConnectionLostError,
  createJsonCodec,
  createSystemClock,
  type GapReport,
  type MessageCodec,
  PersistentCursorStore,
  type SocketFactory,
  TransportStatus,
} from "@spy4x/realtime"
import { type AvailableCallPort, createSocketCallPort } from "@spy4x/realtime/calls"
import { watchPageResume } from "@spy4x/realtime/page-lifecycle"
import { browserStorage } from "@spy4x/platform/browser/storage"
import { SOCKET_USER_PROTOCOL } from "@domain/identity"
import { apiFetch } from "../state/api.ts"
import { type SessionState, sessionState } from "../state/session.ts"

/**
 * The WebSocket module: the socket, its reconnects, the hints it receives and the calls it carries.
 * Only `apps/spa/src/modules.ts` imports this folder (`tests/realtime-removal.test.ts`); a product
 * that never wants the socket deletes the folder and its lines there (`docs/offline.md`).
 */

type ConnectionStatus = "idle" | "connecting" | "open" | "closed"

const STATUS_TEXT: Record<TransportStatus, ConnectionStatus> = {
  [TransportStatus.Idle]: "idle",
  [TransportStatus.Connecting]: "connecting",
  [TransportStatus.Open]: "open",
  [TransportStatus.Reconnecting]: "closed",
  [TransportStatus.Stopped]: "closed",
}

/**
 * Reconnect backoff for tests. An e2e spec sets `globalThis.__REALTIME_BACKOFF__` before the app
 * script runs (Playwright's `addInitScript`) to make the retry timer slower than the spec's
 * window, so only an explicit `resume()` can reconnect inside it. Production sets nothing and
 * keeps the transport's default.
 */
function testBackoff() {
  return (globalThis as { __REALTIME_BACKOFF__?: Partial<BackoffConfig> }).__REALTIME_BACKOFF__
}

/** How long after the app returns a reconnect is expected without a word to the person. */
export const RESUME_QUIET_MS = 2_000

/**
 * What the connection indicator shows. The socket's own status says "closed" for a moment every
 * time the phone puts the app in the background, which is expected and not worth a warning: while
 * the page has just returned, a socket that is not open yet shows as it was ("Online"), and only
 * a reconnect that takes longer than {@link RESUME_QUIET_MS} shows "Reconnecting…".
 */
export function connectionDisplay(
  state: Pick<SessionState, "wsStatus" | "wsResume">,
): "idle" | "connecting" | "open" | "closed" | "reconnecting" {
  if (state.wsStatus === "open" || state.wsStatus === "idle") return state.wsStatus
  if (state.wsResume === "quiet") return "open"
  if (state.wsResume === "slow") return "reconnecting"
  return state.wsStatus
}

/**
 * Checked before every reconnect. A session that ended (signed out elsewhere, expired, or owing
 * its second factor) stops the reconnect and signs the page out; a network error or a server error
 * says nothing about the session, so the transport keeps trying.
 */
export function sessionGate(userId: number) {
  return async (): Promise<{ allowed: boolean; reason?: string }> => {
    try {
      const me = await apiFetch<{ id?: number }>("/api/auth/me")
      // The cookie must still belong to the user this page shows: a page left open across a
      // sign-out and another person's sign-in would otherwise send its data as them.
      if (me.ok && me.status !== 202 && me.data?.id === userId) return { allowed: true }
      if (!me.ok && me.status !== 401 && me.status !== 403) return { allowed: true }
    } catch (_error) {
      return { allowed: true }
    }
    sessionState.value = { ...sessionState.value, user: null, isMfaRequired: false }
    return { allowed: false, reason: "The session ended" }
  }
}

/** How long after one look for a newer app the next may start, so a stream of frames sends one. */
export const UPDATE_CHECK_GAP_MS = 60_000

/**
 * The codec the socket uses, which calls `onUndecodable` for every frame it cannot read. A frame
 * this page cannot read means the server speaks a newer protocol: it was deployed after this page
 * loaded. The transport drops such a frame, so a call it answers would only time out (#458).
 */
export function versionAwareCodec(inner: MessageCodec, onUndecodable: () => void): MessageCodec {
  return {
    encode: (message) => inner.encode(message),
    decode: (raw) => {
      const result = inner.decode(raw)
      if (!result.ok) onUndecodable()
      return result
    },
  }
}

/**
 * Asks the browser to fetch the service worker again, at most once per {@link UPDATE_CHECK_GAP_MS}.
 * The deployed worker differs from this page's, so it installs and waits, and `SWUpdater` shows its
 * "New version available" prompt. A page with no service worker has nothing to update.
 */
export function updateCheck(
  update: () => Promise<unknown> = async () =>
    await (await globalThis.navigator?.serviceWorker?.getRegistration())?.update(),
  now: () => number = Date.now,
): () => void {
  let last = -Infinity
  return () => {
    if (now() - last < UPDATE_CHECK_GAP_MS) return
    last = now()
    update().catch(() => {})
  }
}

const checkForNewVersion = updateCheck()

interface Connection {
  userId: number
  transport: ClientTransport
  /** The calls the open socket carries. */
  calls: AvailableCallPort
  /**
   * Settles once the first socket has opened or failed: `null` from then on. The composed port
   * makes a call at start-up wait for it ({@link socketFirstOpen}), so the page's first reads go
   * over the socket it is opening and not over HTTP beside it.
   */
  firstOpen: Promise<void> | null
  cursors: PersistentCursorStore
  stopStatus: () => void
  stopWatching: () => void
  /** The timer that ends the quiet period after the page returned. */
  quietTimer: ReturnType<typeof setTimeout> | null
}

let current: Connection | null = null

function socketUrl(): string {
  const protocol = location.protocol === "https:" ? "wss" : "ws"
  return `${protocol}://${location.host}/api/ws`
}

/**
 * Opens the socket as `userId`. A browser cannot set a header on a socket, so the user this page
 * was started for travels as the subprotocol `user.<id>`: the server refuses the upgrade when the
 * session cookie now belongs to somebody else (`apps/api/services/socket-route.ts`).
 */
function socketFactoryFor(userId: number): SocketFactory {
  return (url) => adaptWebSocket(new WebSocket(url, [`${SOCKET_USER_PROTOCOL}${userId}`]))
}

function cursorsFor(userId: number): PersistentCursorStore {
  // One namespace per user, so a second person on this browser never inherits a cursor.
  return new PersistentCursorStore({
    storage: browserStorage(),
    namespace: `realtime:user:${userId}`,
    clock: createSystemClock(),
  })
}

/**
 * Opens the socket for a signed-in user and keeps it open. `pull` is the REST read that brings the
 * page up to date: the transport calls it after every open, the first one included, and for every
 * hint that is news.
 * `onOpenChange` hears whether the socket is open, every time its status changes.
 * Calling it again for the same user does nothing.
 */
export function connectRealtime(
  userId: number,
  pull: (gap?: GapReport) => void | Promise<void>,
  onOpenChange?: (open: boolean) => void,
) {
  if (current?.userId === userId) return
  disconnectRealtime()
  const cursors = cursorsFor(userId)
  const transport = new ClientTransport({
    url: socketUrl(),
    socketFactory: socketFactoryFor(userId),
    codec: versionAwareCodec(createJsonCodec(), checkForNewVersion),
    clock: createSystemClock(),
    cursors,
    pull,
    gate: sessionGate(userId),
    backoff: testBackoff(),
  })
  // The socket receives hints only once the server has adopted it, so a change made after the
  // start-up read and before that moment reaches this page by no hint. The transport covers that
  // gap itself: it pulls once the server has acknowledged the first open, as after a reconnect.
  let settleFirstOpen = () => {}
  const firstOpen = new Promise<void>((resolve) => settleFirstOpen = resolve)
  const stopStatus = transport.onStatus((snapshot) => {
    const wsStatus = STATUS_TEXT[snapshot.status]
    if (wsStatus === "open" || wsStatus === "closed") settleFirstOpen()
    if (wsStatus === "open") clearResumeNotice()
    sessionState.value = { ...sessionState.value, wsStatus }
    onOpenChange?.(wsStatus === "open")
  })
  // The app came back (shown again, back online, restored from the back-forward cache): do not
  // wait for the next reconnect timer. Only a page that was hidden stays quiet about the gap for a
  // moment, because a socket lost in the background is expected; a network that just returned is
  // not news the person should be told is fine.
  let wasHidden = document.visibilityState === "hidden"
  const trackHidden = () => {
    if (document.visibilityState === "hidden") wasHidden = true
  }
  document.addEventListener("visibilitychange", trackHidden)
  const stopResume = watchPageResume(() => {
    transport.resume()
    const returned = wasHidden
    if (document.visibilityState === "visible") wasHidden = false
    if (!returned || sessionState.value.wsStatus === "open" || !current) return
    // Visibility, online and pageshow often fire together: one quiet period, not three.
    if (current.quietTimer) return
    sessionState.value = { ...sessionState.value, wsResume: "quiet" }
    current.quietTimer = setTimeout(() => {
      if (current) current.quietTimer = null
      if (sessionState.value.wsStatus !== "open") {
        sessionState.value = { ...sessionState.value, wsResume: "slow" }
      }
    }, RESUME_QUIET_MS)
  })
  const stopWatching = () => {
    stopResume()
    document.removeEventListener("visibilitychange", trackHidden)
  }
  current = {
    userId,
    transport,
    calls: createSocketCallPort(transport),
    firstOpen,
    cursors,
    stopStatus: () => {
      stopStatus()
      settleFirstOpen()
    },
    stopWatching,
    quietTimer: null,
  }
  const opened = current
  void firstOpen.then(() => opened.firstOpen = null)
  sessionState.value = { ...sessionState.value, wsStatus: "connecting" }
  transport.connect()
}

/** Closes the socket. `forget` also drops the cursors, as signing out must. */
export function disconnectRealtime({ forget = false } = {}): void {
  if (!current) return
  const { transport, cursors, stopStatus, stopWatching } = current
  clearResumeNotice()
  current = null
  stopStatus()
  stopWatching()
  transport.stop()
  if (forget) cursors.clear()
  sessionState.value = { ...sessionState.value, wsStatus: "idle", wsResume: "none" }
}

/** Ends the quiet period and its timer, as an open socket or a disconnect does. */
function clearResumeNotice(): void {
  if (current?.quietTimer) clearTimeout(current.quietTimer)
  if (current) current.quietTimer = null
  if (sessionState.value.wsResume !== "none") {
    sessionState.value = { ...sessionState.value, wsResume: "none" }
  }
}

/** Records that the page now holds a group up to `sequence`, so a later hint for it is a repeat. */
export function advanceGroupCursor(groupId: string, sequence: number): void {
  current?.cursors.advanceTo(groupId, sequence)
}

function openCalls(): AvailableCallPort {
  if (!current) throw new ConnectionLostError("the socket is not open")
  return current.calls
}

/**
 * The calls port of the socket, for the composed port in `modules.ts`: available while the socket
 * is open. Without an open socket every call fails as a dropped connection, which the composed
 * port answers by sending the call over HTTP.
 */
export const socketCalls: AvailableCallPort = {
  isAvailable: () => current?.calls.isAvailable() ?? false,
  command: async (name, payload, options) => await openCalls().command(name, payload, options),
  query: async (name, payload, options) => await openCalls().query(name, payload, options),
}

/**
 * The first open of the socket while it is still pending, for the composed port's `firstOpenWait`
 * (`@spy4x/realtime/calls`): a call made meanwhile waits for it, for as long as the library allows.
 */
export function socketFirstOpen(): Promise<void> | null {
  return current?.firstOpen ?? null
}
