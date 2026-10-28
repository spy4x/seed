import { signal } from "@preact/signals"
import { type PlanRefusal, readPlanRefusal } from "@domain/billing"
import type { GroupRole } from "@domain/groups"
import {
  type CreatedInvitation,
  EMPTY_INVITATION_DRAFT,
  type InvitationDraft,
  type InvitationPreviewRow,
  type InvitationRow,
} from "@ui/group-invitations.tsx"
import { GUEST_REFUSAL_CODE } from "@domain/identity"
import { readApiError } from "@domain/errors"
import { fetchAsUser } from "./realtime-call.ts"
import { guestRefusal, refusedAction } from "./guest-refusal.ts"
import { type LocalReads, localReads, noLocalReads } from "../modules.ts"
import { READ_KEYS } from "./read-keys.ts"
import { ReadRefused } from "@spy4x/realtime/read-cache"
import { apiErrorText, appText } from "../i18n.ts"

/** `fetch`, or a test's stand-in for it. */
export type InvitationFetch = (url: string, init?: RequestInit) => Promise<Response>

/**
 * A refused call: the API's own message and error code, and the plan refusal when the plan said
 * no.
 */
export interface InvitationFailure {
  message: string
  /** The API's error code, such as `SEAT_PRICE_NOT_ACCEPTED`; `null` when there was no answer. */
  code: string | null
  plan: PlanRefusal | null
}

type Outcome<T> =
  | { ok: true; data: T }
  | { ok: false; failure: InvitationFailure; status?: number }

/** Which invitation an answer is for: the token of a link, or the id of one sent to an address. */
export type InvitationRef = { token: string } | { invitationId: string }

function groupPath(groupId: string, rest = ""): string {
  return `/api/groups/${encodeURIComponent(groupId)}/invitations${rest}`
}

/**
 * Invitations on both sides: a group's pending ones with create and revoke, for its owner and
 * admins, and the one behind a link or sent to the person's address, with accept and decline.
 *
 * It calls `fetch` itself instead of `apiFetch`: a plan refusal names its entitlement and limit
 * in `error.details`, which `apiFetch` leaves out. The created link
 * is kept in memory only, and dropped when the page closes, since it is never shown again.
 */
