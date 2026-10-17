/**
 * Records the README screenshots, the sign-up GIF and the GitHub social preview image from a
 * running app, with neutral demo data.
 *
 * Needs the app reachable as one origin (API under /api, SPA everywhere else) on a throw-away
 * database in development mode: the run first deletes the demo user through the development route
 * `/api/test/cleanup-user`; the GIF signs that user up, reading the mailed code
 * from the development route `/api/test/last-mail`, and the stills sign that user in.
 * `deno task dev` behind `deno task proxy:start` serves it at http://app.localhost. Also needs
 * `ffmpeg` on the PATH for the GIF.
 *
 * ```sh
 * BASE_URL=http://app.localhost deno run -A docs/screenshots/record.ts
 * ```
 *
 * `CHROME_PATH` points Playwright at a Chromium already on disk instead of its own download.
 */
import { type Browser, type BrowserContext, chromium, type Page } from "playwright"
import { clickLike, typeLike } from "./human-mouse.ts"

const BASE_URL = Deno.env.get("BASE_URL") ?? "http://app.localhost"
const OUT_DIR = new URL(".", import.meta.url).pathname
const VIEWPORT = { width: 1280, height: 800 }
const THEMES = ["light", "dark"] as const
type Theme = typeof THEMES[number]

/** Neutral demo data: no real person, product or price. */
const DEMO = {
  email: "alex.rivera@example.com",
  password: "Demo-passw0rd!",
  firstName: "Alex",
  lastName: "Rivera",
}

/** The frame's backdrop behind each still, per theme. */
const BACKDROP: Record<Theme, string> = {
  light: "linear-gradient(135deg, #eef1f5 0%, #d9dee7 100%)",
  dark: "linear-gradient(135deg, #1b1f27 0%, #0d0f14 100%)",
}

function newContext(browser: Browser, theme: Theme, scale: number): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: BASE_URL,
    viewport: VIEWPORT,
    deviceScaleFactor: scale,
    colorScheme: theme,
    locale: "en-US",
    timezoneId: "Etc/UTC",
  })
}

/**
 * Deletes the demo user a previous run left, through the development route, and waits for the
 * first load of both signed-out pages, which is slow while the dev server bundles dependencies.
 */
async function warmUp(browser: Browser): Promise<void> {
  const context = await newContext(browser, "light", 1)
  try {
    const page = await context.newPage()
    const cleanup = await page.request.post("/api/test/cleanup-user", {
      data: { login: DEMO.email },
    })
    if (!cleanup.ok()) throw new Error(`cleanup-user answered ${cleanup.status()}`)
    const pages = [["/sign-in", "Welcome back"], ["/sign-up", "Create your account"]]
    for (const [path, name] of pages) {
      await page.goto(path)
      await page.getByRole("heading", { level: 1, name }).waitFor({ timeout: 120_000 })
    }
  } finally {
    await context.close()
  }
}

/** Raw 2x viewport captures of the sign-in and profile pages in one theme. */
async function captureStills(browser: Browser, theme: Theme): Promise<Record<string, Uint8Array>> {
  const context = await newContext(browser, theme, 2)
  try {
    const page = await context.newPage()
    await page.goto("/sign-in")
    await page.getByRole("heading", { level: 1, name: "Welcome back" }).waitFor()
    await page.waitForTimeout(500)
    const signIn = await page.screenshot()
    await page.locator("[data-e2e=auth-form-login]").fill(DEMO.email)
    await page.locator("[data-e2e=auth-form-password]").fill(DEMO.password)
    await page.locator("[data-e2e=auth-form-submit]").click()
    await page.waitForURL(`${BASE_URL}/`)
    await page.locator("[data-e2e=profile-name]", {
      hasText: `${DEMO.firstName} ${DEMO.lastName}`,
    }).waitFor()
    // The sidebar names the group once the groups have loaded.
    await page.getByRole("button", { name: /^Group: / }).waitFor()
    await page.waitForTimeout(800)
    const profile = await page.screenshot()
    return { "sign-in": signIn, profile }
  } finally {
    await context.close()
  }
}

