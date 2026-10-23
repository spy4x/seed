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
  /** The list filtered to the notes that carry one tag (`?tag=`, which the list reads). */
  tagged: (tagId: string) => `/notes?tag=${encodeURIComponent(tagId)}`,
} as const

/** Where the tags pages live. Tags are the SPA's: the website has no session. */
export const TAG_PATHS = {
  /** A group's tags, each a link to its editor, and a delete in each row's menu. */
  list: "/tags",
  /** The create page: the tag editor with no tag yet. */
  new: "/tags/new",
  /** One tag's editor. */
  tag: (tagId: string) => `/tags/${tagId}`,
} as const

/**
 * Where an API token is made. A token is never edited, so there is no list or token page: the
 * tokens are listed on the profile. The address is not under `/api`: the proxy sends every path
 * that starts with those four letters to the API, `/api-tokens` included.
 */
export const API_TOKEN_PATHS = {
  /** The create page: the form, then the new token's secret, shown once. */
  new: "/tokens/new",
} as const

/** The API reference, a page of the product's website (`apps/mpa/routes/docs/api.tsx`). */
export const API_DOCS_PATH = "/docs/api"

/** The pages these screens link to. */
export const SCREEN_PATHS = {
  /** The app's home, which opens the notes. */
  home: "/",
  signIn: "/sign-in",
  signUp: "/sign-up",
  /** Asks "Create a new account?" after a provider sign-in nobody here is known by. */
  confirmSignUp: "/sign-up/confirm",
  /** Asks for the code mailed to the address a sign-up gave, before anything is created. */
  signUpCode: "/sign-up/code",
  oneTimeCode: "/totp",
  forgotPassword: "/forgot-password",
  /** Asks for the address a sign-in link goes to, then says to check the inbox (#391). */
  signInLink: "/sign-in/link",
  /** The page a sign-in link opens, with its token in the fragment. */
  signInLinkOpen: "/sign-in/link/open",
  /** The profile: its list of sections on a phone, its first section from `md` up. */
  profile: "/profile",
  groups: "/groups",
  /** The in-app inbox. */
  notifications: "/notifications",
  /**
   * The e-mail address, on the profile's Account section, with the dialog open at its code while an
   * address waits for one.
   */
  email: "/profile/account?verify",
  /** Asks for the address to send news to. */
  subscribe: "/subscribe",
} as const

/** The profile's sections, in the order its navigation lists them. */
export const PROFILE_SECTIONS = [
  "account",
  "security",
  "region",
  "appearance",
  "notifications",
  "api-tokens",
  "danger-zone",
] as const

/** One section of the profile, the last part of its address. */
export type ProfileSectionId = typeof PROFILE_SECTIONS[number]

/** Whether `value` names a section of the profile. */
export function isProfileSection(value: string): value is ProfileSectionId {
  return (PROFILE_SECTIONS as readonly string[]).includes(value)
}

/** Where each section of the profile lives: `/profile/<section>`. */
export function profilePath(section: ProfileSectionId): string {
  return `${SCREEN_PATHS.profile}/${section}`
}

/**
 * The query parameter that carries the page a signed-out person asked for through sign-in, so
 * sign-in can return there.
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

/** Whether `path` (a checked `next`) is an invitation's page, `/invite/<token>`. */
export function isInvitationPath(path: string | null): boolean {
  return path?.startsWith(`/invite/`) ?? false
}

/** `path` with `next` as its query, or `path` alone without one. */
export function withNext(path: string, next: string | null): string {
  return next ? `${path}?${new URLSearchParams({ [NEXT_PARAM]: next })}` : path
}

/** Where a finished sign-in goes: the checked `next`, or the notes list without one. */
export function afterSignIn(next: string | null): string {
  return next ?? NOTE_PATHS.list
}

/** Where the group overview lives: `/overview` opens the selected group's. */
export const OVERVIEW_PATHS = {
  root: "/overview",
  group: (groupId: string) => `/overview/${encodeURIComponent(groupId)}`,
} as const

/** Where a group's own pages live. */
export const GROUP_PATHS = {
  /** The create page: the group editor with no group yet. */
  new: "/groups/new",
  /** The page that makes a new group from an export file. */
  import: "/groups/import",
  /** The group's page on its General tab: the name, description, emoji and colour. */
  settings: (groupId: string) => `/groups/${encodeURIComponent(groupId)}`,
  /** The group's Members tab: the members and the pending invitations. */
  members: (groupId: string) => `/groups/${encodeURIComponent(groupId)}/members`,
  /** The group's Plan and billing tab: what it pays, and the owner's way to change it. */
  billing: (groupId: string) => `/groups/${encodeURIComponent(groupId)}/billing`,
  /** The group's Activity tab, its log, for its admins and owner. */
  activity: (groupId: string) => `/groups/${encodeURIComponent(groupId)}/activity`,
  /** The page that makes an invitation to the group, then shows its link once. */
  invite: (groupId: string) => `/groups/${encodeURIComponent(groupId)}/invitations/new`,
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
