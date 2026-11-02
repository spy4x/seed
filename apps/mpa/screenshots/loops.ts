// Seed's own site: see docs/start-a-product.md
/**
 * Records the website's three silent feature loops from the real SPA: realtime sync, offline
 * editing and the keyboard shortcuts, each in light and dark (`loops.ts` beside the routes names
 * them).
 *
 * `deno task loops` in `apps/mpa`; README.md beside this file says what it needs. It seeds the same
 * four people and notes as `capture.ts`, plays each loop at 720×450 CSS px and device scale 2 with
 * a drawn pointer moved at a person's pace, and records Chromium's screencast. Each clip ends with a
 * fade into its own first frame, so it loops without a jump. It writes an AV1 WebM and an H.264 MP4
 * of every clip into `media/video/` and the first frame, at 720 and 1440 px, as the WebP poster
 * into `static/video/`. The four accounts are deleted again whether or not the run succeeded.
 */
import { type Browser, type BrowserContext, chromium, type Page } from "playwright"
import { gotoApp } from "../../../e2e/fixtures/app.ts"
import { clickLike, type Point } from "../../../media/demo/recipe/human-mouse.ts"
import { concatList, Recorder } from "../../../docs/screenshots/screencast.ts"
import { APP, cleanupPeople, NOTES, saveTitle, seed, type Seeded } from "./capture.ts"
import { LOOP_NAMES, LOOP_SIZE, type LoopName } from "../loops.ts"

type Theme = "light" | "dark"

const MPA = new URL("..", import.meta.url).pathname
const VIDEO_DIR = `${MPA}media/video`
const POSTER_DIR = `${MPA}static/video`
const POINTER = new URL("../../../media/demo/recipe/pointer.js", import.meta.url).pathname
const KEYS = new URL("../../../media/demo/recipe/keys.js", import.meta.url).pathname
const FPS = 15
/** Each file's ceiling in bytes; the encoder steps its quality down until a file fits. */
const BUDGET = { video: 600_000, poster: { 720: 40_000, 1440: 90_000 } }
/** How long the closing fade into the first frame lasts, and how long that frame then holds. */
const FADE = 0.5
const HOLD = 0.2

/** One recorded clip: one concat list per window, laid side by side, and its length in seconds. */
interface Take {
  lists: string[]
  seconds: number
}

/** A recording window: its page, its screencast and where its pointer is. */
interface Window {
  page: Page
  rec: Recorder
  pointer: Point
}

/**
 * Opens a recording window signed in as Ada, `width` CSS px wide, its screencast ready. The pointer
 * starts at `start`, a spot off the text the clip is about.
 */
async function openWindow(
  browser: Browser,
  contexts: BrowserContext[],
  seeded: Seeded,
  theme: Theme,
  width: number,
  frames: string,
  start: Point,
): Promise<Window> {
  const viewport = { width, height: LOOP_SIZE.height }
  const context = await browser.newContext({
    baseURL: APP,
    storageState: seeded.appState,
    colorScheme: theme,
    viewport,
    deviceScaleFactor: 2,
    locale: "en-GB",
    timezoneId: "Europe/London",
  })
  contexts.push(context)
  await context.addInitScript(
    `globalThis.__demoPointerOptions = ${JSON.stringify({ ...start, mark: 40 })}`,
  )
  await context.addInitScript({ path: POINTER })
  await context.addInitScript({ path: KEYS })
  const page = await context.newPage()
  const dir = `${frames}/${contexts.length}`
  await Deno.mkdir(dir, { recursive: true })
  const rec = new Recorder(await context.newCDPSession(page), dir, viewport)
  return { page, rec, pointer: { ...start } }
}

/** Starts the screencasts, lets the first frames arrive, then begins one shot in every window. */
async function begin(windows: Window[]): Promise<void> {
  for (const { rec } of windows) await rec.start()
  await windows[0].page.waitForTimeout(500)
  for (const { rec } of windows) await rec.begin()
}

