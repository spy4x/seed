/**
 * Records the admin panel video of the public website's `/admin` page: the videos go to
 * `apps/mpa/media/video/` (served by `apps/mpa/routes/video/[file].ts`), the two posters to
 * `apps/mpa/static/video/`. The Dashboard, one support case end to end, then short glimpses of the
 * other screens, in the dark theme, with burned-in captions, a "Sample data" label on every screen,
 * a zoom in each shot on what its caption is about, a title and an end card, and soft music under
 * it all (`admin-video-music.opus`, see `MUSIC.md`). The 1280 px poster, shown on `/features`, is a
 * still of the Users list without any of that; the 1920 px one, the player's on `/admin`, is the
 * Dashboard the video opens on, without any of that either. The shot list and the copy are on issues #279 and
 * #285.
 *
 * After a run, update `apps/mpa/admin-video.ts` with what it prints and what the new cut shows: the
 * length in seconds, the MP4's size, the sound, the upload date and one transcript line per shot.
 * The website's caption, the player's label, the JSON-LD and the sitemap all read from there.
 *
 * Needs a running stack with the product app, the admin app, the worker and the development seed,
 * never the live server:
 *
 * 1. Start a local stack (`deno task dev` behind `deno task proxy:start` serves the product app at
 *    http://app.localhost and the admin app at http://admin.localhost).
 * 2. Seed its database fresh: `ENV=dev deno task db:reset` with the values in docs/development.md,
 *    then restart the API and the worker, which lose their database connection in the reset.
 *    The video shows the seed's fake example.com people, groups, customers and subscribers.
 * 3. Run the API as a release build runs: with `APP_VERSION` (the version, such as `v2.0.0`) and
 *    `APP_COMMIT` (the commit being recorded) in its environment, which System shows. The
 *    development compose file does not pass them, so add them for the recording, for example
 *    with a compose override file that sets them on the `api` service.
 * 4. Record, with the seed's shared password and the same version:
 *
 * ```sh
 * APP_URL=http://app.localhost ADMIN_URL=http://admin.localhost SEED_PASSWORD=… APP_VERSION=v2.0.0 \
 *   deno task video:admin
 * ```
 *
 * First the seeded person the video follows, Claire Hartley, gets a password the way a person
 * does: the product app mails her a reset code (read back through the development-only
 * `/api/test/last-mail`), and the reset sets a new random password. She then signs in from a phone
 * and a desktop browser, so her page has sessions to end. Then `admin@example.com` signs in and the
 * recording starts. Each run adds those sign-ins and one "Sessions ended" row to the audit log.
 * The product sends an address at most three reset mails an hour, so a fourth run within the hour
 * stops with a message saying so.
 * Needs `ffmpeg` with libsvtav1, libopus, libx264 and libwebp on the PATH. `CHROME_PATH` points
 * Playwright at a Chromium already on disk instead of its own download.
 *
 * How it records: Chrome's screencast sends a 2560×1600 frame each time the page paints, which
 * stays sharp where Playwright's own video would blur the text. The zooms, the captions, the label,
 * the pointer and the cards are drawn into the page itself; ffmpeg only joins the shots, holds each
 * frame until the next one, lays the music under it (trimmed to the video, faded in over 1 s and
 * out over 2 s, quieter by {@link MUSIC_GAIN_DB}) and encodes. It refuses a mix louder than
 * {@link LOUDNESS}. Before publishing, look at stills of the result
 * (`ffmpeg -i admin-panel.mp4 -vf fps=2 still-%03d.png`) for anything that is not sample data.
 */
import { type CDPSession, chromium, devices, type Locator, type Page } from "playwright"
import { h } from "preact"
import { renderToString } from "preact-render-to-string"
import { BrandMark } from "@spy4x/preact-ui/brand-mark"
import { IconSprout } from "@spy4x/preact-icons"
import { clickLike, moveLike, typeLike } from "./human-mouse.ts"

const ADMIN_URL = Deno.env.get("ADMIN_URL") ?? "http://admin.localhost"
const APP_URL = Deno.env.get("APP_URL") ?? "http://app.localhost"
const SEED_PASSWORD = Deno.env.get("SEED_PASSWORD")
if (!SEED_PASSWORD) throw new Error("SEED_PASSWORD is required: the seed's shared password")
/** The release version the recorded API reports on System, as a release build does. */
const VERSION = Deno.env.get("APP_VERSION")
if (!VERSION) {
  throw new Error("APP_VERSION is required: the version the stack's API runs with (see the header)")
}
for (const [name, url] of [["ADMIN_URL", ADMIN_URL], ["APP_URL", APP_URL]]) {
  if (!/^https?:\/\/([a-z0-9-]+\.)*localhost(:\d+)?$/.test(url)) {
    throw new Error(`${name} must be a local host such as http://app.localhost, not ${url}`)
  }
}

const VIDEO_DIR = new URL("../../apps/mpa/media/video/", import.meta.url).pathname
const POSTER_DIR = new URL("../../apps/mpa/static/video/", import.meta.url).pathname
const FONT = new URL("../../apps/mpa/static/fonts/geist-sans.var.woff2", import.meta.url)
const VIEWPORT = { width: 1280, height: 800 }
/** The delivered size, and the size budgets of each file. */
const OUTPUT = { width: 1920, height: 1200 }
const BUDGET = { webm: 4_000_000, mp4: 6_000_000, poster: 60_000 }
/** The music under the video: a CC0 track, its source and licence in `MUSIC.md`. */
const MUSIC = new URL("admin-video-music.opus", import.meta.url).pathname
/** How much quieter than the track the music plays, so it stays in the background. */
const MUSIC_GAIN_DB = -5
/** The loudest mix the recorder accepts: integrated loudness in LUFS, true peak in dBFS. */
const LOUDNESS = { integrated: -20, peak: -1 }
/** The still's width and height: `/features` draws it at most 672 px wide. */
const POSTER = { width: 1280, height: 800 }
const FPS = 30
const ADMIN_EMAIL = "admin@example.com"
/** The seeded person the support case follows, and what the operator types to find her. */
const PERSON = { name: "Claire Hartley", email: "claire.hartley@example.com", search: "hartley" }

