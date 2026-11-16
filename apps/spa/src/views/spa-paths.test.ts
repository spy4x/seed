import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { renderToString } from "preact-render-to-string"
import { h } from "preact"
import { matchRoute, useRouter } from "wouter-preact"
import { OAUTH_PAGES } from "@domain/identity"
import { createTranslator, type Translator } from "@spy4x/platform/universal/i18n"
import app from "@i18n/app/en.ts"
import site from "@i18n/site/en.ts"
import {
  announcedPage,
  isMembersOnlyPath,
  isProfilePath,
  isSpaPath,
  SPA_ROUTE_PATHS,
  SPA_ROUTES,
  spaPageTitle,
} from "./spa-paths.ts"

/** An address the pattern matches: every `:name` filled in, an optional `:name?` too. */
const addressOf = (pattern: string) => pattern.replace(/:\w+\??/g, "abc")

describe("isSpaPath", () => {
  it("knows the SPA's own paths", () => {
    for (
      const path of [
        "/",
        "/notes",
        "/notes/new",
        "/tags",
        "/notifications",
        "/groups",
        "/invite/AbC_9",
        "/sign-in",
        "/totp",
        "/profile",
        "/profile/security",
        "/subscribe",
        "/subscribe/confirm",
        "/unsubscribe",
      ]
    ) {
      expect(isSpaPath(path), path).toBe(true)
    }
  })

  it("owns an address of every route in the table", () => {
    for (const pattern of SPA_ROUTE_PATHS) {
      expect(isSpaPath(addressOf(pattern)), pattern).toBe(true)
    }
  })

  it("routes no page whose address starts with /api, which the proxy sends to the API", () => {
    for (const pattern of SPA_ROUTE_PATHS) {
      expect(pattern.startsWith("/api"), pattern).toBe(false)
    }
  })

  it("leaves server paths to the browser", () => {
    for (const path of ["/api/ws", "/notesx", "/assets/app.js", "notes"]) {
      expect(isSpaPath(path), path).toBe(false)
    }
  })
})

describe("isMembersOnlyPath", () => {
  it("is true for an address of every route that is not open, and false for every open one", () => {
    for (const pattern of SPA_ROUTE_PATHS) {
      expect(isMembersOnlyPath(addressOf(pattern)), pattern).toBe(!SPA_ROUTES[pattern].open)
    }
  })

  it("counts every address under a members' page, and none outside the app", () => {
    expect(isMembersOnlyPath("/notes/abc/history")).toBe(true)
    for (const path of ["/notesy", "/api/groups", "/assets/app.js"]) {
      expect(isMembersOnlyPath(path), path).toBe(false)
    }
  })

  it("leaves open the pages a signed-out person needs to sign in or read", () => {
    const open = SPA_ROUTE_PATHS.filter((pattern) => SPA_ROUTES[pattern].open)
    expect(open).toEqual([
      "/sign-up",
      "/sign-up/confirm",
      "/sign-up/code",
      "/sign-in",
      "/sign-in/code",
      "/sign-in/link",
      "/sign-in/link/open",
      "/try",
      "/totp",
      "/forgot-password",
      "/reset-password",
      "/subscribe",
      "/subscribe/confirm",
      "/unsubscribe",
      "/",
    ])
  })
})

describe("the pages a provider's callback redirects to", () => {
  it("are all routed, and open to a person who is not signed in yet, but a guest's keep pages", () => {
    // A provider sends a guest back to `/keep` or `/keep/taken` with the guest's session.
    const guestOnly: string[] = [OAUTH_PAGES.keep, OAUTH_PAGES.keepTaken]
    const { signInMethods: _linking, ...pages } = OAUTH_PAGES
    for (const path of Object.values(pages)) {
      expect(SPA_ROUTE_PATHS as string[], path).toContain(path)
      expect(isMembersOnlyPath(path), path).toBe(guestOnly.includes(path))
    }
  })

  it("sends a finished link to the profile's sign-in methods, a members' page", () => {
    expect(routeFor(OAUTH_PAGES.signInMethods)).toBe("/profile/:section?")
    expect(isMembersOnlyPath(OAUTH_PAGES.signInMethods)).toBe(true)
  })
})

/** The router's own pattern parser, as `<Switch>` uses it, read from wouter's default router. */
function routerParser(): Parameters<typeof matchRoute>[0] {
  let parser: Parameters<typeof matchRoute>[0] | undefined
  renderToString(h(() => {
    parser = useRouter().parser
    return null
  }, {}))
  if (!parser) throw new Error("wouter gave no parser")
  return parser
}

/** The route `<Switch>` draws for `path`: the first row of the table whose pattern matches it. */
function routeFor(path: string): string | undefined {
  const parser = routerParser()
  return SPA_ROUTE_PATHS.find((pattern) => matchRoute(parser, pattern, path)[0])
}

