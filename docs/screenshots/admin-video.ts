/**
 * Records the admin panel video of the public website's `/features#admin` section
 * (`apps/mpa/static/video/`): one support case end to end, then short glimpses of the other
 * screens, in the dark theme, with burned-in captions, a "Sample data" label and a title and an
 * end card. The shot list and the copy are on issue #279.
 *
 * Needs a running stack with the admin app and the development seed, never the live server:
 *
 * 1. Start a local stack whose admin app answers at `ADMIN_URL` (`deno task dev` behind
 *    `deno task proxy:start` serves it at http://admin.localhost).
 * 2. Seed its database once: `ENV=dev deno task db:seed` with the values in docs/development.md.
 *    The video shows the seed's fake example.com people, groups and subscribers.
 * 3. Record, with the seed's shared password:
 *
 * ```sh
 * ADMIN_URL=http://admin.localhost SEED_PASSWORD=… deno task video:admin
 * ```
 *
 * It signs `demo@example.com` in from two emulated devices, so the person page has sessions to
 * end, then signs `admin@example.com` in and records. Each run adds one "Sessions ended" row to
 * the audit log. Needs `ffmpeg` with libsvtav1, libx264 and libwebp on the PATH. `CHROME_PATH`
 * points Playwright at a Chromium already on disk instead of its own download.
 *
 * How it records: Chrome's screencast sends a 2560×1600 frame each time the page paints, which
 * stays sharp where Playwright's own video would blur the text. The zooms, the captions, the label,
 * the pointer and the cards are drawn into the page itself; ffmpeg only joins the shots, holds each
 * frame until the next one and encodes. Before publishing, look at stills of the result
 * (`ffmpeg -i admin-panel.mp4 -vf fps=2 still-%03d.png`) for anything that is not sample data.
 */
import { type Browser, type CDPSession, chromium, devices, type Locator, type Page } from "playwright"
import { clickLike, moveLike, typeLike } from "./human-mouse.ts"

const ADMIN_URL = Deno.env.get("ADMIN_URL") ?? "http://admin.localhost"
const SEED_PASSWORD = Deno.env.get("SEED_PASSWORD")
if (!SEED_PASSWORD) throw new Error("SEED_PASSWORD is required: the seed's shared password")
if (!/^https?:\/\/[a-z0-9.-]*localhost(:\d+)?$/.test(ADMIN_URL)) {
  throw new Error(`ADMIN_URL must be a local host such as http://admin.localhost, not ${ADMIN_URL}`)
}

