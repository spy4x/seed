import {
  AggregateNotifier,
  type Clock,
  ConnectionRegistry,
  type ConnectionRegistryOptions,
  createHint,
  createSystemClock,
  type ManagedSocket,
  NotifyStatus,
  RealtimeRequestError,
} from "@spy4x/realtime"
import { createOperationDispatcher, type Operations } from "@spy4x/realtime/operations"
import { GROUP_AGGREGATE, GroupError } from "@domain/groups"
import { AccessError, type Actor, userChangeGroupId } from "@domain/identity"
import { NoteError, NoteVersionConflictError } from "@domain/notes"
import { PlanError, toPlanRefusal } from "@domain/billing"
import { IdempotencyError } from "@spy4x/server/idempotency"
import { actorFromAuth } from "../cqrs/actor.ts"
import type { AppAuthState } from "./sign-in.ts"

/** WebSocket close code "policy violation": the session may no longer use the connection. */
export const POLICY_CLOSE_CODE = 1008

/** The aggregate name of the hints sent by {@link Realtime.notifyUserChange}. */
export const USER_AGGREGATE = "user"

const REVOKED_REASON = "session is no longer valid"

export interface RealtimeOptions {
  /** The session and user as they are now, or `null` when the session may no longer act. */
  entitledSession(sessionId: number): Promise<AppAuthState | null>
  /**
   * The users a group's change is pushed to: those who can see the group now. It is called for
   * every hint and must read the database, never a list kept from earlier, so someone who lost
   * access stops getting the group's hints.
   */
  memberUserIds(groupId: string): Promise<readonly number[]>
  /** The table the socket serves; the call route is given the same object. */
  operations: Operations<Actor>
  /** Called with every failure the socket hides from the client. */
  log(...data: unknown[]): void
  clock?: Clock
  registry?: Partial<ConnectionRegistryOptions>
}

interface LiveSocket {
  sessionId: number
  userId: number
  socket: ManagedSocket
}

/**
 * Turns an error a handler threw into the typed error the client sees, or `null` for one the client
 * must not be told about (it is answered `internal` and logged instead).
 *
 * The domain code travels in `details.code`, so the client can tell "id already in use" from any
 * other conflict without parsing prose.
 */
export function toRequestError(error: unknown): RealtimeRequestError | null {
  if (error instanceof RealtimeRequestError) return error
  if (error instanceof GroupError) {
    return new RealtimeRequestError(GROUP_ERROR_CODES[error.code], error.message, {
      code: error.code,
    })
  }
  if (error instanceof NoteError) {
    // A version conflict names the version the note is at now, so the client can reread it.
    const details = error instanceof NoteVersionConflictError
      ? { code: error.code, currentVersion: error.currentVersion }
      : { code: error.code }
    return new RealtimeRequestError(NOTE_ERROR_CODES[error.code], error.message, details)
  }
  if (error instanceof PlanError) {
    // The socket's codes are closed, so a plan refusal is `forbidden` and names itself in details.
    return new RealtimeRequestError("forbidden", error.message, toPlanRefusal(error))
  }
  if (error instanceof AccessError) {
    return new RealtimeRequestError("unauthorized", error.message, { code: error.code })
  }
  if (error instanceof IdempotencyError) {
    // A command class name over the limit is a server bug, so it is answered as an unexpected error.
    if (error.code === "INVALID_COMMAND") return null
    const code = error.code === "INVALID_KEY" ? "bad_request" : "conflict"
    return new RealtimeRequestError(code, error.message, { code: error.code })
  }
  return null
}

const GROUP_ERROR_CODES: Record<
  GroupError["code"],
  "bad_request" | "unauthorized" | "forbidden" | "not_found" | "conflict"
> = {
  GROUP_NOT_FOUND: "not_found",
  GROUP_SUBSCRIBED: "conflict",
  ID_ALREADY_EXISTS: "conflict",
  INVALID_CURSOR: "bad_request",
  INVALID_REQUEST: "bad_request",
  LAST_GROUP: "conflict",
  LAST_OWNER: "conflict",
  MEMBER_NOT_FOUND: "not_found",
  NAME_MISMATCH: "bad_request",
  NOTHING_TO_MOVE: "conflict",
  PASSWORD_INVALID: "bad_request",
  ROLE_INSUFFICIENT: "forbidden",
  SAME_GROUP: "bad_request",
  SUBSCRIPTION_RENEWS: "conflict",
  USER_NOT_ACTIVE: "unauthorized",
}

