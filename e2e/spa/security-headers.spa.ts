import { type APIResponse, expect, test } from "@playwright/test"
import { gotoApp, signIn } from "../fixtures/app.ts"
import { refusalSource, watchCspViolations } from "../fixtures/csp.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "../fixtures/sign-up.ts"

const TRACKER = Deno.env.get("ERROR_TRACKER_ORIGIN")
if (!TRACKER) throw new Error("ERROR_TRACKER_ORIGIN is required: e2e/spa/run.sh sets it")

/** arktype's test for a policy that forbids `eval`, as the built script holds it. */
const PROBE = `new Function("return false")`

/** The one value of a header, which fails on a header nginx sent twice. */
function header(response: APIResponse, name: string): string | undefined {
  const values = response.headersArray().filter((entry) => entry.name.toLowerCase() === name)
  expect(values.length, `${name} is sent at most once`).toBeLessThanOrEqual(1)
  return values[0]?.value
}

function expectSecurityHeaders(response: APIResponse) {
  const policy = header(response, "content-security-policy") ?? ""
  const directives = policy.split("; ")
  expect(directives).toContain("default-src 'self'")
  expect(directives).toContain("object-src 'none'")
  expect(directives).toContain("base-uri 'self'")
  expect(directives).toContain("form-action 'self'")
  expect(directives).toContain("frame-ancestors 'none'")
  // The provider's picture on "Create a new account?": Google's and GitHub's image hosts only.
  expect(directives).toContain(
    "img-src 'self' data: https://lh3.googleusercontent.com https://avatars.githubusercontent.com",
  )
  // Geist comes from the app's own /fonts/ (#444): no font host is allowed, so the policy sends no
  // font-src and fonts fall back to default-src 'self'.
  expect(policy).not.toContain("font-src")
  // The origin of the container's SPA_ERROR_REPORT_DSN, and nothing else beyond the app itself.
  expect(directives).toContain(`connect-src 'self' ${TRACKER}`)
  // The app's own files and the two inline blocks of the built page, each by its hash.
  expect(policy).toMatch(/(^|; )script-src 'self' 'sha256-[A-Za-z0-9+/]{43}='(;|$)/)
  expect(policy).toMatch(
    /(^|; )style-src 'self' 'sha256-[A-Za-z0-9+/]{43}='(;|$)/,
  )
  expect(policy).not.toContain("unsafe")
  expect(policy).not.toContain("*")
  expect(header(response, "x-content-type-options")).toBe("nosniff")
  expect(header(response, "referrer-policy")).toBe("no-referrer")
  expect(header(response, "x-frame-options")).toBe("DENY")
  expect(header(response, "strict-transport-security")).toBe("max-age=15552000; includeSubDomains")
}

test("nginx sends the security headers with the page, a script, the worker, the settings and an error page", async ({ request }) => {
  const page = await request.get("/")
  expect(page.status()).toBe(200)
  expectSecurityHeaders(page)

  // A deep link is answered with the same page.
  const deepLink = await request.get("/notes/some-id")
  expect(deepLink.status()).toBe(200)
  expectSecurityHeaders(deepLink)

  const script = (await page.text()).match(/src="(\/assets\/[^"]+\.js)"/)![1]
  const asset = await request.get(script)
  expect(asset.status()).toBe(200)
  expectSecurityHeaders(asset)

  // These three have a header of their own, which in nginx drops the inherited ones.
  const worker = await request.get("/sw.js")
  expect(worker.status()).toBe(200)
  expectSecurityHeaders(worker)
  expect(header(worker, "cache-control")).toBe("no-cache")

  const settings = await request.get("/config.json")
  expect(settings.status()).toBe(200)
  expectSecurityHeaders(settings)
  expect(header(settings, "cache-control")).toBe("no-cache")

  const tokenPage = await request.get("/unsubscribe?list=news&token=abc")
  expect(tokenPage.status()).toBe(200)
  expectSecurityHeaders(tokenPage)
  expect(header(tokenPage, "cache-control")).toBe("no-store")

  // nginx's own error page: it refuses a POST to a static file.
  const refused = await request.post("/favicon.ico")
  expect(refused.status()).toBe(405)
  expectSecurityHeaders(refused)

  // A byte range past the end of a file: nginx's 416 would repeat every header, so ranges are off
  // and the whole file comes back.
  const range = await request.get("/favicon.ico", { headers: { range: "bytes=99999999-" } })
  expect(range.status()).toBe(200)
  expectSecurityHeaders(range)
})

