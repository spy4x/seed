import { expect, type Page, test } from "@playwright/test"
import { gotoApp } from "./fixtures/app.ts"

/**
 * `useUrlFilters` in a real browser: browser back and forward bring the filters back in step with
 * the address.
 *
 * Unlike the rest of this suite it needs no running stack. `beforeAll` bundles
 * `fixtures/url-filters.tsx` with `deno bundle` and serves it from a local server on a free port,
 * so the test drives only the hook and survives the hook being swapped for the published one.
 */

const fixtureEntry = new URL("./fixtures/url-filters.tsx", import.meta.url)

let server: Deno.HttpServer<Deno.NetAddr> | undefined
let bundleDir: string | undefined
let origin = ""

test.beforeAll(async () => {
  bundleDir = await Deno.makeTempDir({ prefix: "url-filters-e2e-" })
  const bundlePath = `${bundleDir}/app.js`
  const bundle = await new Deno.Command(Deno.execPath(), {
    args: ["bundle", "--platform=browser", `--output=${bundlePath}`, fixtureEntry.pathname],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output()
  if (!bundle.success) {
    throw new Error(`deno bundle failed:\n${new TextDecoder().decode(bundle.stderr)}`)
  }
  const script = await Deno.readTextFile(bundlePath)
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>url filters</title></head>` +
    `<body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`

  server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, (request) => {
    // Every path is the page, the way an SPA host serves its routes.
    if (new URL(request.url).pathname === "/app.js") {
      return new Response(script, { headers: { "content-type": "text/javascript" } })
    }
    return new Response(html, { headers: { "content-type": "text/html" } })
  })
  origin = `http://127.0.0.1:${server.addr.port}`
})

test.afterAll(async () => {
  await server?.shutdown()
  if (bundleDir) await Deno.remove(bundleDir, { recursive: true })
})

/** Assert the address and both rendered filters in one step. */
async function expectFilters(page: Page, search: string, status: string, pageNumber: string) {
  await expect(page).toHaveURL(`${origin}/list${search}`)
  await expect(page.locator("[data-e2e=filter-status]")).toHaveText(status)
  await expect(page.locator("[data-e2e=filter-page]")).toHaveText(pageNumber)
}

test.describe("url filters", () => {
  test("browser back and forward resync the filters with the address", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))

    await gotoApp(page, `${origin}/list`, page.locator("[data-e2e=filter-status]"))
    await expectFilters(page, "", "all", "1")

    await page.locator("[data-e2e=status-open]").click()
    await expectFilters(page, "?status=open", "open", "1")
    await page.locator("[data-e2e=page-next]").click()
    await expectFilters(page, "?status=open&page=2", "open", "2")

    await page.goBack()
    await expectFilters(page, "?status=open", "open", "1")
    await page.goBack()
    await expectFilters(page, "", "all", "1")

    await page.goForward()
    await expectFilters(page, "?status=open", "open", "1")
    await page.goForward()
    await expectFilters(page, "?status=open&page=2", "open", "2")

    expect(errors).toEqual([])
  })
})