/** One screencast frame on disk and when it was painted, in seconds. */
interface Frame {
  file: string
  at: number
}

/** One shot: its frames, and when it ended. */
interface Segment {
  frames: Frame[]
  end: number
}

/**
 * Collects the screencast's frames. Frames arrive only when the page paints, so the newest one is
 * always kept: it is the first frame of the next shot, whatever happened since.
 */
class Recorder {
  private latest: { data: string; at: number } | null = null
  private current: Frame[] | null = null
  private count = 0
  readonly segments: Segment[] = []

  constructor(private readonly cdp: CDPSession, private readonly dir: string) {}

  async start(): Promise<void> {
    this.cdp.on("Page.screencastFrame", async ({ data, sessionId }) => {
      const at = performance.now() / 1000
      this.latest = { data, at }
      if (this.current) this.current.push(await this.write(data, at))
      await this.cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {})
    })
    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 95,
      maxWidth: VIEWPORT.width * 2,
      maxHeight: VIEWPORT.height * 2,
      everyNthFrame: 1,
    })
  }

  async stop(): Promise<void> {
    await this.cdp.send("Page.stopScreencast")
  }

  private async write(data: string, at: number): Promise<Frame> {
    const file = `${this.dir}/${String(this.count++).padStart(6, "0")}.jpg`
    await Deno.writeFile(file, Uint8Array.from(atob(data), (c) => c.charCodeAt(0)))
    return { file, at }
  }

  /** Starts a shot with what the screen shows now. */
  async begin(): Promise<void> {
    if (!this.latest) throw new Error("the screencast sent no frame yet")
    const now = performance.now() / 1000
    this.current = [await this.write(this.latest.data, now)]
  }

  /** Ends the shot. What happens until the next `begin` is cut. */
  end(): Segment {
    if (!this.current) throw new Error("no shot is running")
    const segment = { frames: this.current, end: performance.now() / 1000 }
    this.segments.push(segment)
    this.current = null
    return segment
  }
}

/**
 * The layer drawn over the page while recording: the pointer and its click marks, the caption
 * bar, the "Sample data" label and the full-screen cards. It lives in the top layer (a manual
 * popover), above the app's own dialogs, and is never scaled by a zoom. `__video.zoom` scales
 * the page (and an open dialog, which the top layer keeps out of the page's transform) around a
 * point, and moves the drawn pointer with it.
 */