function dataUrl(png: Uint8Array): string {
  let binary = ""
  for (const byte of png) binary += String.fromCharCode(byte)
  return `data:image/png;base64,${btoa(binary)}`
}

/** Puts a capture in a rounded window on a neutral backdrop, 16:10 at 2x like the capture. */
async function frame(browser: Browser, theme: Theme, png: Uint8Array): Promise<Uint8Array> {
  const context = await newContext(browser, theme, 2)
  try {
    const page = await context.newPage()
    await page.setContent(`<!doctype html><html><body style="margin:0;width:1280px;height:800px;
      display:grid;place-items:center;background:${BACKDROP[theme]}">
      <img src="${dataUrl(png)}" style="width:1152px;height:720px;border-radius:12px;
      box-shadow:0 24px 60px rgba(0,0,0,.28),0 0 0 1px rgba(127,127,127,.25)"></body></html>`)
    await page.locator("img").evaluate((img: HTMLImageElement) => img.decode())
    return await page.screenshot()
  } finally {
    await context.close()
  }
}

/** The 1280x640 image GitHub shows when the repository link is shared. */
async function socialPreview(browser: Browser, profile: Uint8Array): Promise<Uint8Array> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 640 } })
  try {
    const page = await context.newPage()
    await page.setContent(`<!doctype html><html><body style="margin:0;width:1280px;height:640px;
      overflow:hidden;background:${BACKDROP.dark};font-family:system-ui,sans-serif;color:#f5f7fa">
      <div style="position:absolute;left:72px;top:0;bottom:0;width:470px;display:flex;
        flex-direction:column;justify-content:center;gap:20px">
        <div style="font-size:72px;font-weight:700;letter-spacing:-2px">template</div>
        <div style="font-size:30px;line-height:1.3;color:#c9d1dc">The web-standards SaaS
          baseline: auth, two-factor sign-in, groups, an API, a worker and Postgres, wired
          together.</div>
        <div style="font-size:20px;color:#8b95a5">Deno · Hono · Preact · Fresh · Postgres</div>
      </div>
      <img src="${dataUrl(profile)}" style="position:absolute;left:600px;top:70px;width:800px;
        height:500px;border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.5),
        0 0 0 1px rgba(255,255,255,.12)"></body></html>`)
    await page.locator("img").evaluate((img: HTMLImageElement) => img.decode())
    return await page.screenshot()
  } finally {
    await context.close()
  }
}

/** The text of the newest mail the dev worker sent to `email`, from the development route. */
async function lastMailText(page: Page, email: string): Promise<string | null> {
  const response = await page.request.post("/api/test/last-mail", { data: { email } })
  return response.ok() ? (await response.json() as { text: string }).text : null
}

/** Waits for a mail to `email` other than `before` and answers the code in it. */
async function nextCode(page: Page, email: string, before: string | null): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const text = await lastMailText(page, email)
    if (text && text !== before) return text.split("\n\n")[1].trim()
    await page.waitForTimeout(500)
  }
  throw new Error(`no sign-up code reached ${email} within 20 seconds`)
}

/**
 * Records sign-up with an address, a password and the mailed code, then naming the profile, the
 * way a person does it, with a drawn pointer.
 * The GIF is recorded in the light theme; the stills cover both.
 * Returns the WebM path and how many seconds of blank start to trim.
 */