/** Ends the shot in every window, stops the screencasts and writes each window's concat list. */
async function finish(windows: Window[], frames: string): Promise<Take> {
  const lists: string[] = []
  let seconds = Infinity
  for (const [index, { rec }] of windows.entries()) {
    rec.end()
    await rec.stop()
    const list = `${frames}/list-${index}.txt`
    await Deno.writeTextFile(list, concatList(rec.segments, FPS))
    seconds = Math.min(seconds, rec.segments.reduce((sum, s) => sum + s.end - s.frames[0].at, 0))
    lists.push(list)
  }
  return { lists, seconds }
}

/** Two windows of one account: a title saved on the left shows up in the right window's list. */
async function realtime(
  browser: Browser,
  contexts: BrowserContext[],
  seeded: Seeded,
  theme: Theme,
  frames: string,
): Promise<Take> {
  const noteId = seeded.noteIds[5]
  const half = LOOP_SIZE.width / 2
  const left = await openWindow(browser, contexts, seeded, theme, half, frames, { x: 250, y: 330 })
  const right = await openWindow(browser, contexts, seeded, theme, half, frames, { x: 0, y: 0 })
  try {
    await gotoApp(left.page, `/notes/${noteId}`, left.page.locator("[data-e2e=note-title]"))
    await gotoApp(right.page, "/notes", right.page.locator("[data-e2e=note-item-title]").first())
    for (const { page } of [left, right]) {
      await page.locator("[data-e2e=shell-ws-status]", { hasText: "Online" }).waitFor()
    }
    // One pointer: the right window only watches.
    await right.page.evaluate(() => {
      ;(globalThis as unknown as { __demoPointerVisible(v: boolean): void }).__demoPointerVisible(
        false,
      )
    })
    const windows = [left, right]
    await begin(windows)
    const { page, pointer } = left
    const field = page.locator("[data-e2e=note-title]")
    await clickLike(page, pointer, field, { scroll: false })
    // The title wraps in a half-width window: Ctrl+End reaches its end, where End stops at a line.
    await page.keyboard.press("Control+End")
    await page.keyboard.type(", invoices", { delay: 80 })
    // Save sits below the fold of the half window: the pointer scrolls to it like a person.
    await clickLike(page, pointer, page.locator("[data-e2e=note-save]"))
    await right.page.locator("[data-e2e=note-item-title]", { hasText: "invoices" }).waitFor()
    await page.waitForTimeout(1400)
    return await finish(windows, frames)
  } finally {
    await saveTitle(seeded.ada, seeded, noteId, NOTES[5].title)
  }
}

/** Offline, Ada edits a note Grace changes meanwhile; on reconnect Ada keeps her version. */
async function offline(
  browser: Browser,
  contexts: BrowserContext[],
  seeded: Seeded,
  theme: Theme,
  frames: string,
): Promise<Take> {
  const noteId = seeded.noteIds[2]
  const window = await openWindow(browser, contexts, seeded, theme, LOOP_SIZE.width, frames, {
    x: 560,
    y: 330,
  })
  const { page, rec, pointer } = window
  try {
    await gotoApp(page, `/notes/${noteId}`, page.locator("[data-e2e=note-title]"))
    await page.locator("[data-e2e=shell-ws-status]", { hasText: "Online" }).waitFor()
    await begin([window])
    await page.waitForTimeout(300)
    await page.context().setOffline(true)
    // The socket's own status takes seconds to notice; the app's offline banner shows at once.
    await page.waitForTimeout(700)
    await clickLike(page, pointer, page.locator("[data-e2e=note-title]"), { scroll: false })
    await page.keyboard.press("Control+End")
    await page.keyboard.type(" (fixed)", { delay: 80 })
    await clickLike(page, pointer, page.locator("[data-e2e=note-save]"))
    await page.waitForTimeout(300)
    // Grace's save and the wait for the reconnect are cut: the clip goes straight to the chooser.
    rec.end()
    await saveTitle(seeded.grace, seeded, noteId, "Checkout fails for EU VAT numbers with spaces")
    await page.context().setOffline(false)
    const keep = page.getByRole("button", { name: /keep mine/i }).first()
    await keep.waitFor({ timeout: 30_000 })
    const saved = page.locator("[data-e2e=note-saved]")
    if (await saved.isVisible()) await saved.getByRole("button").click()
    await saved.waitFor({ state: "detached" })
    await page.waitForTimeout(300)
    await rec.begin()
    await page.waitForTimeout(400)
    await clickLike(page, pointer, keep)
    await keep.waitFor({ state: "detached" })
    await page.waitForTimeout(900)
    return await finish([window], frames)
  } finally {
    await page.context().setOffline(false)
    await saveTitle(seeded.ada, seeded, noteId, NOTES[2].title)
  }
}