function overlayScript(font: string): string {
  return `(() => {
  if (globalThis !== globalThis.top) return
  const INK = "oklch(0.15 0.012 260)"
  let pos = { x: 1100, y: 700 }
  let zoom = null
  const layer = document.createElement("div")
  layer.setAttribute("popover", "manual")
  layer.setAttribute("aria-hidden", "true")
  layer.innerHTML = \`<style>
    @font-face { font-family: VideoGeist; src: url("${font}") format("woff2"); font-weight: 100 900 }
    [popover].v-layer { position: fixed; inset: 0; width: 100vw; height: 100vh; margin: 0;
      padding: 0; border: 0; background: transparent; overflow: visible; pointer-events: none;
      font-family: VideoGeist, sans-serif; color: #fff }
    .v-card { position: absolute; inset: 0; display: none; flex-direction: column;
      align-items: center; justify-content: center; gap: 28px; background: \${INK};
      text-align: center; padding: 0 120px }
    .v-card.on { display: flex }
    .v-card h1 { margin: 0; font-size: 60px; line-height: 1.1; font-weight: 600;
      letter-spacing: -0.03em; color: oklch(0.96 0.006 260); text-wrap: balance }
    .v-card p { margin: 0; font-size: 30px; font-weight: 500; color: oklch(0.72 0.014 260) }
    /* The brand mark as the website's header draws it in the dark theme, twice the size. */
    .v-brand { zoom: 2 }
    .v-brand [data-e2e=brand-mark] { display: inline-flex; align-items: center; gap: 8px;
      font-size: 16px; line-height: 24px; font-weight: 500; color: oklch(0.93 0.006 260) }
    .v-brand [data-e2e=brand-mark] > span:first-child { display: flex; flex-shrink: 0;
      width: 32px; height: 32px; align-items: center; justify-content: center;
      border-radius: 12px; background: oklch(0.381 0.176 305); color: #fff }
    .v-brand svg { width: 20px; height: 20px }
    .v-caption { position: absolute; left: 0; right: 0; bottom: 0; height: 84px;
      display: flex; align-items: center; justify-content: center; font-size: 32px;
      font-weight: 500; letter-spacing: -0.01em; background: oklch(0.15 0.012 260 / 0.7);
      opacity: 0; transition: opacity 250ms ease }
    .v-caption.on { opacity: 1 }
    .v-label { position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
      padding: 3px 12px;
      border-radius: 999px; font-size: 20px; font-weight: 500;
      background: oklch(0.15 0.012 260 / 0.75); color: oklch(0.85 0.01 260);
      border: 1px solid oklch(0.45 0.016 260) }
    .v-pointer { position: absolute; left: 0; top: 0; width: 24px; height: 28px;
      filter: drop-shadow(0 1px 2px rgba(0,0,0,.6)) }
    .v-pointer svg { display: block; transform-origin: 3px 2px; transition: transform 90ms ease-out }
    .v-mark { position: absolute; width: 72px; height: 72px; margin: -36px 0 0 -36px;
      border-radius: 50%; box-sizing: border-box; border: 4px solid #38bdf8 }
  </style>
  <div class="v-card"><div class="v-brand"></div><h1></h1><p></p></div>
  <div class="v-caption"></div>
  <div class="v-label">Sample data</div>
  <div class="v-pointer"><svg width="24" height="28" viewBox="0 0 24 28">
    <path d="M3 2 L3 21.5 L8.3 16.4 L11.9 24.6 L15.3 23.1 L11.8 15.1 L19 14.8 Z" fill="#fff"
      stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg></div>\`
  layer.className = "v-layer"
  const $ = (selector) => layer.querySelector(selector)
  const pointer = () => $(".v-pointer")
  const shown = () => zoom
    ? { x: zoom.tx + zoom.s * (pos.x - zoom.x), y: zoom.ty + zoom.s * (pos.y - zoom.y) }
    : pos
  const place = () => {
    const p = shown()
    pointer().style.transform = \`translate(\${p.x - 3}px, \${p.y - 2}px)\`
  }
  // Back on top of the top layer, above a dialog that opened after it.
  const raise = () => {
    if (!layer.isConnected) document.documentElement.appendChild(layer)
    try { layer.hidePopover() } catch {}
    layer.showPopover()
  }
  const mount = () => {
    raise()
    place()
    new MutationObserver(() => raise()).observe(document.body, {
      subtree: true, attributes: true, attributeFilter: ["open"], childList: true,
    })
  }
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", mount)
  else mount()
  addEventListener("mousemove", (e) => {
    pos = { x: e.clientX, y: e.clientY }
    place()
  }, true)
  addEventListener("mousedown", () => {
    pointer().firstElementChild.style.transform = "scale(.7)"
    const p = shown()
    const mark = document.createElement("div")
    mark.className = "v-mark"
    mark.style.left = p.x + "px"
    mark.style.top = p.y + "px"
    layer.appendChild(mark)
    mark.animate([
      { transform: "scale(.3)", opacity: 1 },
      { transform: "scale(1)", opacity: 0 },
    ], { duration: 450, easing: "ease-out", fill: "forwards" }).onfinish = () => mark.remove()
  }, true)
  addEventListener("mouseup", () => {
    pointer().firstElementChild.style.transform = ""
  }, true)

  const targets = () => [document.body, ...document.querySelectorAll("dialog[open]")]
  globalThis.__video = {
    // Hides the whole layer, for the poster: no pointer, caption or label.
    bare(on) {
      layer.style.visibility = on ? "hidden" : ""
    },
    caption(text) {
      const bar = $(".v-caption")
      if (text) bar.textContent = text
      bar.classList.toggle("on", Boolean(text))
    },
    card(card) {
      $(".v-card").classList.toggle("on", Boolean(card))
      pointer().style.visibility = card ? "hidden" : ""
      $(".v-label").style.visibility = card ? "hidden" : ""
      if (!card) return
      $(".v-brand").innerHTML = card.brand
      $(".v-card h1").textContent = card.title
      $(".v-card p").textContent = card.sub ?? ""
    },
    // Scales by s around (x, y) and moves that point to (tx, ty).
    zoom(s, x, y, tx = x, ty = y) {
      zoom = { s, x, y, tx, ty }
      for (const el of targets()) {
        el.style.transition = "none"
        el.style.transform = "none"
        const r = el.getBoundingClientRect()
        el.style.transformOrigin = \`\${x - r.left}px \${y - r.top}px\`
        el.getBoundingClientRect()
        el.style.transition = "transform 500ms cubic-bezier(.4, 0, .2, 1)"
        el.style.transform = \`translate(\${tx - x}px, \${ty - y}px) scale(\${s})\`
      }
      pointer().style.transition = "transform 500ms cubic-bezier(.4, 0, .2, 1)"
      place()
    },
    unzoom() {
      zoom = null
      for (const el of targets()) el.style.transform = "none"
      place()
      setTimeout(() => {
        pointer().style.transition = ""
        for (const el of targets()) {
          el.style.transition = ""
          el.style.transform = ""
          el.style.transformOrigin = ""
        }
      }, 520)
    },
  }
})()`
}

function dataUrl(bytes: Uint8Array, type: string): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `data:${type};base64,${btoa(binary)}`
}

/** A POST to the product app's API as its own pages send it, from a browser with `userAgent`. */
async function post(path: string, body: unknown, userAgent?: string): Promise<Response> {
  return await fetch(`${APP_URL}/api${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: APP_URL,
      "Sec-Fetch-Site": "same-origin",
      ...(userAgent ? { "User-Agent": userAgent } : {}),
    },
    body: JSON.stringify(body),
  })
}

/**
 * Gives {@link PERSON} a fresh random password through the product's own reset flow, then signs her
 * in from a phone and a desktop browser, so her page lists two sessions for the video to end. The
 * API names each device from the user agent it sees.
 */
async function signInPerson(): Promise<void> {
  const lastMail = async () => {
    const response = await post("/test/last-mail", { email: PERSON.email })
    return response.ok ? await response.json() as { subject: string; text: string } : null
  }
  // A mail from an earlier run carries a spent code: wait for one that differs from it.
  const before = (await lastMail())?.text
  const forgot = await post("/auth/password/forgot", { email: PERSON.email })
  if (forgot.status === 429) {
    throw new Error(`${PERSON.email} had three reset mails this hour already; record again later`)
  }
  if (!forgot.ok) throw new Error(`the reset request answered ${forgot.status}`)
  let code: string | null = null
  const deadline = Date.now() + 30_000
  while (!code && Date.now() < deadline) {
    const mail = await lastMail()
    const fresh = mail?.subject === "Reset your password" && mail.text !== before
    const link = fresh ? mail.text.match(/https?:\/\/\S+/) : null
    code = link ? new URL(link[0]).searchParams.get("code") : null
    if (!code) await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (!code) {
    throw new Error(`no reset mail reached ${PERSON.email} within 30 s; is the worker running?`)
  }
  const password = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))))
  const reset = await post("/auth/password/reset", {
    email: PERSON.email,
    code,
    newPassword: password,
  })
  if (!reset.ok) throw new Error(`the reset answered ${reset.status}: ${await reset.text()}`)
  for (const device of ["iPhone 15", "Desktop Firefox"]) {
    const response = await post(
      "/auth/password/check",
      { login: PERSON.email, password },
      devices[device].userAgent,
    )
    if (!response.ok) throw new Error(`${PERSON.name}'s sign-in answered ${response.status}`)
    await response.body?.cancel()
    // The app's first request after a sign-in, which also marks her as seen.
    const cookie = response.headers.getSetCookie().map((line) => line.split(";")[0]).join("; ")
    const me = await fetch(`${APP_URL}/api/auth/me`, {
      headers: { Cookie: cookie, "User-Agent": devices[device].userAgent },
    })
    if (!me.ok) throw new Error(`${PERSON.name}'s first request answered ${me.status}`)
    await me.body?.cancel()
  }
}