export function createInvitationsStore(
  { fetch = globalThis.fetch, origin = () => globalThis.location.origin, device = noLocalReads }: {
    fetch?: InvitationFetch
    /** The read copies the two lists are kept in. Default: none, every read asks the server. */
    device?: LocalReads
    /** The app's origin, which the copied link starts with. */
    origin?: () => string
  } = {},
) {
  /** One call. Rejects when the server is unreachable; a refusal is an outcome. */
  async function request<T>(method: string, url: string, body?: unknown): Promise<Outcome<T>> {
    const init: RequestInit = {
      method,
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }
    // The request names the page's user, and a 401 signs the page out, as every call does.
    const response = await fetchAsUser(url, init, fetch)
    const json: unknown = await response.json().catch(() => null)
    if (response.ok) return { ok: true, data: json as T }
    const error = readApiError(json)
    const code = error?.reason ?? null
    // A refusal without a reason comes from the shared guards or the catch-all, whose sentence
    // was not written for these screens.
    const message = code !== null && error
      ? apiErrorText(error)
      : appText(`GroupInvitations.somethingWrong`)
    // A guest refused an invite (#224): the frame shows the refusal, as `apiFetch` does for others.
    if (code === GUEST_REFUSAL_CODE) guestRefusal.value = refusedAction(url) ?? "other"
    return {
      ok: false,
      status: response.status,
      failure: { message, code, plan: readPlanRefusal(error?.details) },
    }
  }

  /** The outcome of a call that never reached the server, in the page's language now. */
  const unreachable = (): Outcome<never> => ({
    ok: false,
    failure: { message: appText(`GroupInvitations.unreachable`), code: null, plan: null },
  })

  /** One call whose every failure is an outcome: an unreachable server says so. */
  async function call<T>(method: string, url: string, body?: unknown): Promise<Outcome<T>> {
    try {
      return await request<T>(method, url, body)
    } catch (_unreachable) {
      return unreachable()
    }
  }

  /**
   * A list read kept on the device under `key`: the answer replaces the copy, and the copy answers
   * when the server is unreachable. `early` is given the copy before the server has answered.
   */
  async function readList<T>(
    key: string,
    url: string,
    early: (copy: T | undefined) => boolean | void,
  ): Promise<Outcome<T>> {
    try {
      const answer = await device.through(key, async () => {
        const result = await request<T>("GET", url)
        if (!result.ok) {
          throw new ReadRefused(result.failure, result.status ?? 0, result.failure.code)
        }
        return result.data
      }, (copy) => early(copy?.value))
      return { ok: true, data: answer.value }
    } catch (cause) {
      return cause instanceof ReadRefused
        ? { ok: false, failure: cause.failure as InvitationFailure }
        : unreachable()
    }
  }

  // The group's side.
  const groupId = signal<string | null>(null)
  const invitations = signal<readonly InvitationRow[] | null>(null)
  const loadError = signal<string | null>(null)
  const draft = signal<InvitationDraft>(EMPTY_INVITATION_DRAFT)
  /** The creator ticked the per-member price confirmation of a group billed per member. */
  const acceptSeatPrice = signal(false)
  const creating = signal(false)
  const createError = signal<InvitationFailure | null>(null)
  const created = signal<CreatedInvitation | null>(null)
  const revokingId = signal<string | null>(null)
  const revokeError = signal<{ invitationId: string; message: string } | null>(null)
  let reads = 0

  /** Reads the open group's pending invitations. A viewer or editor gets an error, never shown. */
  async function refresh(): Promise<void> {
    const id = groupId.value
    if (id === null) return
    const read = ++reads
    const result = await readList<{ invitations: InvitationRow[] }>(
      READ_KEYS.groupInvitations(id),
      groupPath(id),
      (copy) => {
        if (read !== reads || groupId.value !== id) return false
        if (copy && invitations.value !== null) return false
        invitations.value = copy ? copy.invitations : null
      },
    )
    if (read !== reads || groupId.value !== id) return
    if (result.ok) {
      invitations.value = result.data.invitations
      loadError.value = null
    } else loadError.value = result.failure.message
  }

  /** Shows the invitations of `id`. */
  function open(id: string): Promise<void> {
    if (groupId.value !== id) {
      closeGroup()
      groupId.value = id
    }
    return refresh()
  }

  /** Creates an invitation from the draft and keeps its link to show this once. */
  async function create(): Promise<boolean> {
    const id = groupId.value
    if (id === null || creating.value) return false
    creating.value = true
    createError.value = null
    created.value = null
    const { role, expiresInDays, maxUses, email, sendEmail } = draft.value
    const result = await call<{ token: string; mailSent: boolean }>("POST", groupPath(id), {
      role,
      expiresInDays,
      maxUses,
      email: email.trim() || null,
      sendEmail,
      acceptSeatPrice: acceptSeatPrice.value,
    })
    creating.value = false
    if (groupId.value !== id) return false
    if (!result.ok) {
      createError.value = result.failure
      return false
    }
    created.value = {
      link: new URL(`/invite/${encodeURIComponent(result.data.token)}`, origin()).href,
      mailAsked: sendEmail,
      mailSent: result.data.mailSent,
    }
    draft.value = EMPTY_INVITATION_DRAFT
    acceptSeatPrice.value = false
    await refresh()
    return true
  }

  /** Revokes one pending invitation. */
  async function revoke(invitationId: string): Promise<boolean> {
    const id = groupId.value
    if (id === null || revokingId.value !== null) return false
    revokingId.value = invitationId
    revokeError.value = null
    const result = await call("DELETE", groupPath(id, `/${encodeURIComponent(invitationId)}`))
    revokingId.value = null
    if (groupId.value !== id) return false
    if (!result.ok) {
      revokeError.value = { invitationId, message: result.failure.message }
      return false
    }
    invitations.value = invitations.value?.filter((row) => row.id !== invitationId) ?? null
    return true
  }

  function closeGroup(): void {
    reads++
    groupId.value = null
    invitations.value = null
    loadError.value = null
    draft.value = EMPTY_INVITATION_DRAFT
    acceptSeatPrice.value = false
    creating.value = false
    createError.value = null
    created.value = null
    revokingId.value = null
    revokeError.value = null
  }

  // The invited person's side.
  const preview = signal<InvitationPreviewRow | null>(null)
  const previewLoading = signal(false)
  const previewError = signal<string | null>(null)
  const mine = signal<readonly InvitationPreviewRow[]>([])
  /** The invitation whose answer is in flight: its token or id. */
  const answering = signal<string | null>(null)
  const answerError = signal<
    { ref: string; message: string; plan: PlanRefusal | null } | null
  >(null)

  /** Reads the invitation behind a link. */
  async function loadPreview(token: string): Promise<void> {
    previewLoading.value = true
    previewError.value = null
    preview.value = null
    answerError.value = null
    const result = await call<{ invitation: InvitationPreviewRow }>(
      "POST",
      "/api/invitations/preview",
      { token },
    )
    previewLoading.value = false
    if (result.ok) preview.value = result.data.invitation
    else previewError.value = result.failure.message
  }

  /** Reads the invitations sent to an address the person proved. */
  async function loadMine(): Promise<void> {
    const result = await readList<{ invitations: InvitationPreviewRow[] }>(
      READ_KEYS.myInvitations,
      "/api/invitations/mine",
      (copy) => {
        if (copy && mine.value.length > 0) return false
        mine.value = copy ? copy.invitations : []
      },
    )
    if (result.ok) mine.value = result.data.invitations
  }

  function keyOf(ref: InvitationRef): string {
    return "token" in ref ? ref.token : ref.invitationId
  }

  async function answer<T>(path: string, ref: InvitationRef): Promise<T | null> {
    if (answering.value !== null) return null
    answering.value = keyOf(ref)
    answerError.value = null
    const result = await call<T>("POST", path, ref)
    // An answered row leaves the list in the update that ends the answer, never a render later:
    // the screen moves focus off the row's buttons only while it still knows which row was answered.
    if (result.ok && "invitationId" in ref) {
      mine.value = mine.value.filter((row) => row.id !== ref.invitationId)
    }
    answering.value = null
    if (result.ok) return result.data
    answerError.value = { ref: keyOf(ref), ...result.failure }
    return null
  }

  /** Accepts; resolves to the group joined, or `null` when it was refused. */
  async function accept(
    ref: InvitationRef,
  ): Promise<{ groupId: string; role: GroupRole } | null> {
    const joined = await answer<{ groupId: string; role: GroupRole }>(
      "/api/invitations/accept",
      ref,
    )
    return joined
  }

  /** Declines; resolves to whether it worked. */
  async function decline(ref: InvitationRef): Promise<boolean> {
    const done = await answer("/api/invitations/decline", ref)
    return done !== null
  }

  function reset(): void {
    closeGroup()
    preview.value = null
    previewLoading.value = false
    previewError.value = null
    mine.value = []
    answering.value = null
    answerError.value = null
  }

  return {
    groupId,
    invitations,
    loadError,
    draft,
    acceptSeatPrice,
    creating,
    createError,
    created,
    revokingId,
    revokeError,
    open,
    refresh,
    create,
    revoke,
    closeGroup,
    preview,
    previewLoading,
    previewError,
    mine,
    answering,
    answerError,
    loadPreview,
    loadMine,
    accept,
    decline,
    reset,
  }
}

/** The app's invitations store. */
export const invitationsStore = createInvitationsStore({ device: localReads })