/** Ctrl+K, then three searches that each find "Open profile": a typo, Cyrillic, the wrong layout. */
async function shortcuts(
  browser: Browser,
  contexts: BrowserContext[],
  seeded: Seeded,
  theme: Theme,
  frames: string,
): Promise<Take> {
  const window = await openWindow(browser, contexts, seeded, theme, LOOP_SIZE.width, frames, {
    x: 400,
    y: 70,
  })
  const { page, pointer } = window
  await gotoApp(page, "/notes", page.locator("[data-e2e=note-item-title]").first())
  await begin([window])
  await page.waitForTimeout(500)
  await page.keyboard.press("Control+k")
  const palette = page.locator("[data-e2e=search]")
  const field = palette.getByRole("combobox")
  await field.waitFor()
  const action = palette.getByRole("option").filter({ hasText: "Open profile" })
  for (const [index, query] of ["proflie", "профиль", "зкщашду"].entries()) {
    if (index) await page.keyboard.press("Control+a")
    await page.keyboard.type(query, { delay: 85 })
    await action.waitFor()
    await page.waitForTimeout(650)
  }
  await clickLike(page, pointer, action, { scroll: false })
  await page.waitForURL(/\/profile/)
  await page.waitForTimeout(1200)
  return await finish([window], frames)
}

const CHOREOGRAPHY: Record<
  LoopName,
  (b: Browser, c: BrowserContext[], s: Seeded, t: Theme, f: string) => Promise<Take>
> = { realtime, offline, shortcuts }

/** Runs ffmpeg and throws with its error output when it fails. */
async function ffmpeg(args: string[]): Promise<void> {
  const { success, stderr } = await new Deno.Command("ffmpeg", {
    args: ["-hide_banner", "-loglevel", "error", "-y", ...args],
    stdout: "null",
  }).output()
  if (!success) throw new Error(`ffmpeg ${args.join(" ")}: ${new TextDecoder().decode(stderr)}`)
}

/**
 * The filter graph of a take: its windows side by side, ending in a fade into the first frame,
 * which then holds for `HOLD`, so the clip's first and last frames are the same picture.
 */
function loopFilter(take: Take, firsts: string[]): { inputs: string[]; graph: string } {
  const count = take.lists.length
  const inputs = [
    ...take.lists.flatMap((list) => ["-f", "concat", "-safe", "0", "-i", list]),
    ...firsts.flatMap((file) => ["-loop", "1", "-t", String(FADE + HOLD + 0.2), "-i", file]),
  ]
  const still = FADE + HOLD
  // The screencast's JPEGs are full range; video players expect the limited range.
  const lane = (index: number, length: number) =>
    `[${index}:v]` + [
      `fps=${FPS}`,
      `trim=duration=${length.toFixed(3)}`,
      `setpts=PTS-STARTPTS`,
      `scale=in_range=pc:out_range=tv`,
      `format=yuv420p`,
    ].join(",")
  const parts = [
    ...take.lists.map((_, i) => `${lane(i, take.seconds)}[m${i}]`),
    ...firsts.map((_, i) => `${lane(count + i, still)}[s${i}]`),
  ]
  const join = (prefix: string, out: string) =>
    count === 1
      ? `[${prefix}0]null[${out}]`
      : `${take.lists.map((_, i) => `[${prefix}${i}]`).join("")}hstack=inputs=${count}[${out}]`
  parts.push(join("m", "main"), join("s", "still"))
  parts.push(
    `[main][still]xfade=transition=fade:duration=${FADE}:offset=${
      (take.seconds - FADE).toFixed(3)
    },format=yuv420p[out]`,
  )
  return { inputs, graph: parts.join(";") }
}