/** Signs the administrator in through the form, then opens every screen once so none loads slowly. */
async function signInAndWarmUp(page: Page): Promise<void> {
  await page.goto("/sign-in")
  await page.locator("[data-e2e=auth-form-login]").fill(ADMIN_EMAIL)
  await page.locator("[data-e2e=auth-form-password]").fill(SEED_PASSWORD!)
  await page.locator("[data-e2e=auth-form-submit]").click()
  await page.getByRole("heading", { level: 1, name: "Dashboard" }).waitFor({ timeout: 120_000 })
  for (const [path, name] of SCREENS) {
    await page.goto(path)
    await page.getByRole("heading", { level: 1, name }).waitFor({ timeout: 120_000 })
    await page.waitForLoadState("networkidle")
  }
  // The person page and a group's page load their own code on first use.
  await page.goto(`/users?q=${encodeURIComponent(PERSON.search)}`)
  await page.getByRole("link", { name: PERSON.name }).click()
  await page.getByRole("heading", { level: 1, name: PERSON.name }).waitFor({ timeout: 120_000 })
  // The list opens on the newest groups; the one the video opens is found by name.
  await page.goto(`/groups?q=${encodeURIComponent("Product team")}`)
  await page.getByRole("link", { name: "Product team" }).click()
  await page.getByRole("heading", { level: 1, name: "Product team" }).waitFor({ timeout: 120_000 })
  await page.waitForLoadState("networkidle")
  // So is a customer's billing page.
  await page.goto("/billing")
  await page.getByRole("link", { name: CUSTOMER }).click()
  await page.getByRole("heading", { level: 1, name: CUSTOMER }).waitFor({ timeout: 120_000 })
  await page.waitForLoadState("networkidle")
}

/** The screens the video opens, by path and page title; the warm-up visits each. */
const SCREENS = [
  ["/", "Dashboard"],
  ["/users", "Users"],
  ["/groups", "Groups"],
  ["/newsletter", "Newsletter"],
  ["/audit", "Audit log"],
  ["/billing", "Billing"],
  ["/system", "System"],
] as const

/** The seeded customer the Billing shot opens: the one whose history holds a refund. */
const CUSTOMER = "Design studio"

const H = VIEWPORT.height
/** The caption bar's height: a zoom centres its region in the frame above it. */
const CAPTION = 84
const pause = (page: Page, ms: number) => page.waitForTimeout(ms)
const video = (page: Page, script: string) => page.evaluate(script)
const caption = (page: Page, text: string | null) =>
  video(page, `__video.caption(${JSON.stringify(text)})`)

interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** The box of an element on screen. */
async function box(target: Locator): Promise<Box> {
  const found = await target.first().boundingBox()
  if (!found) throw new Error(`${target} has no box`)
  return found
}

/** The smallest box around all of `boxes`. */
function union(...boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  }
}

/**
 * Zooms in on `region`: as far as it fits above the caption with a margin, between `least` (1.6×
 * unless a wide region asks for less) and 2×, with its centre in the middle of that space, and
 * never past the page's edges.
 */
async function zoomOn(page: Page, region: Box, least = 1.6): Promise<void> {
  const room = { width: VIEWPORT.width - 80, height: H - CAPTION - 60 }
  const s = Math.max(least, Math.min(2, room.width / region.width, room.height / region.height))
  const tx = VIEWPORT.width / 2
  const ty = (H - CAPTION) / 2
  const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)
  const x = clamp(region.x + region.width / 2, tx / s, VIEWPORT.width - (VIEWPORT.width - tx) / s)
  const y = clamp(region.y + region.height / 2, ty / s, H - (H - ty) / s)
  await video(
    page,
    `__video.zoom(${s.toFixed(3)}, ${Math.round(x)}, ${Math.round(y)}, ${tx}, ${ty})`,
  )
}

/**
 * Zooms so that `region` ends exactly where the caption starts, as large as the frame allows (at
 * most 2×), centred across. Nothing below `region` shows above the caption, so the caption never
 * cuts a card or a row in half. Never below 1×, which would shrink the page and leave the frame's
 * edges empty: a `region` taller than the frame starts at its top and runs under the caption.
 * `region` is measured at 1×.
 */
async function fillAboveCaption(page: Page, region: Box): Promise<void> {
  const room = H - CAPTION
  const s = Math.max(1, Math.min(2, (VIEWPORT.width - 80) / region.width, room / region.height))
  const tx = VIEWPORT.width / 2
  const x = Math.min(
    Math.max(region.x + region.width / 2, tx / s),
    VIEWPORT.width - (VIEWPORT.width - tx) / s,
  )
  const y = region.y + region.height / 2
  const ty = Math.max(room - s * region.height / 2, s * region.height / 2)
  await video(
    page,
    `__video.zoom(${s.toFixed(3)}, ${Math.round(x)}, ${Math.round(y)}, ${tx}, ${Math.round(ty)})`,
  )
}

