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
  "/sign-in": { open: true },
  "/totp": { open: true },
  "/forgot-password": { open: true },
  "/reset-password": { open: true },
  "/email": { open: false },
  "/subscribe": { open: true },
  "/subscribe/confirm": { open: true },
  "/unsubscribe": { open: true },
  "/groups": { open: false },
  // Before `/groups/:groupId`, which would take "new" for a group's id.
  "/groups/new": { open: false },
  "/groups/:groupId": { open: false },
  "/groups/:groupId/activity": { open: false },
  "/groups/:groupId/pricing": { open: false },
  "/groups/:groupId/notes": { open: false },
  "/groups/:groupId/notes/:noteId": { open: false },
  // An invitation is answered once signed in or signed up.
  "/invite/:token": { open: false },
  "/notifications": { open: false },
  "/tags": { open: false },
  // Before the tag's page, or "new" would be read as a tag's id.
  "/tags/new": { open: false },
  "/tags/:tagId": { open: false },
  "/notes": { open: false },
  "/notes/new": { open: false },
  "/notes/:noteId": { open: false },
  // The profile says "sign in" to a signed-out visitor instead of sending them away.
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
