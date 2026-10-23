// Seed's own site: see docs/start-a-product.md
/**
 * Records the README screenshots, the sign-up GIF and the GitHub social preview image from a
 * running app, with neutral demo data.
 *
 * Needs the app reachable as one origin (API under /api, SPA everywhere else) on a throw-away
 * database in development mode: the run deletes the demo user through the development route
 * `/api/test/cleanup-user` before it starts and again when it ends, also when it fails, so a later
 * capture of that database (the admin panel video's Users list) never shows it; the GIF signs that
 * user up, reading the mailed code from the development route `/api/test/last-mail`, and the
 * stills sign that user in.
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
/** The sign-in still's viewport: 16:10 like {@link VIEWPORT}, tall enough for the whole page. */
const SIGN_IN_VIEWPORT = { width: 1440, height: 900 }
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

/** Deletes the demo user, if there is one, through the development route. */
async function deleteDemoUser(browser: Browser): Promise<void> {
  const context = await newContext(browser, "light", 1)
  try {
    const cleanup = await context.request.post("/api/test/cleanup-user", {
      data: { login: DEMO.email },
    })
    if (!cleanup.ok()) throw new Error(`cleanup-user answered ${cleanup.status()}`)
  } finally {
    await context.close()
  }
}

/**
 * Deletes the demo user a previous run left, and waits for the first load of both signed-out
 * pages, which is slow while the dev server bundles dependencies.
 */
async function warmUp(browser: Browser): Promise<void> {
  await deleteDemoUser(browser)
  const context = await newContext(browser, "light", 1)
  try {
    const page = await context.newPage()
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
    // The sign-in page is taller than the 800 px viewport, so it is shot on a larger one of the
    // same 16:10 shape: the whole card, the guest offer and the sign-up link, with room below.
    await page.setViewportSize(SIGN_IN_VIEWPORT)
    await page.goto("/sign-in")
    await page.getByRole("heading", { level: 1, name: "Welcome back" }).waitFor()
    await page.getByText("Create an account", { exact: true }).waitFor()
    await page.waitForTimeout(500)
    const signIn = await page.screenshot()
    await page.setViewportSize(VIEWPORT)
    await page.locator("[data-e2e=auth-form-login]").fill(DEMO.email)
    await page.locator("[data-e2e=auth-form-password]").fill(DEMO.password)
    await page.locator("[data-e2e=auth-form-submit]").click()
    await notesLoaded(page)
    await page.locator("[data-e2e=account-menu-button]").click()
    await page.locator("[data-e2e=account-menu-header]").click()
    await page.locator("[data-e2e=profile-name]", {
      hasText: `${DEMO.firstName} ${DEMO.lastName}`,
    }).waitFor()
    await profileLoaded(page, DEMO.email)
    await page.waitForTimeout(800)
    const profile = await page.screenshot()
    return { "sign-in": signIn, profile }
  } finally {
    await context.close()
  }
}

function dataUrl(bytes: Uint8Array, type = "image/png"): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `data:${type};base64,${btoa(binary)}`
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

/** The website's typefaces, which the social preview embeds so it does not depend on the host. */
const FONTS = new URL("../../apps/mpa/static/fonts/", import.meta.url)

/**
 * The 1280x640 image GitHub shows when the repository link is shared. It copies the website's
 * home card (`apps/mpa/screenshots/og.html`, `apps/mpa/static/og/home.png`): the same words,
 * typefaces, colours and sprout lockup, with the dark profile capture in place of the notes one.
 */