/** Takes a zoom away off the record, between shots: the next shot starts at 1×. */
async function unzoom(page: Page): Promise<void> {
  await video(page, `__video.unzoom()`)
  await pause(page, 600)
}

/** Glides the pointer to `target` and clicks it where it is, without scrolling the page first. */
async function clickInPlace(
  page: Page,
  pointer: { x: number; y: number },
  target: Locator,
): Promise<void> {
  const found = await box(target)
  await moveLike(page, pointer, {
    x: Math.round(found.x + found.width / 2),
    y: Math.round(found.y + found.height / 2),
  })
  await pause(page, 150)
  await page.mouse.down()
  await pause(page, 200)
  await page.mouse.up()
  await pause(page, 200)
}

/** Waits until the page has painted its last change, so the next shot starts on it. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle")
  await pause(page, 500)
}

/** The brand mark of the cards: the website header's own component. */
const BRAND = renderToString(h(BrandMark, { Icon: IconSprout, name: "Seed" }))

/**
 * Plays the shot list into the recorder. Every shot starts on a settled screen, shows its caption
 * for at least 2.5 seconds, and ends with a hard cut; nothing between shots is kept. Returns the
 * posters' frames: the cropped still of the Users list, and the Dashboard the video opens on.
 */
async function play(
  page: Page,
  rec: Recorder,
  frames: string,
): Promise<{ still: string; opening: string }> {
  const pointer = { x: 1100, y: 700 }
  await page.mouse.move(pointer.x, pointer.y)
  const shot = async (text: string | null, body: () => Promise<void>) => {
    await settle(page)
    await rec.begin()
    if (text) await caption(page, text)
    await body()
    rec.end()
    await caption(page, null)
  }
  /** A hard cut inside a shot, over a page that is still loading; the caption stays. */
  const cut = async (loaded: () => Promise<void>) => {
    rec.end()
    await loaded()
    await settle(page)
    await rec.begin()
  }
  /**
   * Glides to `target`, scrolling it into view as `clickLike` does, and presses the button
   * without letting go: a shot that ends on a link ends here, before the next page starts loading,
   * and the release follows after the cut.
   */
  const press = async (target: Locator) => {
    await target.waitFor()
    let found = await box(target)
    if (found.y < 96 || found.y + found.height > H - 48) {
      const delta = Math.round(found.y + found.height / 2 - H / 2)
      await page.evaluate(`scrollBy({ top: ${delta}, behavior: "smooth" })`)
      await pause(page, 800)
      found = await box(target)
    }
    await moveLike(page, pointer, {
      x: Math.round(found.x + found.width / 2),
      y: Math.round(found.y + found.height / 2),
    })
    await pause(page, 150)
    await page.mouse.down()
    await pause(page, 350)
  }
  const card = (content: { title: string; sub?: string } | null) =>
    video(page, `__video.card(${JSON.stringify(content && { ...content, brand: BRAND })})`)

  // The poster, off the record: the Users list without the layer, cropped to the first five people
  // and the page's right edge, so it carries no text of ours and cuts no word.
  await page.goto("/users")
  await page.getByRole("heading", { level: 1, name: "Users" }).waitFor()
  await settle(page)
  await video(page, `__video.bare(true)`)
  const fifth = await box(page.locator("table tbody tr").nth(4))
  const height = Math.round(fifth.y + fifth.height + 16)
  const width = Math.round(height * POSTER.width / POSTER.height)
  const heading = await box(page.getByRole("heading", { level: 1, name: "Users" }))
  if (VIEWPORT.width - width > heading.x - 16) throw new Error("the poster's crop cuts the page")
  const poster = `${frames}/poster.png`
  await page.screenshot({
    path: poster,
    clip: { x: VIEWPORT.width - width, y: 0, width, height },
  })
  await video(page, `__video.bare(false)`)

  // 0. Title card, over the Dashboard it cuts to. First, off the record, the player's poster: the
  // Dashboard without the layer, so no pointer, caption or label.
  await page.goto("/")
  await page.getByRole("heading", { level: 1, name: "Dashboard" }).waitFor()
  await page.locator("[data-e2e=admin-chart-active]").waitFor()
  await settle(page)
  await video(page, `__video.bare(true)`)
  const opening = `${frames}/opening.png`
  await page.screenshot({ path: opening })
  await video(page, `__video.bare(false)`)
  await card({
    title: "Seed's admin panel, built for support work",
    sub: "Part of Seed. Free and MIT-licensed.",
  })
  await shot(null, () => pause(page, 3000))
  await card(null)

  // 1. Dashboard: the whole screen, then a zoom on the chart of who was active each day.
  await shot("The last 30 days at a glance", async () => {
    await pause(page, 2000)
    await zoomOn(page, await box(page.locator("[data-e2e=admin-chart-active]")))
    await pause(page, 2600)
  })
  await unzoom(page)
  await clickLike(page, pointer, page.getByRole("link", { name: "Users" }), H)
  await page.getByRole("heading", { level: 1, name: "Users" }).waitFor()
  await moveLike(page, pointer, { x: 1100, y: 700 })

  // 2. Users: the search narrows the list to the Hartleys, zoomed in on the field and the results.
  await shot("Find anyone by name or address", async () => {
    await pause(page, 500)
    const field = page.getByLabel("Name or address")
    await typeLike(page, pointer, field, PERSON.search, H)
    await pause(page, 300)
    await page.keyboard.press("Enter")
    // The seed has exactly three people named Hartley; the list narrows to them.
    await page.getByText(/^3 people$/).waitFor()
    await pause(page, 500)
    const last = page.locator("table tbody tr").last().locator("td").first()
    await zoomOn(page, union(await box(field), await box(last)))
    await pause(page, 2400)
    await video(page, `__video.unzoom()`)
    await pause(page, 700)
    await press(page.getByRole("link", { name: PERSON.name }))
  })
  await page.mouse.up()

  // 3. The person's page on its Sessions tab, opened off the record, zoomed in on the tabs and her
  // two sessions.
  await page.getByRole("heading", { level: 1, name: PERSON.name }).waitFor()
  await clickLike(page, pointer, page.getByRole("tab", { name: /Sessions/ }), H)
  const sessions = page.locator("[data-e2e=admin-user-sessions]")
  await sessions.locator("li").first().waitFor()
  await shot("Sign-in methods, sessions, groups and history", async () => {
    await pause(page, 300)
    const tabs = await box(page.getByRole("tablist"))
    await zoomOn(page, { ...union(tabs, await box(sessions)), width: Math.min(tabs.width, 740) })
    await pause(page, 3200)
  })
  await unzoom(page)

  // 4. End all sessions: the confirmation, zoomed in, then confirmed.
  await shot("Every action asks first", async () => {
    await clickLike(page, pointer, page.locator("[data-e2e=admin-sessions-end-all-open]"), H)
    const dialog = page.locator("[data-e2e=admin-action-dialog]")
    await dialog.waitFor()
    await pause(page, 400)
    const submit = await box(page.locator("[data-e2e=admin-action-submit]"))
    await moveLike(page, pointer, {
      x: Math.round(submit.x + submit.width / 2),
      y: Math.round(submit.y + submit.height / 2),
    })
    await pause(page, 200)
    await zoomOn(page, await box(dialog))
    await pause(page, 2600)
    await video(page, `__video.unzoom()`)
    await pause(page, 700)
    await clickLike(page, pointer, page.locator("[data-e2e=admin-action-submit]"), H)
    await dialog.waitFor({ state: "hidden" })
    await pause(page, 1600)
  })
  // The confirmation's toast closes before the next shot.
  await page.getByText(`Every session of ${PERSON.name} has ended.`).waitFor({
    state: "hidden",
    timeout: 20_000,
  })

  // 5. The audit log, zoomed in on its newest row: the one just written.
  await clickLike(page, pointer, page.getByRole("link", { name: "Audit log" }), H)
  await page.getByRole("heading", { level: 1, name: "Audit log" }).waitFor()
  await moveLike(page, pointer, { x: 1150, y: 260 })
  const rows = page.locator("table tbody tr")
  await rows.first().getByText("Sessions ended").waitFor()
  await shot("…and lands in the audit log", async () => {
    await pause(page, 300)
    // The header, the new row and the one before it, from When to Done by.
    const header = await box(page.locator("table thead tr"))
    await zoomOn(page, { ...union(header, await box(rows.nth(1))), width: 640 })
    await pause(page, 3200)
  })
  await unzoom(page)

  // 6. Groups, the largest first, then one group's members. The list opens on the newest groups,
  // which in the seed are one-person groups, so the shot sorts it by members off the record.
  await clickLike(page, pointer, page.getByRole("link", { name: "Groups" }), H)
  await page.getByRole("heading", { level: 1, name: "Groups" }).waitFor()
  await page.goto(`/groups?sort=${encodeURIComponent("memberCount:desc")}`)
  await page.locator("table tbody tr").first().getByRole("link", { name: "Product team" }).waitFor()
  await moveLike(page, pointer, { x: 900, y: 120 })
  await shot("Every group, its owner and its members", async () => {
    // The largest groups, from their names to their member counts.
    await pause(page, 300)
    const groups = page.locator("table tbody tr")
    const header = await box(page.locator("table thead tr"))
    await zoomOn(page, { ...union(header, await box(groups.nth(3))), width: 560 })
    await pause(page, 2400)
    // A hard cut to the one the operator opens: no stretch of the list at 1× in between.
    await cut(async () => {
      await unzoom(page)
      await clickLike(page, pointer, page.getByRole("link", { name: "Product team" }), H)
      await page.getByRole("heading", { level: 1, name: "Product team" }).waitFor()
      // The group's overview widgets come before its tabs, so the page scrolls them to the top.
      await page.locator("[data-e2e=admin-group-members] > li").nth(3).waitFor()
      await page.locator("[data-e2e=admin-group-tab]").first().evaluate((tab) =>
        tab.scrollIntoView({ block: "start" })
      )
      await moveLike(page, pointer, { x: 900, y: 200 })
    })
    // Its tabs and first members, by name and address.
    await pause(page, 300)
    const tabs = await box(page.locator("[data-e2e=admin-group-tab]").first())
    const fourth = await box(page.locator("[data-e2e=admin-group-members] > li").nth(3))
    await zoomOn(page, { ...union(tabs, fourth), width: 600 })
    await pause(page, 2600)
  })
  await unzoom(page)

  // 7. Billing: its figures and first customers, then a hard cut to one customer's page with a
  // refund in its history.
  await clickLike(page, pointer, page.getByRole("link", { name: "Billing" }), H)
  await page.getByRole("heading", { level: 1, name: "Billing" }).waitFor()
  const customers = page.locator("table tbody tr")
  await customers.first().waitFor()
  await moveLike(page, pointer, { x: 1000, y: 300 })
  await shot("Who pays, what they pay, and every refund", async () => {
    await pause(page, 300)
    // From the title to the third customer, which ends where the caption starts.
    const title = await box(page.getByRole("heading", { level: 1, name: "Billing" }))
    const third = await box(customers.nth(2))
    await fillAboveCaption(page, union({ ...title, y: title.y - 16 }, third))
    await pause(page, 2600)
    await cut(async () => {
      await unzoom(page)
      await clickLike(page, pointer, page.getByRole("link", { name: CUSTOMER }), H)
      await page.getByRole("heading", { level: 1, name: CUSTOMER }).waitFor()
      await page.getByText(/refunded$/).first().waitFor()
      await moveLike(page, pointer, { x: 1000, y: 620 })
    })
    // Its plan, its last payment and the refund, with the operator's note.
    await pause(page, 300)
    const plan = await box(page.locator("[data-e2e=admin-billing-summary]"))
    const note = await box(page.getByText(/^By .+ Note:/))
    await zoomOn(page, { ...union(plan, note), width: 620 })
    await pause(page, 3000)
  })
  await unzoom(page)

  // 8. Newsletter: its numbers and how the list grew, slightly zoomed in.
  await clickLike(page, pointer, page.getByRole("link", { name: "Newsletter" }), H)
  await page.getByRole("heading", { level: 1, name: "Newsletter" }).waitFor()
  await page.locator("[data-e2e=admin-newsletter-chart]").waitFor()
  await moveLike(page, pointer, { x: 1100, y: 700 })
  await shot("Newsletter subscribers and sent issues", async () => {
    await pause(page, 300)
    const title = await box(page.locator("[data-e2e=admin-newsletter-title]"))
    const chart = await box(page.locator("[data-e2e=admin-newsletter-chart]"))
    await zoomOn(page, union(title, chart), 1)
    await pause(page, 3000)
  })
  await unzoom(page)

  // 9. System: from its title to the second row of services, which ends where the caption starts.
  // The third row, the API build, runs under the caption: three rows would need a zoom below 1×.
  await clickLike(page, pointer, page.getByRole("link", { name: "System" }), H)
  await page.getByRole("heading", { level: 1, name: "System" }).waitFor()
  await page.locator("[data-e2e=admin-system-summary]").waitFor()
  await page.locator("[data-e2e=admin-system-build]").getByText(VERSION).waitFor()
  const systemTitle = await box(page.getByRole("heading", { level: 1, name: "System" }))
  const services = await box(page.locator("[data-e2e=admin-system-cards]"))
  const secondRow = await box(page.locator("[data-e2e=admin-system-migrations]"))
  const system = union({ ...systemTitle, y: systemTitle.y - 16 }, {
    ...services,
    height: secondRow.y + secondRow.height - services.y,
  })
  await fillAboveCaption(page, system)
  await pause(page, 600)
  await moveLike(page, pointer, { x: 1100, y: 690 })
  await shot("The health of every service", () => pause(page, 3000))

  // 10. The same screen switches to light, from the operator's account menu, zoomed in on it.
  await shot("Light and dark", async () => {
    await pause(page, 100)
    await clickInPlace(page, pointer, page.locator(ACCOUNT_MENU))
    await pause(page, 300)
    await zoomOn(page, await box(page.getByRole("menu")))
    await pause(page, 1100)
    await fillAboveCaption(page, system)
    await pause(page, 500)
    await clickInPlace(page, pointer, page.getByRole("menuitemradio", { name: "Light" }))
    await moveLike(page, pointer, { x: 700, y: 420 })
    await pause(page, 1300)
  })

  // 11. End card.
  await card({ title: "Free and MIT-licensed. The code is on GitHub." })
  await shot(null, () => pause(page, 3000))

  return { still: poster, opening }
}

