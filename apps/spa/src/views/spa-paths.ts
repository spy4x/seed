import { matchRoute } from "wouter-preact"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { pageTitle } from "@ui/brand.ts"

/**
 * Every route of the SPA, in the order the router tries them, and who may open it. `app.tsx` draws
 * its `<Route>`s from this table and the sign-in gate and the unsaved-changes guard read it, so a
 * new page is added here once. Every row must say whether its page is `open` to a signed-out
 * person; a page that is not sends a signed-out visitor to sign-in. Its `title` is the catalog key
 * of the page's name in the browser tab (`spaPageTitle`), usually its heading's; `null` leaves the
 * product's name alone, for a page that only sends the visitor on.
 */
export const SPA_ROUTES = {
  "/sign-up": { open: true, title: "AuthScreen.signUpTitle" },
  // The question after a provider sign-in that nobody here is known by.
  "/sign-up/confirm": { open: true, title: "ConfirmSignUpScreen.title" },
  // The code mailed to the address a sign-up gave, before the account is created.
  "/sign-up/code": { open: true, title: "SignUpCodeScreen.title" },
  "/sign-in": { open: true, title: "AuthScreen.signInTitle" },
  // Asks for a sign-in code, which a signed-in person may open too for fresh proof.
  "/sign-in/code": { open: true, title: "SignInCodeScreen.title" },
  // Sign-in once mailed a link: both old pages redirect to the code page.
  "/sign-in/link": { open: true, title: "SignInCodeScreen.title" },
  "/sign-in/link/open": { open: true, title: "SignInCodeScreen.title" },
  // Starts a guest account with one POST as it opens; the app's robots.txt keeps it unlisted.
  "/try": { open: true, title: "GuestScreens.tryTitle" },
  // A guest adds a sign-in method to keep the account, or answers the method being taken.
  "/keep": { open: false, title: "GuestScreens.keep" },
  "/keep/taken": { open: false, title: "GuestScreens.keep" },
  "/totp": { open: true, title: "AuthScreen.codeTitle" },
  "/forgot-password": { open: true, title: "AuthScreen.forgotPassword" },
  "/reset-password": { open: true, title: "AuthScreen.forgotPassword" },
  "/subscribe": { open: true, title: "SubscribeForm.title" },
  "/subscribe/confirm": { open: true, title: "SubscriptionConfirm.title" },
  "/unsubscribe": { open: true, title: "Unsubscribe.title" },
  "/groups": { open: false, title: "Groups.title" },
  // Before `/groups/:groupId`, which would take "new" for a group's id.
  "/groups/new": { open: false, title: "GroupEditor.newTitle" },
  // Making a group from an export file; also before `/groups/:groupId`.
  "/groups/import": { open: false, title: "GroupImport.title" },
  // A group's create-only invitation page, matched before the group's own routes.
  "/groups/:groupId/invitations/new": { open: false, title: "InvitationNew.title" },
  "/groups/:groupId/notes": { open: false, title: "Notes.title" },
  "/groups/:groupId/notes/:noteId": { open: false, title: "NoteEditor.title" },
  // A group's page and its tabs (`/members`, `/billing`, `/activity`), after the rows above: one
  // route, so switching tabs keeps the page and its tab list on screen.
  "/groups/:groupId/:tab?": { open: false, title: "GroupEditor.title" },
  // An invitation is answered once signed in or signed up.
  "/invite/:token": { open: false, title: "AuthScreen.invitedTitle" },
  "/notifications": { open: false, title: "NotificationsScreen.title" },
  // `/overview` opens the selected group's overview.
  "/overview": { open: false, title: "OverviewScreen.title" },
  "/overview/:groupId": { open: false, title: "OverviewScreen.title" },
  "/tags": { open: false, title: "Tags.title" },
  // Before the tag's page, or "new" would be read as a tag's id.
  "/tags/new": { open: false, title: "TagEditor.new" },
  "/tags/:tagId": { open: false, title: "TagEditor.title" },
  "/notes": { open: false, title: "Notes.title" },
  "/notes/new": { open: false, title: "NewNote.title" },
  "/notes/:noteId": { open: false, title: "NoteEditor.title" },
  // The create-only API token page. Not `/api-tokens/new`: the proxy sends every address that
  // starts with `/api` to the API, so a reload there would never reach the SPA.
  "/tokens/new": { open: false, title: "ApiTokenNewScreen.title" },
  // A file import's picker (`?kind=notes`), before an import's page, which would take "new" for
  // its id. The pages name no kind, so they stay routed with the notes off.
  "/imports/new": { open: false, title: "Import.title" },
  "/imports/:importId": { open: false, title: "Import.title" },
  // The benchmark: only in a development build and on the public demo (`benchmarkOpen`).
  "/benchmark": { open: false, title: "Benchmark.title" },
  // The profile: the list of its sections, and one section (`/profile/security`).
  "/profile/:section?": { open: false, title: "ProfileScreen.title" },
  // The home page (`HomeView`) opens the notes (the overview with them off), or a new owner's plan;
  // signed out, sign-in.
  "/": { open: true, title: null },
} as const satisfies Record<string, { open: boolean; title: string | null }>

