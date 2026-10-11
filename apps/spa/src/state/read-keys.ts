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
 * neither kept nor hidden by the copy. `status` is the HTTP status: 401, 403 and 404 mean the
 * server refuses this person the list (the device then deletes its copy), anything else, such as a
 * 500, means the server is struggling and the copy stays. A `failure` that is a string is the
 * message of the error.
 */
export class ReadRefused<F> extends Error {
  constructor(readonly failure: F, readonly status: number) {
    super(typeof failure === "string" ? failure : "The server refused the read")
    this.name = "ReadRefused"
  }
}