/** The button that opens the operator's account menu at the foot of the rail. */
const ACCOUNT_MENU = "[data-e2e=account-menu-button]"

/** Runs ffmpeg and fails with its error output. */
async function ffmpeg(args: string[]): Promise<void> {
  const { success, stderr } = await new Deno.Command("ffmpeg", {
    args: ["-y", "-hide_banner", "-loglevel", "error", ...args],
    stdout: "null",
  }).output()
  if (!success) throw new Error(`ffmpeg failed: ${new TextDecoder().decode(stderr)}`)
}

/**
 * The concat list that plays the shots back to back in real time: each frame lasts until the
 * next one was painted, and a shot's last frame until the shot ended.
 */
function concatList(segments: Segment[]): string {
  const lines: string[] = []
  for (const { frames, end } of segments) {
    frames.forEach((frame, index) => {
      const next = frames[index + 1]?.at ?? end
      lines.push(`file '${frame.file}'`, `duration ${Math.max(0, next - frame.at).toFixed(4)}`)
    })
  }
  // The demuxer ignores the last entry's duration unless the file is listed once more; that
  // repeat lasts one frame, and the encoder's `-t` drops it.
  const last = segments.at(-1)!.frames.at(-1)!
  lines.push(`file '${last.file}'`, `duration ${(1 / FPS).toFixed(4)}`)
  return lines.join("\n") + "\n"
}