const OUT_DIR = new URL("../../apps/mpa/static/video/", import.meta.url).pathname
const FONT = new URL("../../apps/mpa/static/fonts/geist-sans.var.woff2", import.meta.url)
const VIEWPORT = { width: 1280, height: 800 }
/** The delivered size, and the size budgets of each file. */
const OUTPUT = { width: 1920, height: 1200 }
const BUDGET = { webm: 3_000_000, mp4: 5_000_000, poster: 60_000 }
/** The poster's width and height: the website draws the video at most 640 px wide. */
const POSTER = { width: 1280, height: 800 }
const FPS = 30
const ADMIN_EMAIL = "admin@example.com"
const DEMO_EMAIL = "demo@example.com"

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
    .v-brand { display: flex; align-items: center; gap: 14px; font-size: 34px; font-weight: 650;
      letter-spacing: -0.02em; color: oklch(0.96 0.006 260) }
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
  <div class="v-card"><div class="v-brand"><svg width="44" height="44" viewBox="0 0 32 32">
    <path d="M16 29V15" stroke="#4ade80" stroke-width="2.4" stroke-linecap="round" />
    <path d="M16 17C16 10 11 6 4 6c0 7 5 11 12 11Z" fill="#4ade80" />
    <path d="M16 14c0-6 4.5-10 12-10 0 6.5-4.5 10-12 10Z" fill="#a78bfa" />
  </svg>Seed</div><h1></h1><p></p></div>
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
    caption(text) {
      const bar = $(".v-caption")
      if (text) bar.textContent = text
      bar.classList.toggle("on", Boolean(text))
    },
    card(card) {
      $(".v-card").classList.toggle("on", Boolean(card))
      pointer().style.visibility = card ? "hidden" : ""
      if (!card) return
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

/**
 * Signs the demo user in from a phone and a desktop browser, so the person page lists two
 * sessions for the video to end. The sign-ins are real: the API names each device from its
 * browser's user agent.
 */
async function signInDemoDevices(browser: Browser): Promise<void> {
  for (const device of ["iPhone 15", "Desktop Firefox"]) {
    const context = await browser.newContext({ ...devices[device], baseURL: ADMIN_URL })
    try {
      // From the sign-in page, so the browser sends the same-origin headers the API asks for.
      const page = await context.newPage()
      await page.goto("/sign-in")
      const status = await page.evaluate(
        async ([login, password]) =>
          (await fetch("/api/auth/password/check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ login, password }),
          })).status,
        [DEMO_EMAIL, SEED_PASSWORD!],
      )
      if (status !== 200) throw new Error(`the demo user's sign-in answered ${status}`)
    } finally {
      await context.close()
    }
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
  await page.goto(`/users?q=${encodeURIComponent("demo@")}`)
  await page.getByRole("link", { name: "Demo User" }).click()
  await page.getByRole("heading", { level: 1, name: "Demo User" }).waitFor({ timeout: 120_000 })
  await page.goto("/groups")
  await page.getByRole("link", { name: "Product team" }).click()
  await page.getByRole("heading", { level: 1, name: "Product team" }).waitFor({ timeout: 120_000 })
  await page.waitForLoadState("networkidle")
}

/** The screens the video opens, by path and page title; the warm-up visits each. */
const SCREENS = [
  ["/users", "Users"],
  ["/groups", "Groups"],
  ["/newsletter", "Newsletter"],
  ["/audit", "Audit log"],
  ["/system", "System"],
  ["/", "Dashboard"],
] as const

const H = VIEWPORT.height
const pause = (page: Page, ms: number) => page.waitForTimeout(ms)
const video = (page: Page, script: string) => page.evaluate(script)
const caption = (page: Page, text: string | null) =>
  video(page, `__video.caption(${JSON.stringify(text)})`)

/** The centre of an element on screen. */
async function centre(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).first().boundingBox()
  if (!box) throw new Error(`${selector} has no box`)
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
}