async function recordFlow(browser: Browser, dir: string): Promise<{ video: string; trim: number }> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: VIEWPORT,
    colorScheme: "light",
    locale: "en-US",
    timezoneId: "Etc/UTC",
    recordVideo: { dir, size: VIEWPORT },
  })
  const pointer = { x: 900, y: 620 }
  let page: Page | undefined
  let trim = 0
  try {
    await context.addInitScript(`window.__demoPointerStart = ${JSON.stringify(pointer)}`)
    await context.addInitScript({ path: new URL("pointer.js", import.meta.url).pathname })
    page = await context.newPage()
    const started = Date.now()
    await page.goto("/sign-up")
    await page.getByRole("heading", { level: 1, name: "Create your account" }).waitFor()
    await page.mouse.move(pointer.x, pointer.y)
    trim = (Date.now() - started) / 1000
    await page.waitForTimeout(900)

    const h = VIEWPORT.height
    await typeLike(page, pointer, page.locator("[data-e2e=auth-form-login]"), DEMO.email, h)
    await page.waitForTimeout(300)
    await typeLike(page, pointer, page.locator("[data-e2e=auth-form-password]"), DEMO.password, h)
    await page.waitForTimeout(500)
    const before = await lastMailText(page, DEMO.email)
    await clickLike(page, pointer, page.locator("[data-e2e=auth-form-submit]"), h)
    const codeInput = page.locator("[data-e2e=sign-up-code-input]")
    await codeInput.waitFor()
    const code = await nextCode(page, DEMO.email, before)
    await page.waitForTimeout(600)
    await typeLike(page, pointer, codeInput, code, h)
    await page.waitForTimeout(400)
    await clickLike(page, pointer, page.locator("[data-e2e=sign-up-code-submit]"), h)
    await page.waitForURL(`${BASE_URL}/`)
    const edit = page.locator("[data-e2e=profile-edit]")
    await edit.waitFor()
    await page.waitForTimeout(1000)

    await clickLike(page, pointer, edit, h)
    await page.locator("[data-e2e=profile-first-name]").waitFor()
    await page.waitForTimeout(400)
    await typeLike(page, pointer, page.locator("[data-e2e=profile-first-name]"), DEMO.firstName, h)
    await page.waitForTimeout(300)
    await typeLike(page, pointer, page.locator("[data-e2e=profile-last-name]"), DEMO.lastName, h)
    await page.waitForTimeout(400)
    await clickLike(page, pointer, page.locator("[data-e2e=profile-save]"), h)
    await page.locator("[data-e2e=profile-saved]").getByText("Saved", { exact: true }).waitFor()
    await page.waitForTimeout(1800)
  } finally {
    await context.close()
  }
  const video = await page?.video()?.path()
  if (!video) throw new Error("the recording context produced no video")
  return { video, trim }
}

async function toGif(video: string, trim: number, out: string): Promise<void> {
  const filter = "fps=20,scale=800:-1:flags=lanczos,split[a][b];" +
    "[a]palettegen=max_colors=256:stats_mode=diff[p];" +
    "[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle"
  const { success, stderr } = await new Deno.Command("ffmpeg", {
    args: [
      "-y",
      "-loglevel",
      "error",
      "-i",
      video,
      "-ss",
      trim.toFixed(2),
      "-vf",
      filter,
      "-loop",
      "0",
      out,
    ],
    stdout: "null",
  }).output()
  if (!success) throw new Error(`ffmpeg failed: ${new TextDecoder().decode(stderr)}`)
}

const browser = await chromium.launch({ executablePath: Deno.env.get("CHROME_PATH") || undefined })
const videoDir = await Deno.makeTempDir()
try {
  await warmUp(browser)
  const { video, trim } = await recordFlow(browser, videoDir)
  await toGif(video, trim, `${OUT_DIR}sign-up-flow.gif`)
  let darkProfile: Uint8Array | undefined
  for (const theme of THEMES) {
    const stills = await captureStills(browser, theme)
    for (const [name, png] of Object.entries(stills)) {
      await Deno.writeFile(`${OUT_DIR}${name}-${theme}.png`, await frame(browser, theme, png))
    }
    if (theme === "dark") darkProfile = stills.profile
  }
  if (!darkProfile) throw new Error("no dark profile capture")
  await Deno.writeFile(`${OUT_DIR}social-preview.png`, await socialPreview(browser, darkProfile))
} finally {
  await browser.close()
  await Deno.remove(videoDir, { recursive: true })
}