/**
 * Encodes `list` with the music under it, with the quality settings tried in order, until the file
 * fits its budget.
 */
async function encode(
  list: string,
  out: string,
  budget: number,
  codec: (quality: number) => string[],
  qualities: number[],
  seconds: number,
): Promise<number> {
  // The fps filter holds each frame for its listed duration; `-fps_mode cfr` loses seconds.
  const filters = `fps=${FPS},scale=${OUTPUT.width}:${OUTPUT.height}:flags=lanczos,format=yuv420p`
  const music = [
    `atrim=0:${seconds.toFixed(3)}`,
    `volume=${MUSIC_GAIN_DB}dB`,
    `afade=t=in:d=1`,
    `afade=t=out:st=${(seconds - 2).toFixed(3)}:d=2`,
  ].join(",")
  for (const quality of qualities) {
    await ffmpeg([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-i",
      MUSIC,
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-vf",
      filters,
      "-af",
      music,
      // Ends the video where the recording ended, not after the list's closing repeat.
      "-t",
      seconds.toFixed(3),
      ...codec(quality),
      out,
    ])
    const { size } = await Deno.stat(out)
    if (size <= budget) return size
  }
  throw new Error(`${out} stays above its budget of ${budget} bytes`)
}

/** The integrated loudness (LUFS) and true peak (dBFS) of a file's sound, as EBU R 128 measures. */
async function loudness(file: string): Promise<{ integrated: number; peak: number }> {
  const { success, stderr } = await new Deno.Command("ffmpeg", {
    args: [
      ...["-hide_banner", "-nostats", "-i", file, "-map", "0:a"],
      ...["-af", "ebur128=peak=true", "-f", "null", "-"],
    ],
    stdout: "null",
  }).output()
  const text = new TextDecoder().decode(stderr)
  const summary = text.slice(text.lastIndexOf("Summary:"))
  const integrated = summary.match(/I:\s+(-?[\d.]+) LUFS/)?.[1]
  const peak = summary.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1]
  if (!success || !integrated || !peak) throw new Error(`ffmpeg could not measure ${file}: ${text}`)
  return { integrated: Number(integrated), peak: Number(peak) }
}