const NOTE_ERROR_CODES: Record<
  NoteError["code"],
  "bad_request" | "forbidden" | "not_found" | "conflict"
> = {
  GROUP_NOT_FOUND: "not_found",
  ID_ALREADY_EXISTS: "conflict",
  INVALID_CURSOR: "bad_request",
  INVALID_REQUEST: "bad_request",
  NOTE_NOT_FOUND: "not_found",
  ROLE_INSUFFICIENT: "forbidden",
  SAME_GROUP: "bad_request",
  VERSION_CONFLICT: "conflict",
}

/**
 * The template's side of the realtime socket, a thin adapter over `@spy4x/realtime`.
 *
 * The socket authenticates once, at the upgrade (`routes/ws.ts`), and this class remembers which
 * session each socket belongs to. From then on:
 *
 * - **Every request is authorized again.** The session is read from the database for each frame,
 *   the {@link Actor} is built from that fresh state, and the request is dispatched on the same
 *   command and query buses REST uses, where the session gate and the group checks run. A
 *   socket therefore cannot do anything its session could no longer do over REST.
 * - **A revoked session loses its sockets.** {@link revalidate} closes with the policy code every
 *   socket whose session was signed out, expired, lost its user, or owes a second factor. It runs
 *   when a user signs out, on a timer, and before any request is served.
 * - **A group change reaches its members.** {@link notifyGroupChange} sends a sequence-stamped
 *   `change.hint` to each member's sockets. The hint carries no data; a client that is behind pulls.
 *   Who is a member is read for every hint, so a person who lost access stops getting them.
 * - **A person who loses a group is told once, and keeps the socket.** {@link notifyAccessLoss}
 *   sends them the hint of the change that took the group away, so their page reads again and
 *   drops it. The socket stays open: it still serves their other groups, and every request on it
 *   is authorized again anyway.
 * - **A user's own change reaches their other tabs.** {@link notifyUserChange} sends a hint for the
 *   profile or push devices to every socket of that user.
 */
export class Realtime {
  readonly registry: ConnectionRegistry
  readonly #options: RealtimeOptions
  readonly #clock: Clock
  readonly #live = new Map<string, LiveSocket>()
  readonly #notifier: AggregateNotifier

