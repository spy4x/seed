import type { ConsoleMessage, Locator, Page, Request } from "@playwright/test"

/**
 * What Chromium reports for a request that was in flight when the host's network interfaces
 * changed. On a developer machine, any container that starts or stops (a veth link coming up)
 * triggers it, and the browser closes every open connection, including the ones carrying the
 * module scripts of a page that is loading. The app is not at fault, and no browser switch turns
 * the notification off, so a navigation that fails this way is made again.
 */
const NETWORK_CHANGED = "net::ERR_NETWORK_CHANGED"
const ATTEMPTS = 3
const MAX_LOGGED = 30

/**
 * Opens `url` and waits for `ready`, which proves the app booted. Only when a request to the
 * app's own origin failed with the network-change error during the attempt is the page loaded
 * again, up to three times. Any other failure, or the same failure on the last attempt, throws
 * at once, with the uncaught errors of the page, the failed requests, the requests still pending and
 * the console of the last attempt added to the message, so a red run explains itself without a
 * trace. An uncaught error can leave a page blank with every request answered.
 *
 * `open` makes the first load and defaults to `page.goto(url)`. Where the app loads `url` itself
 * after a click, the click is passed instead (see `submitAuthForm`); every later attempt is
 * `page.goto(url)`.
 */
export async function gotoApp(
  page: Page,
  url: string,
  ready: Locator,
  open: () => Promise<unknown> = () => page.goto(url),
): Promise<void> {
  let networkChanged = false
  let appOrigin = ""
  let failed: string[] = []
  // Each request that has neither finished nor failed, with the time it started.
  let pending = new Map<Request, number>()
  let consoleLines: string[] = []
  let pageErrors: string[] = []
  const onRequest = (request: Request) => {
    if (!appOrigin && request.isNavigationRequest()) appOrigin = new URL(request.url()).origin
    pending.set(request, Date.now())
  }
  const onFinished = (request: Request) => pending.delete(request)
  const onFailed = (request: Request) => {
    pending.delete(request)
    const errorText = request.failure()?.errorText
    failed.push(`${request.url()} ${errorText}`)
    if (errorText === NETWORK_CHANGED && new URL(request.url()).origin === appOrigin) {
      networkChanged = true
    }
  }
  const onConsole = (message: ConsoleMessage) => {
    consoleLines.push(`${message.type()}: ${message.text()}`)
  }
  // The stack names the module; an error thrown without one has only its message.
  const onPageError = (error: Error) => pageErrors.push(error.stack || error.message)
  page.on("request", onRequest)
  page.on("requestfinished", onFinished)
  page.on("requestfailed", onFailed)
  page.on("console", onConsole)
  page.on("pageerror", onPageError)
  try {
    for (let attempt = 1;; attempt++) {
      networkChanged = false
      failed = []
      pending = new Map()
      consoleLines = []
      pageErrors = []
      try {
        await (attempt === 1 ? open() : page.goto(url))
        await ready.waitFor()
        return
      } catch (error) {
        if (!networkChanged || attempt === ATTEMPTS) {
          if (error instanceof Error) {
            error.message += `\nAttempt ${attempt} of ${url}.` +
              `\nUncaught page errors (${pageErrors.length}):\n` +
              pageErrors.slice(0, MAX_LOGGED).join("\n") +
              `\nFailed requests (${failed.length}):\n${failed.slice(0, MAX_LOGGED).join("\n")}` +
              `\nPending requests (${pending.size}):\n` +
              [...pending].slice(0, MAX_LOGGED)
                .map(([request, start]) => `${request.url()} for ${Date.now() - start} ms`)
                .join("\n") +
              `\nConsole (${consoleLines.length}):\n${consoleLines.slice(0, MAX_LOGGED).join("\n")}`
          }
          throw error
        }
      }
    }
  } finally {
    page.off("request", onRequest)
    page.off("requestfinished", onFinished)
    page.off("requestfailed", onFailed)
    page.off("console", onConsole)
    page.off("pageerror", onPageError)
  }
}

/**
 * Submits the auth form, after which the app loads `url` itself, and waits for `ready` there. A
 * load that a network change broke is made again, as in `gotoApp`.
 */
export async function submitAuthForm(page: Page, url: string, ready: Locator): Promise<void> {
  await gotoApp(page, url, ready, async () => {
    await page.locator("[data-e2e=auth-form-submit]").click()
    await page.waitForURL(url)
  })
}

/** Signs `email` in through the form and waits until the app has booted on the notes list. */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await gotoApp(page, "/sign-in", page.locator("[data-e2e=auth-form-login]"))
  await page.locator("[data-e2e=auth-form-login]").fill(email)
  await page.locator("[data-e2e=auth-form-password]").fill(password)
  await submitAuthForm(page, "/notes", page.locator("[data-e2e=shell-ws-status]"))
}

/**
 * Opens the profile the way a person does on a wide window: the name and portrait at the top of
 * the sidebar's account menu, which go through the app's router, then the section `section` from
 * the profile's list when one is named. Waits for the page's heading, then the section's.
 */
export async function openProfile(page: Page, section?: string): Promise<void> {
  await page.locator("[data-e2e=account-menu-button]").click()
  await page.locator("[data-e2e=account-menu-header]").click()
  await page.getByRole("heading", { level: 1, name: "Profile" }).waitFor()
  if (!section) return
  await page.locator(`[data-e2e=settings-nav-${section}]`).click()
  await page.waitForURL(`/profile/${section}`)
  await page.locator("[data-e2e=settings-heading]").waitFor()
}