/** The length of a media file in seconds, as ffprobe reads it. */
async function duration(file: string): Promise<number> {
  const { success, stdout } = await new Deno.Command("ffprobe", {
    args: ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
  }).output()
  const seconds = Number(new TextDecoder().decode(stdout))
  if (!success || !seconds) throw new Error(`ffprobe could not read the length of ${file}`)
  return seconds
}

/** A poster: a frame `play` returned, at `size`, as WebP within its budget. */
async function encodePoster(
  frame: string,
  out: string,
  size: { width: number; height: number },
): Promise<number> {
  for (const quality of [82, 74, 66, 58]) {
    await ffmpeg([
      "-i",
      frame,
      "-vf",
      `scale=${size.width}:${size.height}:flags=lanczos`,
      "-c:v",
      "libwebp",
      "-quality",
      String(quality),
      out,
    ])
    const bytes = (await Deno.stat(out)).size
    if (bytes <= BUDGET.poster) return bytes
  }
  throw new Error(`${out} stays above its budget of ${BUDGET.poster} bytes`)
}

const browser = await chromium.launch({ executablePath: Deno.env.get("CHROME_PATH") || undefined })
const frames = await Deno.makeTempDir({ prefix: "admin-video-" })
try {
  await signInPerson()
  const context = await browser.newContext({
    baseURL: ADMIN_URL,
    // The audit log prints the browser's user agent; headless Chromium names itself
    // "HeadlessChrome", which no operator's browser does.
    userAgent: (await browser.newPage().then(async (p) => {
      const agent = await p.evaluate(() => navigator.userAgent)
      await p.close()
      return agent
    })).replace("HeadlessChrome", "Chrome"),
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: "dark",
    locale: "en-GB",
    timezoneId: "Etc/UTC",
  })
  try {
    const font = dataUrl(await Deno.readFile(FONT), "font/woff2")
    await context.addInitScript(overlayScript(font))
    const page = await context.newPage()
    await signInAndWarmUp(page)
    const rec = new Recorder(await context.newCDPSession(page), frames)
    await rec.start()
    const posterFrames = await play(page, rec, frames)
    await rec.stop()

    await Deno.mkdir(VIDEO_DIR, { recursive: true })
    await Deno.mkdir(POSTER_DIR, { recursive: true })
    const list = `${frames}/list.txt`
    await Deno.writeTextFile(list, concatList(rec.segments))
    const seconds = rec.segments.reduce((sum, s) => sum + s.end - s.frames[0].at, 0)
    if (await duration(MUSIC) < seconds) {
      throw new Error(`the music lasts less than the video's ${seconds.toFixed(1)} s`)
    }
    const webm = await encode(
      list,
      `${VIDEO_DIR}admin-panel.webm`,
      BUDGET.webm,
      (crf) => [
        "-c:v",
        "libsvtav1",
        "-preset",
        "4",
        "-crf",
        String(crf),
        "-g",
        "300",
        "-c:a",
        "libopus",
        "-b:a",
        "96k",
      ],
      [36, 42, 48],
      seconds,
    )
    const mp4 = await encode(
      list,
      `${VIDEO_DIR}admin-panel.mp4`,
      BUDGET.mp4,
      (crf) => [
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-tune",
        "animation",
        "-crf",
        String(crf),
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
      ],
      [24, 28, 32],
      seconds,
    )
    for (const file of [`${VIDEO_DIR}admin-panel.webm`, `${VIDEO_DIR}admin-panel.mp4`]) {
      const sound = await loudness(file)
      if (sound.integrated > LOUDNESS.integrated || sound.peak > LOUDNESS.peak) {
        throw new Error(
          `${file}'s music is too loud: ${sound.integrated} LUFS, peak ${sound.peak} dBFS`,
        )
      }
      console.log(`${file}: ${sound.integrated} LUFS, true peak ${sound.peak} dBFS`)
    }
    const poster = await encodePoster(
      posterFrames.still,
      `${POSTER_DIR}admin-panel-poster-${POSTER.width}.webp`,
      POSTER,
    )
    const opening = await encodePoster(
      posterFrames.opening,
      `${POSTER_DIR}admin-panel-poster-${OUTPUT.width}.webp`,
      OUTPUT,
    )
    console.log(
      `admin-panel: ${seconds.toFixed(1)} s, webm ${webm} B, mp4 ${mp4} B, ` +
        `posters ${poster} B and ${opening} B. Now update apps/mpa/admin-video.ts.`,
    )
  } finally {
    await context.close()
  }
} finally {
  await browser.close()
  await Deno.remove(frames, { recursive: true })
}
