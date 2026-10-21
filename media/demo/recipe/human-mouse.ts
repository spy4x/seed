// Drives the real Playwright mouse the way a person would, for a recorded demo. `playwright` is a
// bare specifier: map it in the project (`deno add npm:playwright@<version>`, then `deno install`)
// so this file and the recipe share one copy of it.
import type { Locator, Page } from "playwright"

/** Where the pointer is. The functions below move it and update it in place. */
export interface Point {
  x: number
  y: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const ease = (t: number) => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2

/**
 * Moves the real mouse from `from` to `to` along a slightly curved, ease-in-out path: one step
 * about every 12 ms, over 400–700 ms by distance. Timed by the clock, so the pace is the same on a
 * slow machine. `page.mouse.move(x, y, { steps })` sends every step at once and looks like a jump.
 */
export async function moveLike(page: Page, from: Point, to: Point): Promise<void> {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.hypot(dx, dy)
  const duration = Math.min(700, Math.max(400, dist * 0.8))
  const bow = Math.min(40, dist * 0.08)
  const nx = dist ? -dy / dist : 0
  const ny = dist ? dx / dist : 0
  const t0 = Date.now()
  while (true) {
    const t = Math.min(1, (Date.now() - t0) / duration)
    const e = ease(t)
    const arc = Math.sin(Math.PI * t) * bow
    await page.mouse.move(from.x + dx * e + nx * arc, from.y + dy * e + ny * arc)
    if (t === 1) break
    await sleep(12)
  }
  from.x = to.x
  from.y = to.y
}

/**
 * Scrolls by `deltaY` pixels with the mouse wheel, in small steps, like a hand on a wheel. It
 * scrolls whatever is under the pointer, so it also works in an app whose panes scroll and whose
 * window does not, where `scrollBy` does nothing.
 */
export async function scrollLike(page: Page, deltaY: number): Promise<void> {
  for (let left = deltaY; left !== 0;) {
    const step = Math.sign(left) * Math.min(40, Math.abs(left))
    await page.mouse.wheel(0, step)
    left -= step
    await sleep(16)
  }
  await sleep(300)
}

/** Options of `clickLike` and `typeLike`. */
export interface ClickOptions {
  /** `false` keeps the page still, for a target in a sticky header. Default `true`. */
  scroll?: boolean
}

/**
 * Brings `target` towards the middle if it sits near an edge, glides the pointer to its centre and
 * clicks like a person: pause, press, hold, release. The 200 ms hold lets the click mark reach full
 * size before a navigating click clears it.
 */
export async function clickLike(
  page: Page,
  pointer: Point,
  target: Locator,
  { scroll = true }: ClickOptions = {},
): Promise<void> {
  await target.waitFor()
  const height = page.viewportSize()?.height ?? 800
  const box = async () => {
    const found = await target.boundingBox()
    if (!found) throw new Error(`click target has no box`)
    return found
  }
  let found = await box()
  const offScreen = () => found.y < 96 || found.y + found.height > height - 132
  if (scroll && offScreen()) {
    await scrollLike(page, Math.round(found.y + found.height / 2 - height / 2))
    found = await box()
    if (offScreen()) {
      await target.scrollIntoViewIfNeeded()
      found = await box()
    }
  }
  await moveLike(page, pointer, {
    x: Math.round(found.x + found.width / 2),
    y: Math.round(found.y + found.height / 2),
  })
  await page.waitForTimeout(150)
  await page.mouse.down()
  await page.waitForTimeout(200)
  await page.mouse.up()
  await page.waitForTimeout(200)
}

/** Clicks a field like a person, then types at a readable pace (`delay` ms a key, default 70). */
export async function typeLike(
  page: Page,
  pointer: Point,
  field: Locator,
  text: string,
  { delay = 70, ...options }: ClickOptions & { delay?: number } = {},
): Promise<void> {
  await clickLike(page, pointer, field, options)
  await page.keyboard.type(text, { delay })
}

/**
 * Glides the pointer off the content after a click, to `spot` (default: near the right edge,
 * above the caption band), so it does not sit on what the next caption talks about. Park it the
 * same way before a frame used as the poster.
 */
export async function parkLike(page: Page, pointer: Point, spot?: Point): Promise<void> {
  const size = page.viewportSize() ?? { width: 1280, height: 800 }
  await moveLike(page, pointer, spot ?? { x: size.width - 48, y: size.height - 160 })
}