  constructor(options: RealtimeOptions) {
    this.#options = options
    this.#clock = options.clock ?? createSystemClock()
    this.registry = new ConnectionRegistry({
      clock: this.#clock,
      onRequestError: (error, context) =>
        options.log(`error: socket request ${context.name} failed`, error),
      ...options.registry,
    })
    // The library's dispatcher is the socket adapter of the operations table. It refuses a request
    // whose session now belongs to anyone but the user the socket was attached for.
    this.registry.onRequest(createOperationDispatcher(options.operations, {
      authenticate: (context) => this.#actorOf(context.socketId),
      userIdOf: (actor) => actor.userId,
      mapError: toRequestError,
    }))
    this.registry.onClose((handle) => this.#live.delete(handle.id))
    // The client's handshake carries its cursors. The pull, not this answer, brings it up to date;
    // the acknowledgement only tells it the server heard.
    this.registry.onFrame(({ socketId, message }) => {
      if (message.kind === "client.sync" && message.id !== undefined) {
        this.registry.send(socketId, { kind: "server.ack", ackId: message.id })
      }
    })
    this.#notifier = new AggregateNotifier({
      fanout: this.registry,
      resolvers: new Map([[
        GROUP_AGGREGATE,
        async (change) => (await options.memberUserIds(change.groupId)).map(String),
      ]]),
      onUnknownAggregate: (change) => options.log("error: unhandled aggregate", change),
      onError: (change, error) => options.log("error: cannot resolve who to notify", change, error),
    })
  }

  /**
   * Adopts a socket that passed the upgrade checks. Returns `false` when the user already holds
   * the most sockets the registry allows; the socket is then closed.
   */
  attach(socket: ManagedSocket, auth: AppAuthState): boolean {
    const handle = this.registry.attach(String(auth.user.id), socket)
    if (!handle) return false
    this.#live.set(handle.id, { sessionId: auth.session.id, userId: auth.user.id, socket })
    return true
  }

  /** How many sockets are open, for one user or for everyone. */
  count(userId?: number): number {
    return userId === undefined ? this.#live.size : this.registry.connectionsFor(String(userId))
  }

  /**
   * Closes every socket (of one user, or of all) whose session may no longer act. Returns how many
   * it closed. A failure to read a session leaves that socket open and is logged: closing on a
   * database blip would drop everyone at once, and the per-request check still guards each frame.
   */
  async revalidate(userId?: number): Promise<number> {
    let closed = 0
    const checked = new Map<number, Promise<AppAuthState | null>>()
    for (const live of this.#socketsOf(userId)) {
      let entitled = checked.get(live.sessionId)
      if (!entitled) {
        entitled = this.#options.entitledSession(live.sessionId)
        checked.set(live.sessionId, entitled)
      }
      try {
        if (await entitled === null) {
          live.socket.close(POLICY_CLOSE_CODE, REVOKED_REASON)
          closed++
        }
      } catch (error) {
        this.#options.log("error: cannot revalidate a socket's session", error)
      }
    }
    return closed
  }

  /** Runs {@link revalidate} for everyone every `intervalMs`. Returns a function that stops it. */
  startRevalidation(intervalMs: number): () => void {
    const timer = this.#clock.setInterval(() => void this.revalidate(), intervalMs)
    return () => this.#clock.clearInterval(timer)
  }

  /**
   * Closes every socket of one user, whatever their session says. Returns how many it closed. The
   * policy code tells a client not to expect the session to work again; a development script
   * passes another code to look like a dropped connection.
   */
  closeUser(userId: number, reason: string, code = POLICY_CLOSE_CODE): number {
    let closed = 0
    for (const live of this.#socketsOf(userId)) {
      live.socket.close(code, reason)
      closed++
    }
    return closed
  }

  /** Sends a group's members the hint that it moved to `sequence`. */
  async notifyGroupChange(groupId: string, sequence: number): Promise<NotifyStatus> {
    const outcome = await this.#notifier.notify({ groupId, aggregate: GROUP_AGGREGATE, sequence })
    return outcome.status
  }

  /**
   * Sends the users whose access to a group the change at `sequence` took away the hint of that
   * change, so each of their pages reads again and no longer shows the group. Returns how many
   * sockets it reached. Only the change that removed access calls this; the group's later hints
   * go through {@link notifyGroupChange}, which no longer finds them.
   */
  notifyAccessLoss(groupId: string, sequence: number, userIds: readonly number[]): number {
    return this.registry.sendToUsers(
      userIds.map(String),
      createHint({ groupId, aggregate: GROUP_AGGREGATE, sequence }),
    )
  }

  /**
   * Sends every socket of one user the hint that their own profile or push devices changed, so a
   * second tab reads them again. Returns how many sockets it reached.
   *
   * The hint is stamped with the clock's time in milliseconds: it only has to grow across changes
   * and restarts, and it is never contiguous with the client's cursor, so each hint makes the page
   * read again, which is what a change to a single record needs.
   */
  notifyUserChange(userId: number): number {
    return this.registry.sendToUser(
      String(userId),
      createHint({
        groupId: userChangeGroupId(userId),
        aggregate: USER_AGGREGATE,
        sequence: this.#clock.now(),
      }),
    )
  }

  /**
   * A snapshot of one user's live sockets, found through the registry's per-user index instead of
   * a scan of every socket, or of everyone's when `userId` is omitted. A snapshot, because closing
   * a socket removes it from `#live` while the caller still iterates.
   */
  #socketsOf(userId?: number): LiveSocket[] {
    if (userId === undefined) return [...this.#live.values()]
    const sockets: LiveSocket[] = []
    for (const id of this.registry.socketIdsFor(String(userId))) {
      const live = this.#live.get(id)
      if (live) sockets.push(live)
    }
    return sockets
  }

  /** Closes every socket and stops the registry's timers. */
  shutdown(): void {
    this.registry.shutdown()
  }

  /**
   * The actor of a socket's session as it is now, or `null` when the session may no longer act.
   * A socket whose session ended is closed after the answer: closed first, it would drop the
   * `unauthorized` the client should read.
   */
  async #actorOf(socketId: string): Promise<Actor | null> {
    const live = this.#live.get(socketId)
    if (!live) return null
    const auth = await this.#options.entitledSession(live.sessionId)
    if (!auth) {
      this.#clock.setTimeout(() => live.socket.close(POLICY_CLOSE_CODE, REVOKED_REASON), 0)
      return null
    }
    return actorFromAuth(auth)
  }
}
