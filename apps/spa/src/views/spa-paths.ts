/**
 * Every route of the SPA, in the order the router tries them, and who may open it. `app.tsx` draws
 * its `<Route>`s from this table and the sign-in gate and the unsaved-changes guard read it, so a
 * new page is added here once. Every row must say whether its page is `open` to a signed-out
 * person; a page that is not sends a signed-out visitor to sign-in.
 */
export const SPA_ROUTES = {
  "/sign-up": { open: true },
  // The question after a provider sign-in that nobody here is known by.
  "/sign-up/confirm": { open: true },
  // The code mailed to the address a sign-up gave, before the account is created (#142).
  "/sign-up/code": { open: true },
  "/sign-in": { open: true },
  // Asks for a sign-in link, and the page the link opens, which a signed-in person may open too (#391).
  "/sign-in/link": { open: true },
  "/sign-in/link/open": { open: true },
  // Starts a guest account with one POST as it opens (#224); the app's robots.txt keeps it unlisted.
  "/try": { open: true },
  // A guest adds a sign-in method to keep the account, or answers the method being taken (#224).
  "/keep": { open: false },
  "/keep/taken": { open: false },
  "/totp": { open: true },
  "/forgot-password": { open: true },
  "/reset-password": { open: true },
  "/subscribe": { open: true },
  "/subscribe/confirm": { open: true },
  "/unsubscribe": { open: true },
  "/groups": { open: false },
  // Before `/groups/:groupId`, which would take "new" for a group's id.
  "/groups/new": { open: false },
  // Making a group from an export file; also before `/groups/:groupId`.
  "/groups/import": { open: false },
  // A group's create-only invitation page, matched before the group's own routes.
  "/groups/:groupId/invitations/new": { open: false },
  "/groups/:groupId/notes": { open: false },
  "/groups/:groupId/notes/:noteId": { open: false },
  // A group's page and its tabs (`/members`, `/billing`, `/activity`), after the rows above: one
  // route, so switching tabs keeps the page and its tab list on screen.
  "/groups/:groupId/:tab?": { open: false },
  // An invitation is answered once signed in or signed up.
  "/invite/:token": { open: false },
  "/notifications": { open: false },
  // `/overview` opens the selected group's overview.
  "/overview": { open: false },
  "/overview/:groupId": { open: false },
  "/tags": { open: false },
  // Before the tag's page, or "new" would be read as a tag's id.
  "/tags/new": { open: false },
  "/tags/:tagId": { open: false },
  "/notes": { open: false },
  "/notes/new": { open: false },
  "/notes/:noteId": { open: false },
  // The create-only API token page. Not `/api-tokens/new`: the proxy sends every address that
  // starts with `/api` to the API, so a reload there would never reach the SPA.
  "/tokens/new": { open: false },
  // The profile: the list of its sections, and one section (`/profile/security`).
  "/profile/:section?": { open: false },
  // The home page opens the notes; signed out, the notes send the visitor to sign-in.
  "/": { open: true },
} as const satisfies Record<string, { open: boolean }>

/** The pattern of one route, as wouter reads it. */
export type SpaRoutePath = keyof typeof SPA_ROUTES

/** The routes' patterns, in the order the router tries them. */
export const SPA_ROUTE_PATHS = Object.keys(SPA_ROUTES) as SpaRoutePath[]

/** The first part of a path or pattern: `notes` of `/notes/:noteId`, and `""` of `/`. */
function section(path: string): string {
  return path.split("/")[1] ?? ""
}

const SECTIONS = new Set(SPA_ROUTE_PATHS.map(section))
const MEMBER_SECTIONS = new Set(
  SPA_ROUTE_PATHS.filter((path) => !SPA_ROUTES[path].open).map(section),
)

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
 * `spa-paths.test.ts` fails when one holds both.
 */
export function isMembersOnlyPath(pathname: string): boolean {
  return pathname.startsWith("/") && MEMBER_SECTIONS.has(section(pathname))
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

/** Whether `path` is the profile or one of its sections. */
export function isProfilePath(path: string): boolean {
  return section(path) === "profile"
}