/** Glides the pointer to `target` and clicks it where it is, without scrolling the page first. */
async function clickInPlace(
  page: Page,
  pointer: { x: number; y: number },
  target: Locator,
): Promise<void> {
  const box = await target.boundingBox()
  if (!box) throw new Error("click target has no box")
  await moveLike(page, pointer, {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
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

/**
 * Plays the shot list into the recorder. Every shot starts on a settled screen, shows its caption
 * for at least 2.5 seconds, and ends with a hard cut; nothing between shots is kept.
 */
async function play(page: Page, rec: Recorder): Promise<string> {
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
    let box = await target.boundingBox()
    if (box && (box.y < 96 || box.y + box.height > H - 48)) {
      const delta = Math.round(box.y + box.height / 2 - H / 2)
      await page.evaluate(`scrollBy({ top: ${delta}, behavior: "smooth" })`)
      await pause(page, 800)
      box = await target.boundingBox()
    }
    if (!box) throw new Error("press target has no box")
    await moveLike(page, pointer, {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
    })
    await pause(page, 150)
    await page.mouse.down()
    await pause(page, 350)
  }

  // 0. Title card, over the dashboard it cuts to.
  await page.goto("/")
  await page.getByRole("heading", { level: 1, name: "Dashboard" }).waitFor()
  await video(page, `__video.card(${
    JSON.stringify({
      title: "Seed's admin panel, built for support work",
      sub: "Part of Seed. Free and MIT-licensed.",
    })
  })`)
  await shot(null, () => pause(page, 3000))
  await video(page, `__video.card(null)`)

  // 1. Dashboard.
  await shot("The product at a glance", async () => {
    await pause(page, 600)
    await moveLike(page, pointer, { x: 640, y: 250 })
    await pause(page, 3000)
  })

  // 2. Users: the search narrows the list to one person. The search box starts empty.
  await clickLike(page, pointer, page.getByRole("link", { name: "Users" }), H)
  await page.getByRole("heading", { level: 1, name: "Users" }).waitFor()
  await shot("Find anyone by name or address", async () => {
    await pause(page, 500)
    await typeLike(page, pointer, page.getByLabel("Name or address"), "demo@", H)
    await pause(page, 300)
    await page.keyboard.press("Enter")
    await page.getByText("1 person", { exact: true }).waitFor()
    await pause(page, 1600)
    await press(page.getByRole("link", { name: "Demo User" }))
  })
  await page.mouse.up()
  // The list's first frame, before the caption fades in, is the poster.
  const poster = rec.segments.at(-1)!.frames[0].file

  // 3. The person's page, cut to once it has loaded, then its Sessions tab.
  await page.getByRole("heading", { level: 1, name: "Demo User" }).waitFor()
  await page.getByRole("tab", { name: /Sessions/ }).waitFor()
  await shot("Sign-in methods, sessions, groups and history", async () => {
    await pause(page, 1200)
    await clickLike(page, pointer, page.getByRole("tab", { name: /Sessions/ }), H)
    await page.locator("[data-e2e=admin-user-sessions] li").first().waitFor()
    await pause(page, 2400)
  })

  // 4. End all sessions: the confirmation, zoomed in, then confirmed.
  await shot("Every action asks first", async () => {
    await clickLike(page, pointer, page.locator("[data-e2e=admin-sessions-end-all-open]"), H)
    const dialog = page.locator("[data-e2e=admin-action-dialog]")
    await dialog.waitFor()
    await pause(page, 400)
    const submit = page.locator("[data-e2e=admin-action-submit]")
    const box = await submit.boundingBox()
    if (!box) throw new Error("the confirm button has no box")
    await moveLike(page, pointer, {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
    })
    const focus = await centre(page, "[data-e2e=admin-action-dialog]")
    await video(page, `__video.zoom(1.5, ${focus.x}, ${focus.y - 40})`)
    await pause(page, 2300)
    await video(page, `__video.unzoom()`)
    await pause(page, 600)
    await clickLike(page, pointer, submit, H)
    await dialog.waitFor({ state: "hidden" })
    await pause(page, 1600)
  })
  // The confirmation's toast closes before the next shot.
  await page.getByText("Every session of Demo User has ended.").waitFor({
    state: "hidden",
    timeout: 20_000,
  })

  // 5. The audit log, its newest row the one just written.
  await clickLike(page, pointer, page.getByRole("link", { name: "Audit log" }), H)
  await page.getByRole("heading", { level: 1, name: "Audit log" }).waitFor()
  await moveLike(page, pointer, { x: 1150, y: 260 })
  await shot("…and lands in the audit log", async () => {
    await pause(page, 900)
    const row = page.locator("table tbody tr").first()
    await row.getByText("Sessions ended").waitFor()
    const box = await row.boundingBox()
    if (!box) throw new Error("the newest audit row has no box")
    await video(page, `__video.zoom(1.5, ${Math.round(box.x)}, ${Math.round(box.y)}, ${Math.round(box.x)}, 300)`)
    await pause(page, 2600)
    await video(page, `__video.unzoom()`)
    await pause(page, 900)
  })

  // 7. Groups, then one group's members.
  await clickLike(page, pointer, page.getByRole("link", { name: "Groups" }), H)
  await page.getByRole("heading", { level: 1, name: "Groups" }).waitFor()
  await shot("Every group, its owner and its members", async () => {
    await pause(page, 500)
    await press(page.getByRole("link", { name: "Product team" }))
    await cut(async () => {
      await page.mouse.up()
      await page.getByRole("heading", { level: 1, name: "Product team" }).waitFor()
    })
    await pause(page, 2400)
  })

  // 9. Newsletter.
  await clickLike(page, pointer, page.getByRole("link", { name: "Newsletter" }), H)
  await page.getByRole("heading", { level: 1, name: "Newsletter" }).waitFor()
  await shot("Your newsletter's subscribers and sends", async () => {
    await pause(page, 400)
    await moveLike(page, pointer, { x: 700, y: 420 })
    await pause(page, 2400)
  })

  // 10. System. No job failed in the seed, so no retry is shown and the caption says less.
  await clickLike(page, pointer, page.getByRole("link", { name: "System" }), H)
  await page.getByRole("heading", { level: 1, name: "System" }).waitFor()
  await shot("Health and background jobs", async () => {
    await pause(page, 400)
    await moveLike(page, pointer, { x: 640, y: 300 })
    await pause(page, 2400)
  })

  // 11. The same screen switches to light, from the operator's account menu.
  await shot("Light and dark", async () => {
    await pause(page, 300)
    await clickInPlace(page, pointer, page.locator(ACCOUNT_MENU))
    await pause(page, 500)
    await clickInPlace(page, pointer, page.getByRole("menuitemradio", { name: "Light" }))
    await moveLike(page, pointer, { x: 640, y: 300 })
    await pause(page, 2000)
  })

  // 12. End card.
  await video(page, `__video.card(${
    JSON.stringify({ title: "Free and MIT-licensed. The code is on GitHub." })
  })`)
  await shot(null, () => pause(page, 3000))

  return poster
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

/** Encodes `list` with the quality settings tried in order, until the file fits its budget. */
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
  for (const quality of qualities) {
    await ffmpeg([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-vf",
      filters,
      // Ends the video where the recording ended, not after the list's closing repeat.
      "-t",
      seconds.toFixed(3),
      "-an",
      ...codec(quality),
      out,
    ])
    const { size } = await Deno.stat(out)
    if (size <= budget) return size
  }
  throw new Error(`${out} stays above its budget of ${budget} bytes`)
}

/** The poster: one frame of the recording, at the delivered size, as WebP within its budget. */
async function encodePoster(frame: string, out: string): Promise<number> {
  for (const quality of [82, 74, 66, 58]) {
    await ffmpeg([
      "-i",
      frame,
      "-vf",
      `scale=${POSTER.width}:${POSTER.height}:flags=lanczos`,
      "-c:v",
      "libwebp",
      "-quality",
      String(quality),
      out,
    ])
    const { size } = await Deno.stat(out)
    if (size <= BUDGET.poster) return size
  }
  throw new Error(`${out} stays above its budget of ${BUDGET.poster} bytes`)
}

const browser = await chromium.launch({ executablePath: Deno.env.get("CHROME_PATH") || undefined })
const frames = await Deno.makeTempDir({ prefix: "admin-video-" })
try {
  await signInDemoDevices(browser)
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
    const posterFrame = await play(page, rec)
    await rec.stop()

    await Deno.mkdir(OUT_DIR, { recursive: true })
    const list = `${frames}/list.txt`
    await Deno.writeTextFile(list, concatList(rec.segments))
    const seconds = rec.segments.reduce((sum, s) => sum + s.end - s.frames[0].at, 0)
    const webm = await encode(list, `${OUT_DIR}admin-panel.webm`, BUDGET.webm, (crf) => [
      "-c:v",
      "libsvtav1",
      "-preset",
      "4",
      "-crf",
      String(crf),
      "-g",
      "300",
    ], [36, 42, 48], seconds)
    const mp4 = await encode(list, `${OUT_DIR}admin-panel.mp4`, BUDGET.mp4, (crf) => [
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
      "-movflags",
      "+faststart",
    ], [24, 28, 32], seconds)
    const poster = await encodePoster(posterFrame, `${OUT_DIR}admin-panel-poster-${POSTER.width}.webp`)
    console.log(
      `admin-panel: ${seconds.toFixed(1)} s, webm ${webm} B, mp4 ${mp4} B, poster ${poster} B`,
    )
  } finally {
    await context.close()
  }
} finally {
  await browser.close()
  await Deno.remove(frames, { recursive: true })
}