async function socialPreview(browser: Browser, profile: Uint8Array): Promise<Uint8Array> {
  const sans = dataUrl(await Deno.readFile(new URL("geist-sans.var.woff2", FONTS)), "font/woff2")
  const mono = dataUrl(await Deno.readFile(new URL("geist-mono.var.woff2", FONTS)), "font/woff2")
  const context = await browser.newContext({ viewport: { width: 1280, height: 640 } })
  try {
    const page = await context.newPage()
    await page.setContent(`<!doctype html><html lang="en"><head><style>
      @font-face { font-family: "Geist"; src: url("${sans}") format("woff2"); font-weight: 100 900 }
      @font-face {
        font-family: "Geist Mono"; src: url("${mono}") format("woff2"); font-weight: 100 900
      }
      * { box-sizing: border-box; margin: 0 }
      body {
        position: relative; width: 1280px; height: 640px; overflow: hidden; background: #0a0a0c;
        color: #f4f4f6; font-family: "Geist", sans-serif;
      }
      .grid {
        position: absolute; inset: 0; background-size: 48px 48px;
        background-image: linear-gradient(rgba(255,255,255,.055) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,.055) 1px, transparent 1px);
        mask-image: radial-gradient(ellipse at 70% 20%, #000 20%, transparent 80%);
      }
      .glow {
        position: absolute; top: -260px; right: -200px; width: 760px; height: 620px;
        background: radial-gradient(closest-side, rgba(139,92,246,.42), transparent);
      }
      .shot {
        position: absolute; top: 96px; left: 760px; width: 560px; height: 410px;
        border-radius: 14px; border: 1px solid rgba(255,255,255,.12); overflow: hidden;
        box-shadow: 0 30px 80px rgba(0,0,0,.6);
      }
      .shot img { display: block; width: 900px; height: auto }
      .copy { position: absolute; left: 72px; top: 96px; width: 600px }
      .eyebrow {
        font-family: "Geist Mono", monospace; font-size: 20px; letter-spacing: .12em;
        text-transform: uppercase; color: #a78bfa;
      }
      h1 { margin-top: 28px; font-size: 60px; line-height: 1.06; font-weight: 650; letter-spacing: -.03em }
      .sub { margin-top: 28px; font-size: 26px; line-height: 1.35; color: #a1a1aa }
      footer {
        position: absolute; left: 72px; right: 72px; bottom: 60px; display: flex;
        align-items: center; justify-content: space-between;
      }
      .brand {
        display: flex; align-items: center; gap: 14px; font-size: 32px; font-weight: 650;
        letter-spacing: -.02em;
      }
      .domain { font-family: "Geist Mono", monospace; font-size: 22px; color: #a1a1aa }
      </style></head><body>
      <div class="grid"></div><div class="glow"></div>
      <div class="shot"><img src="${dataUrl(profile)}" alt=""></div>
      <div class="copy">
        <p class="eyebrow">Open-source SaaS foundation</p>
        <h1>The groundwork of your SaaS, already built.</h1>
        <p class="sub">Seed · open source · MIT · one server you rent</p>
      </div>
      <footer>
        <span class="brand"><svg width="40" height="40" viewBox="0 0 32 32" aria-hidden="true">
          <path d="M16 29V15" stroke="#4ade80" stroke-width="2.4" stroke-linecap="round" />
          <path d="M16 17C16 10 11 6 4 6c0 7 5 11 12 11Z" fill="#4ade80" />
          <path d="M16 14c0-6 4.5-10 12-10 0 6.5-4.5 10-12 10Z" fill="#a78bfa" />
        </svg>Seed</span>
        <span class="domain">seedsaas.com</span>
      </footer></body></html>`)
    await page.locator("img").evaluate((img: HTMLImageElement) => img.decode())
    await page.evaluate(() => document.fonts.ready)
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

/** What `recordFlow` hands to `toGif`: the video and the parts of it to leave out. */
interface Recording {
  video: string
  /** Seconds of blank start to trim. */
  trim: number
  /** Seconds into the video, from its start, between which the notes page was still loading. */
  loading: [number, number]
}

/**
 * Waits until the notes page, where a new account lands, shows what it loads: the group and the
 * first-steps checklist.
 */
async function notesLoaded(page: Page): Promise<void> {
  await page.waitForURL(`${BASE_URL}/notes`)
  await page.getByRole("button", { name: /^Group: / }).waitFor()
  await page.locator("[data-e2e=onboarding]").waitFor()
}

/** Waits until the profile shows everything it loads: the group and the e-mail. */
async function profileLoaded(page: Page, email: string): Promise<void> {
  await page.waitForURL(/\/profile/)
  await page.getByRole("button", { name: /^Group: / }).waitFor()
  await page.getByText(email, { exact: true }).filter({ visible: true }).first().waitFor()
}

/**
 * Records sign-up with an address, a password and the mailed code, the notes page the new account
 * lands on, then naming the profile from the account menu, the way a person does it, with a drawn
 * pointer.
 * The GIF is recorded in the light theme; the stills cover both.
 * Returns the WebM path, how many seconds of blank start to trim, and when the notes page loaded.
 */
async function recordFlow(browser: Browser, dir: string): Promise<Recording> {
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
  let loading: [number, number] = [0, 0]
  try {
    await context.addInitScript(`window.__demoPointerStart = ${JSON.stringify(pointer)}`)
    await context.addInitScript({ path: new URL("pointer.js", import.meta.url).pathname })
    // The video starts when the page is made, so the clock does too: the trim then cuts the
    // whole first load, "Loading…" included.
    const started = Date.now()
    page = await context.newPage()
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
    // From the click until the notes page has loaded, the page shows parts of it (the group chip
    // as a bare chevron, no checklist yet); the GIF leaves that stretch out.
    const clicked = (Date.now() - started) / 1000
    await notesLoaded(page)
    // A moment for the last paint to reach the video.
    await page.waitForTimeout(300)
    loading = [clicked + 0.1, (Date.now() - started) / 1000]
    await page.waitForTimeout(1200)

    // The account menu's header opens the profile, where the person names themselves.
    await clickLike(page, pointer, page.locator("[data-e2e=account-menu-button]"), h)
    await page.waitForTimeout(500)
    await clickLike(page, pointer, page.locator("[data-e2e=account-menu-header]"), h)
    await profileLoaded(page, DEMO.email)
    const edit = page.locator("[data-e2e=profile-edit]")
    await page.waitForTimeout(800)

    await clickLike(page, pointer, edit, h)
    await page.locator("[data-e2e=profile-first-name]").waitFor()
    await page.waitForTimeout(400)
    await typeLike(page, pointer, page.locator("[data-e2e=profile-first-name]"), DEMO.firstName, h)
    await page.waitForTimeout(300)
    await typeLike(page, pointer, page.locator("[data-e2e=profile-last-name]"), DEMO.lastName, h)
    await page.waitForTimeout(400)
    await clickLike(page, pointer, page.locator("[data-e2e=profile-save]"), h)
    await page.locator("[data-e2e=profile-saved]").getByText("Profile saved", { exact: true }).waitFor()
    await page.waitForTimeout(1800)
  } finally {
    await context.close()
  }
  const video = await page?.video()?.path()
  if (!video) throw new Error("the recording context produced no video")
  return { video, trim, loading }
}

/**
 * Converts the recording to a GIF from `trim` on, without the frames between `loading`'s two
 * moments. The timestamps count from the video's start, which is when the page was created.
 */
async function toGif({ video, trim, loading: [from, to] }: Recording, out: string): Promise<void> {
  const filter = `fps=20,select='not(between(t,${from.toFixed(2)},${to.toFixed(2)}))',` +
    "setpts=N/20/TB,scale=800:-1:flags=lanczos,split[a][b];" +
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
  await toGif(await recordFlow(browser, videoDir), `${OUT_DIR}sign-up-flow.gif`)
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
  try {
    await deleteDemoUser(browser)
  } finally {
    await browser.close()
    await Deno.remove(videoDir, { recursive: true })
  }
}
