import { isForeignAnswer, RealtimeRequestError } from "@spy4x/realtime"

/**
 * The name of every read copy the device keeps (ADR 003, level 2 "offline-readable"): one key per
 * list, in the read cache of the signed-in user. A store reads through its key
 * (`LocalReads` in `apps/spa/src/modules.ts`); nothing else names one. Notes are not here: they are
 * offline-writable and keep their own copy beside their queue (`apps/spa/src/offline/`).
 */
export const READ_KEYS = {
  groups: "groups",
  profile: "profile",
  members: (groupId: string) => `members:${groupId}`,
  groupInvitations: (groupId: string) => `invitations:${groupId}`,
  myInvitations: "invitations:mine",
  notifications: (cursor: string | null) => `notifications:${cursor ?? ""}`,
  unreadCount: "notifications:unread",
  activity: (groupId: string, cursor: string | null) => `activity:${groupId}:${cursor ?? ""}`,
  billing: (groupId: string) => `billing:${groupId}`,
  apiTokens: "api-tokens",
  devices: "devices",
} as const

/**
 * Carries an answer of the server that is not the list out of a read made through the device.
 * `LocalReads.through` keeps an answer and falls back to the copy only when the server is
 * unreachable; every REST reader throws this for an answer that is not `ok`, so the answer is
 * neither kept nor hidden by the copy. `status` is the HTTP status and `code` the `error.code` of
 * the error body, absent when the answer carried none. 401, 403 and a 404 with a code mean the
 * server refuses this person the list (the device then deletes its copy). A 5xx, a 404 or a 429
 * without a code is taken for an answer of the proxy in front of the API (`isForeignAnswer` in
 * `@spy4x/realtime`): the copy answers it, as it does with no network. That also holds for the
 * API's own answers that carry no code: the rate limiter's 429 and the auth routes' errors, which
 * are `{ error: "<message>" }`, and the plain-text 500 of an error no route handled. Anything
 * else, such as a 500 with a code, means the server is struggling: the error shows and the copy
 * stays. A `failure` that is a string is the message of the error.
 */
export class ReadRefused<F> extends Error {
  constructor(readonly failure: F, readonly status: number, readonly code?: string | null) {
    super(typeof failure === "string" ? failure : "The server refused the read")
    this.name = "ReadRefused"
  }
}

const REFUSING_STATUSES = [401, 403, 404]

/**
 * Whether a REST read's answer is taken for a proxy's, such as a 502 during a deploy. The API's own
 * answers without an error code (a rate limit's 429, an unhandled error's 500) count too.
 */
export function isProxyAnswer(error: unknown): boolean {
  return error instanceof ReadRefused && isForeignAnswer(error.status, error.code)
}

/**
 * Whether the server answered that this person may not read the list (or that it is gone): a
 * socket read refused with `unauthorized`, `forbidden` or `not_found`, or a REST read answered
 * 401, 403 or 404. Any other failure, such as a 500 or a timeout, says nothing about access, and
 * neither does a 404 without an error code, which is taken for a proxy's.
 */
export function isRefusal(error: unknown): boolean {
  if (error instanceof ReadRefused) {
    return REFUSING_STATUSES.includes(error.status) && !isProxyAnswer(error)
  }
  return error instanceof RealtimeRequestError &&
    (error.code === "unauthorized" || error.code === "forbidden" || error.code === "not_found")
}