describe("the route order", () => {
  it("draws every page of the table at its own address, never at an earlier row's", () => {
    for (const pattern of SPA_ROUTE_PATHS) {
      expect(routeFor(addressOf(pattern)), pattern).toBe(pattern)
    }
  })

  it("opens each create page, not an item called new", () => {
    for (
      const path of [
        "/groups/new",
        "/tags/new",
        "/notes/new",
        "/tokens/new",
        "/imports/new",
        "/groups/abc/invitations/new",
      ]
    ) {
      expect(routeFor(path), path).toBe(path.replace("/abc/", "/:groupId/"))
    }
    expect(routeFor("/tags/abc")).toBe("/tags/:tagId")
    expect(routeFor("/imports/abc")).toBe("/imports/:importId")
    expect(routeFor("/groups/abc")).toBe("/groups/:groupId/:tab?")
  })

  it("draws a group's page and each of its tabs from one route, and its notes' old links from theirs", () => {
    for (const path of ["/groups/abc", "/groups/abc/members", "/groups/abc/billing"]) {
      expect(routeFor(path), path).toBe("/groups/:groupId/:tab?")
    }
    expect(routeFor("/groups/abc/activity")).toBe("/groups/:groupId/:tab?")
    expect(routeFor("/groups/abc/notes")).toBe("/groups/:groupId/notes")
  })
})

describe("the profile's routes", () => {
  it("draws the profile and each of its sections from one route", () => {
    for (const path of ["/profile", "/profile/account", "/profile/danger-zone"]) {
      expect(routeFor(path), path).toBe("/profile/:section?")
      expect(isProfilePath(path), path).toBe(true)
    }
    for (const path of ["/", "/notes", "/profiles"]) {
      expect(isProfilePath(path), path).toBe(false)
    }
  })
})

describe("announcedPage", () => {
  it("counts a group's tabs as one page, so choosing a tab moves no focus", () => {
    for (const path of ["/groups/abc", "/groups/abc/members", "/groups/abc/billing"]) {
      expect(announcedPage(path), path).toBe("/groups/abc")
    }
    expect(announcedPage("/groups/abc/activity?checkout=done")).toBe("/groups/abc?checkout=done")
  })

  it("leaves every other address as it is", () => {
    for (
      const path of ["/groups", "/groups/new", "/groups/abc/notes", "/groups/abc/invitations/new"]
    ) {
      expect(announcedPage(path), path).toBe(path)
    }
  })
})

describe("spaPageTitle", () => {
  const english = createTranslator({
    language: `en`,
    catalogs: [{ source: app }, { source: site }],
  })
  const title = (path: string, notes = true, t: Translator<string> = english) =>
    spaPageTitle(t, path, notes, routerParser())

  it("names each page, then the product", () => {
    expect(title("/notes")).toBe("Notes · Seed")
    expect(title("/notes/new")).toBe("New note · Seed")
    expect(title("/notes/abc")).toBe("Note · Seed")
    expect(title("/tags/new")).toBe("New tag · Seed")
    expect(title("/groups")).toBe("Groups · Seed")
    expect(title("/overview/abc")).toBe("Overview · Seed")
    expect(title("/sign-in")).toBe("Welcome back · Seed")
    // The newsletter's pages take their name from the website's catalog.
    expect(title("/unsubscribe")).toBe("Unsubscribe · Seed")
  })

  it("gives every route but the home page's redirect a name from the catalogs", () => {
    for (const pattern of SPA_ROUTE_PATHS) {
      const key = SPA_ROUTES[pattern].title
      if (pattern === "/") {
        expect(key).toBe(null)
        continue
      }
      expect(key, pattern).not.toBe(null)
      expect(english.t(key!), pattern).not.toBe(key)
      expect(title(addressOf(pattern)), pattern).toBe(`${english.t(key!)} · Seed`)
    }
  })

  it("names a group's tabs and the profile's sections after their page", () => {
    for (const path of ["/groups/abc", "/groups/abc/members", "/groups/abc/billing"]) {
      expect(title(path), path).toBe("Group · Seed")
    }
    expect(title("/groups/abc/invitations/new")).toBe("New invitation · Seed")
    expect(title("/profile/security")).toBe("Profile · Seed")
  })

  it("reads the product's name alone where no page is drawn", () => {
    expect(title("/")).toBe("Seed")
    expect(title("/nowhere")).toBe("Seed")
    expect(title("/notes/abc/extra")).toBe("Seed")
    expect(title("/notes", false)).toBe("Seed")
    expect(title("/tags/abc", false)).toBe("Seed")
  })

  it("names the page in the translator's language", () => {
    const marked = { ...english, t: (key: string) => `⟦${english.t(key)}⟧` }
    expect(title("/notes", true, marked)).toBe("⟦Notes⟧ · Seed")
  })
})