// The API answers behind the same origin as the SPA. It serves JSON and no page, so its policy is
// the library's default with nothing added.
test("the API sends the security headers with an answer and with an unknown address", async ({ request }) => {
  const health = await request.get("/api/health")
  expect(health.status()).toBe(200)
  const unknown = await request.get("/api/no-such-route")
  expect(unknown.status()).toBe(404)

  for (const response of [health, unknown]) {
    expect(header(response, "content-security-policy")).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
        "connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; " +
        "frame-ancestors 'none'",
    )
    expect(header(response, "x-content-type-options")).toBe("nosniff")
    expect(header(response, "referrer-policy")).toBe("no-referrer")
    expect(header(response, "x-frame-options")).toBe("DENY")
    expect(header(response, "strict-transport-security")).toBe(
      "max-age=15552000; includeSubDomains",
    )
  }
})

test("a signed-in walk through the app meets no refusal under the content security policy", async ({ context, page, request, baseURL }) => {
  const violations = await watchCspViolations(context)
  // The fonts the page asks for: Geist from the app's own origin, nothing from another one.
  const fontRequests: string[] = []
  page.on("request", (request) => {
    if (request.resourceType() === "font") fontRequests.push(request.url())
  })

  const email = `e2e-csp-${uuidV7().slice(-8)}@example.com`
  const password = "Passw0rd!"
  const headers = { origin: new URL(baseURL!).origin, "sec-fetch-site": "same-origin" }
  const cleanup = async ({ soft = false } = {}) => {
    const response = await request.post("/api/test/cleanup-user", { data: { login: email } })
    ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
  }
  await cleanup()
  try {
    const signUp = await signUpWithCode(request, "/api/auth/password/sign-up", {
      headers,
      data: { email, password },
    })
    expect(signUp.ok(), await signUp.text()).toBe(true)

    // The sign-in form, then the home page with its live connection: scripts, styles and the
    // WebSocket.
    await signIn(page, email, password)
    await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
    await expect.poll(() => fontRequests.length, { message: "a font file was asked for" })
      .toBeGreaterThan(0)
    const origin = new URL(baseURL!).origin
    expect(fontRequests.filter((url) => new URL(url).origin !== origin)).toEqual([])
    expect(fontRequests).toContain(`${origin}/fonts/geist-sans.var.woff2`)

    // The service worker installs from /sw.js and takes the page over.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))

    // Every screen of the signed-in app, as the dev stack's warm-up visits them.
    const selected = await page.request.get("/api/groups/selected")
    const { groupId } = await selected.json()
    const noteId = uuidV7()
    const note = await page.request.post(`/api/groups/${groupId}/notes`, {
      headers,
      data: { id: noteId, title: "Under the policy", body: "" },
    })
    expect(note.status(), await note.text()).toBe(201)
    await gotoApp(page, "/groups", page.locator("[data-e2e=shell-ws-status]"))
    await gotoApp(page, `/groups/${groupId}`, page.locator("[data-e2e=group-general-name]"))
    await gotoApp(page, "/notes", page.locator("[data-e2e=note-new]"))
    await gotoApp(page, `/notes/${noteId}`, page.locator("[data-e2e=note-title]"))

    // The sign-up code proved the address, so the profile offers two-factor auth: its QR code is
    // the one image the app builds as a `data:` address.
    await gotoApp(page, "/profile/account", page.locator("[data-e2e=email-state]"))
    await expect(page.locator("[data-e2e=email-state]")).toHaveText("Verified")
    await gotoApp(page, "/profile/security", page.locator("[data-e2e=totp-start]"))
    await page.locator("[data-e2e=totp-start]").click()
    await page.locator("[data-e2e=totp-start-password]").fill(password)
    await page.locator("[data-e2e=totp-start-submit]").click()
    const qrCode = page.getByRole("img", { name: "QR code for your authenticator app" })
    await expect(qrCode).toBeVisible()
    expect(await qrCode.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(
      0,
    )

    // A reload is served by the service worker, under the policy the cached page carries.
    await page.reload()
    await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")

    // One refusal is expected on every page load and is the policy at work: arktype, the
    // validation library, tries `new Function("return false")` once inside a try/catch to learn
    // whether it may compile its validators, is refused, and validates without compiling. The
    // browser says where in which script each refused `eval` was: every one must be that probe,
    // read here from the script itself. Anything else the browser refused fails the spec.
    const refusedEval = /^script-src blocked eval on /
    expect(violations.filter((line) => !refusedEval.test(line))).toEqual([])
    const evals = [...new Set(violations.filter((line) => refusedEval.test(line)))]
    expect(evals.length, "arktype's probe was refused").toBeGreaterThan(0)
    for (const refusal of evals) {
      const source = refusalSource(refusal)
      expect(source, `the browser names the script of: ${refusal}`).toBeDefined()
      const script = await (await request.get(source!.file)).text()
      const code = script.split("\n")[source!.line - 1] ?? ""
      const around = code.slice(
        Math.max(0, source!.column - 1 - PROBE.length),
        source!.column - 1 + PROBE.length,
      )
      expect(around, `a refused eval that is not arktype's probe: ${refusal}`).toContain(PROBE)
    }
  } finally {
    await cleanup({ soft: true })
  }
})
