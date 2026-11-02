import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { App } from "fresh"
import { renderToString } from "preact-render-to-string"
import { IconArrowLeft, IconArrowRight, IconChevronRight } from "@spy4x/preact-icons"
import AppWrapper from "./routes/_app.tsx"
import Layout from "./routes/_layout.tsx"
import Admin from "./routes/[[lang]]/admin.tsx"
import Features from "./routes/[[lang]]/features.tsx"
import Home from "./routes/index.tsx"
import { pageMiddleware } from "./middleware.ts"
import type { State } from "./utils.ts"

const config = {
  apiUrl: "http://api:8000",
  webAppOrigin: "https://www.example.com",
  apiOrigin: "https://app.example.com",
}
const info = {
  remoteAddr: { transport: "tcp", hostname: "192.0.2.7", port: 4000 },
  completed: Promise.resolve(),
} as Deno.ServeHandlerInfo<Deno.NetAddr>

const view = (component: unknown) => component as Parameters<App<State>["appWrapper"]>[0]

const handler = new App<State>()
  .use(
    pageMiddleware(config, () => Promise.reject(new Error("the page called the API")), () => true),
  )
  .appWrapper(view(AppWrapper))
  .layout("*", view(Layout))
  .route("/:lang", { component: view(Home) })
  .route("/:lang/features", { component: view(Features) })
  .route("/:lang/admin", { component: view(Admin) })
  .handler()

/** The Arabic pages that draw arrows in their own content. */
const ARABIC_PAGES = [`/ar`, `/ar/features`, `/ar/admin`]

/**
 * The class preact-icons gives a glyph that points along the reading direction; the built
 * stylesheet turns it into `transform: scaleX(-1)` under `dir="rtl"` (`vite.config.ts`).
 */
const MIRROR = `[&:dir(rtl)]:[transform:scaleX(-1)]`

/** The drawing inside each sideways arrow and chevron the website uses, as preact-icons renders it. */
const SIDEWAYS = [IconArrowRight, IconArrowLeft, IconChevronRight].map((icon) =>
  renderToString(icon({})).replace(/^<svg[^>]*>|<\/svg>$/g, ``)
)

/** Every `<svg>` of `html` whose drawing is a sideways arrow, with its class. */
function sidewaysArrows(html: string): string[] {
  return [...html.matchAll(/<svg([^>]*)>([\s\S]*?)<\/svg>/g)]
    .filter(([, , inner]) => SIDEWAYS.includes(inner))
    .map(([, attributes]) =>
      (attributes.match(/class="([^"]*)"/)?.[1] ?? ``).replaceAll(`&amp;`, `&`)
    )
}

describe("the website in a right-to-left language", () => {
  it("draws every sideways arrow as an icon that flips in Arabic, and no text arrow", async () => {
    for (const path of ARABIC_PAGES) {
      const response = await handler(new Request(`${config.webAppOrigin}${path}`), info)
      const html = await response.text()

      expect(response.status, path).toBe(200)
      expect(html, path).toMatch(/<html lang="ar" dir="rtl"/)
      const arrows = sidewaysArrows(html)
      expect(arrows.length, path).toBeGreaterThan(0)
      for (const classes of arrows) {
        expect(classes.split(` `), path).toContain(MIRROR)
        // A second flip on top of the icon's own would point it back at the text.
        expect(classes, path).not.toMatch(/(^| )rtl:(-?scale-x|rotate)/)
      }
      // A text arrow never flips: the page draws its arrows as icons only.
      const textArrow = html.replace(/<script[\s\S]*?<\/script>/g, ``).match(/[^<>]{0,40}[←→]/)
      expect(textArrow?.[0], path).toBeUndefined()
    }
  })
})