/** The pattern of one route, as wouter reads it. */
export type SpaRoutePath = keyof typeof SPA_ROUTES

/** The routes' patterns, in the order the router tries them. */
export const SPA_ROUTE_PATHS = Object.keys(SPA_ROUTES) as SpaRoutePath[]

/**
 * Whether `path` is a page of the notes example: the notes, the tags, a group's old notes links and
 * the new API token page, since the personal-token API serves the notes only. They are not routed
 * when the product turns the notes off (`SPA_NOTES=false`).
 */
export function isNotesRoute(path: SpaRoutePath): boolean {
  return [`notes`, `tags`, `tokens`].includes(section(path)) ||
    path.startsWith(`/groups/:groupId/notes`)
}

/** The routes the router tries, in order: with `notes` off, none of {@link isNotesRoute}. */
export function spaRoutePaths(notes: boolean): SpaRoutePath[] {
  return notes ? SPA_ROUTE_PATHS : SPA_ROUTE_PATHS.filter((path) => !isNotesRoute(path))
}

/** The first part of a path or pattern: `notes` of `/notes/:noteId`, and `""` of `/`. */
function section(path: string): string {
  return path.split("/")[1] ?? ""
}

const SECTIONS = new Set(SPA_ROUTE_PATHS.map(section))
/** The first parts of the routes that are not open, with and without the notes' routes. */
const memberSections = (notes: boolean) =>
  new Set(spaRoutePaths(notes).filter((path) => !SPA_ROUTES[path].open).map(section))
const MEMBER_SECTIONS = { on: memberSections(true), off: memberSections(false) }

/**
 * Whether the SPA's router owns `pathname`: its first part is the first part of a route. Anything
 * else (`/api/…`, a built file) is left to the browser.
 */
export function isSpaPath(pathname: string): boolean {
  return pathname.startsWith("/") && SECTIONS.has(section(pathname))
}

/**
 * Whether `pathname` is a page only a signed-in person can use: its first part is the first part of
 * a route that is not open. Every address under such a part counts, so a mistyped note link still
 * asks for sign-in first. A part therefore holds open routes or members' routes, never both;
 * `spa-paths.test.ts` fails when one holds both. With `notes` off (`SPA_NOTES=false`) the notes',
 * tags' and new token's addresses are not routed, so they show the not-found page instead of asking for sign-in.
 */
export function isMembersOnlyPath(pathname: string, notes = true): boolean {
  return pathname.startsWith("/") &&
    MEMBER_SECTIONS[notes ? "on" : "off"].has(section(pathname))
}

/** The tab part of a group page's address: `/groups/:groupId/members` and its siblings. */
const GROUP_TAB = /^(\/groups\/[^/]+)\/(members|billing|activity)$/

/**
 * The page an address shows, for the route announcer: a group page's tabs count as one page, so
 * choosing a tab leaves focus on the tab, as the tabs pattern asks, instead of moving it to the
 * heading.
 */
export function announcedPage(path: string): string {
  const [pathname, query = ""] = path.split(/(?=[?#])/, 2)
  return pathname.replace(GROUP_TAB, "$1") + query
}

/**
 * The browser tab's title for `path`: the name of the page the router draws there, then the
 * product's (`Notes · Seed`), from the first row of the table whose pattern matches, as `<Switch>`
 * picks it. A group's tabs and the profile's sections share their page's name. An address no route
 * answers, or a notes page with the notes off, reads the product's name alone.
 *
 * @param parser The router's pattern parser (`useRouter().parser`).
 */
export function spaPageTitle(
  t: Translator<string>,
  path: string,
  notes: boolean,
  parser: Parameters<typeof matchRoute>[0],
): string {
  const route = spaRoutePaths(notes).find((pattern) => matchRoute(parser, pattern, path)[0])
  const key = route && SPA_ROUTES[route].title
  return pageTitle(key && t.t(key))
}

/** Whether `path` is the profile or one of its sections. */
export function isProfilePath(path: string): boolean {
  return section(path) === "profile"
}
