import type { ComponentChildren, JSX } from "preact"
import { EnhancedForm, type EnhancedFormLabels } from "@spy4x/preact-ui/enhanced-form"
import { safeRedirectPath } from "@spy4x/net/redirect-path"

/**
 * Follows an in-app link without a page load. The SPA passes its router's `navigate`; a server
 * rendered page passes nothing and every link is an ordinary one.
 */
export type Navigate = (href: string) => void

/**
 * Where the forms of the public mailing-list pages post when no JavaScript takes them over: the
 * MPA's routes. Each form's field names match the API schema of the same action. Every other
 * screen is the SPA's, takes its submit over in code and posts nowhere.
 */
export const FORM_ACTIONS = {
  /** Asks for a confirm link to join a mailing list: `{ email, list }`. */
  subscribe: "/subscribe",
  /** Confirms a subscription with its link's token: `{ list, token }`. */
  subscribeConfirm: "/subscribe/confirm",
  /** Leaves a mailing list with its link's token: `{ list, token }`. */
  unsubscribe: "/unsubscribe",
} as const

/** Where the notes pages live. */
export const NOTE_PATHS = {
  /** The list. */
  list: "/notes",
  /** The create page: the editor with no note yet. */
  new: "/notes/new",
  /** One note's page. */
  note: (noteId: string) => `/notes/${noteId}`,
} as const

/** Where the tags page lives. Tags are the SPA's: the website has no session. */
export const TAG_PATHS = {
  /** A group's tags: create, rename, recolour, delete. */
  list: "/tags",
} as const

/** The pages these screens link to. */
export const SCREEN_PATHS = {
  signIn: "/sign-in",
  signUp: "/sign-up",
  oneTimeCode: "/totp",
  forgotPassword: "/forgot-password",
  profile: "/",
  groups: "/groups",
  /** The in-app inbox. */
  notifications: "/notifications",
  /** The e-mail address: its code, a new code, a change. */
  email: "/email",
  /** Asks for the address to send news to. */
  subscribe: "/subscribe",
} as const

/**
 * The parts of the profile page that the first-steps card links to. The profile is the home page,
 * where the card is, so these are links within the page and the browser scrolls to them itself.
 */
export const PROFILE_ANCHORS = { security: "security", pushDevices: "push-devices" } as const

/**
 * The query parameter, and the hidden field of each auth form, that carries the page a signed-out
 * person asked for through sign-in, so sign-in can return there.
 */
export const NEXT_PARAM = "next"

/**
 * The checked `next` value: `value` when it is a page of this app, the notes list otherwise. The
 * rules are `safeRedirectPath`'s (one leading `/`, no `//`, backslash, scheme or control
 * character, encoded or not), and every `/api` path is refused.
 *
 * Every hop that carries `next` checks it again here, since a person can edit each one: the
 * sign-in and sign-up pages, their posts, the one-time-code page and its post. OAuth sign-in
 * (spy4x/template#141) plugs in here too: its start route checks `next` with this, keeps the
 * result in the flow state (`OAuthPendingFlow`) and redirects to that stored value after the
 * callback, never to a value read from the callback's query.
 */
export function checkedNext(value: string): string {
  return safeRedirectPath(value, { fallback: NOTE_PATHS.list, refuse: ["/api"] })
}

/** The checked `next` of a query or a form, or `null` when it carries none. */
export function readNext(source: { get(name: string): unknown }): string | null {
  const value = source.get(NEXT_PARAM)
  return typeof value === "string" && value !== "" ? checkedNext(value) : null
}

/** `path` with `next` as its query, or `path` alone without one. */
export function withNext(path: string, next: string | null): string {
  return next ? `${path}?${new URLSearchParams({ [NEXT_PARAM]: next })}` : path
}

/** Where a finished sign-in goes: the checked `next`, or the profile without one. */
export function afterSignIn(next: string | null): string {
  return next ?? SCREEN_PATHS.profile
}

/** Where a group's own pages live. */
export const GROUP_PATHS = {
  /** The group's settings page. */
  settings: (groupId: string) => `/groups/${encodeURIComponent(groupId)}`,
  /** The group's activity log, for its admins and owner. */
  activity: (groupId: string) => `/groups/${encodeURIComponent(groupId)}/activity`,
} as const

/** `EnhancedForm` announces nothing itself: each screen shows its own busy button and error. */
const QUIET: EnhancedFormLabels = { sending: "", done: "", failed: "" }

/**
 * A screen's form: `EnhancedForm` posting to `action`. Without `onSubmit`, the browser posts as
 * usual; with it, the native post is cancelled and `onSubmit` is called. While `pending`, the
 * fields are disabled and a second submit is refused. Only the public mailing-list pages (the
 * MPA's) post natively; an SPA form leaves `action` out and always has `onSubmit`.
 */
export function ScreenForm(
  { action, pending = false, onSubmit, class: className, children }: {
    action?: string
    pending?: boolean
    /** Called with the form's fields, so a callback can read what the browser would have posted. */
    onSubmit?: (data: FormData) => void
    class?: string
    children: ComponentChildren
  },
): JSX.Element {
  return (
    <EnhancedForm
      action={action}
      method="post"
      status={pending ? "sending" : "idle"}
      labels={QUIET}
      onSubmit={onSubmit && ((data) => onSubmit(data))}
      // EnhancedForm spaces its fields from its status line, which stays empty here: space-y-0!
      // overrides its space-y-4 (the `!` is needed since preact-components 3), so the empty line
      // takes no room.
      class={className ? `space-y-0! ${className}` : "space-y-0!"}
    >
      {children}
    </EnhancedForm>
  )
}