/** Encodes a take with one codec, stepping the quality down until the file fits the budget. */
async function encode(
  take: Take,
  firsts: string[],
  out: string,
  codec: (quality: number) => string[],
  qualities: number[],
): Promise<number> {
  const { inputs, graph } = loopFilter(take, firsts)
  for (const quality of qualities) {
    await ffmpeg([
      ...inputs,
      "-filter_complex",
      graph,
      "-map",
      "[out]",
      "-an",
      "-r",
      String(FPS),
      ...codec(quality),
      out,
    ])
    const { size } = await Deno.stat(out)
    if (size <= BUDGET.video) return size
  }
  throw new Error(`${out} stays above its budget of ${BUDGET.video} bytes`)
}

/** Writes the clip's first frame as the WebP poster at both widths, within each width's budget. */
async function posters(take: Take, firsts: string[], name: string): Promise<void> {
  const frame = `${take.lists[0]}.png`
  const { inputs, graph } = loopFilter(take, firsts)
  await ffmpeg([...inputs, "-filter_complex", graph, "-map", "[out]", "-frames:v", "1", frame])
  for (const width of [720, 1440] as const) {
    const out = `${POSTER_DIR}/${name}-${width}.webp`
    for (let quality = 82;; quality -= 6) {
      const { success, stderr } = await new Deno.Command("cwebp", {
        args: ["-quiet", "-q", String(quality), "-resize", String(width), "0", frame, "-o", out],
      }).output()
      if (!success) throw new Error(`cwebp ${out}: ${new TextDecoder().decode(stderr)}`)
      if ((await Deno.stat(out)).size <= BUDGET.poster[width]) break
      if (quality <= 40) throw new Error(`${out} stays above ${BUDGET.poster[width]} bytes`)
    }
  }
}

/** Records one loop in one theme and writes its two videos and two posters. */
async function record(
  browser: Browser,
  seeded: Seeded,
  loop: LoopName,
  theme: Theme,
): Promise<void> {
  const frames = await Deno.makeTempDir({ prefix: `loop-${loop}-${theme}-` })
  const contexts: BrowserContext[] = []
  try {
    const take = await CHOREOGRAPHY[loop](browser, contexts, seeded, theme, frames)
    const firsts = take.lists.map((list) => Deno.readTextFileSync(list).match(/^file '(.+)'$/m)![1])
    const name = `${loop}-loop-${theme}`
    const webm = await encode(take, firsts, `${VIDEO_DIR}/${name}.webm`, (crf) => [
      ...["-c:v", "libsvtav1", "-preset", "5", "-crf", String(crf), "-g", "150"],
      ...["-svtav1-params", "tune=0", "-pix_fmt", "yuv420p"],
    ], [30, 34, 38, 42, 46])
    const mp4 = await encode(take, firsts, `${VIDEO_DIR}/${name}.mp4`, (crf) => [
      ...["-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-profile:v", "high"],
      ...["-level", "4.0", "-pix_fmt", "yuv420p", "-movflags", "+faststart"],
    ], [22, 25, 28, 31, 34])
    await posters(take, firsts, name)
    console.log(`${name}: ${take.seconds.toFixed(1)} s, webm ${webm} B, mp4 ${mp4} B`)
  } finally {
    for (const context of contexts) await context.close().catch(() => {})
    await Deno.remove(frames, { recursive: true })
  }
}

async function main(): Promise<void> {
  const only = Deno.args.filter((arg) => (LOOP_NAMES as readonly string[]).includes(arg))
  const loops = only.length ? only as LoopName[] : LOOP_NAMES
  for (const dir of [VIDEO_DIR, POSTER_DIR]) await Deno.mkdir(dir, { recursive: true })
  // The screencast sends frames at the CSS size unless the browser itself runs at scale 2.
  const browser = await chromium.launch({ args: ["--force-device-scale-factor=2"] })
  const contexts: BrowserContext[] = []
  try {
    const adaContext = await browser.newContext({ baseURL: APP })
    contexts.push(adaContext)
    const ada = await adaContext.newPage()
    await cleanupPeople(ada)
    try {
      const seeded = await seed(browser, contexts, ada)
      for (const loop of loops) {
        for (const theme of ["light", "dark"] as const) await record(browser, seeded, loop, theme)
      }
    } finally {
      await cleanupPeople(ada)
    }
  } finally {
    for (const context of contexts) await context.close().catch(() => {})
    await browser.close()
  }
}

if (import.meta.main) await main()
