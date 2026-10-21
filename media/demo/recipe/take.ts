/// <reference lib="deno.ns" />
/**
 * The raw take of a demo video, recorded from Chrome's screencast: a sharp frame each time the
 * page paints, written to disk with the moment it was painted. A take is a list of shots; what
 * happens between two shots is cut. A shot can be played faster afterwards (a long wait), and
 * captions are marked while recording, at the moment their step starts, then written as WebVTT in
 * the finished video's time.
 *
 * Frames hold their place until the next one, so a busy machine that paints late slows nothing
 * down: the timing comes from the clock, not from a frame count. `sequence()` turns the shots into
 * one frame per slot of a 30 fps video.
 */
import type { CDPSession, Page } from "playwright"
import { CAPTION_TIMING, FPS } from "./encode.ts"

/** One frame on disk and when it was painted, in seconds. */
interface Frame {
  file: string
  at: number
}

/** One shot: its frames, when it started and ended, and how many times faster it plays. */
export interface Shot {
  screen: Screen
  frames: Frame[]
  start: number
  end: number
  speed: number
}

/** A caption, marked in a shot at the moment its step started. */
interface Mark {
  shot: number
  at: number
  text: string
}

/** One page being watched: the newest frame it painted. */
export class Screen {
  latest: { data: string; at: number } | null = null
  constructor(readonly page: Page, readonly cdp: CDPSession) {}
}

const now = () => performance.now() / 1000

/** Seconds a caption needs to be read, as the encoder checks it. */
export function readingSeconds(text: string): number {
  return Math.max(CAPTION_TIMING.minSeconds, text.length / CAPTION_TIMING.charsPerSecond)
}

/** `mm:ss.ttt`. */
function stamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(3).padStart(6, "0")}`
}

/** Records shots from one or more pages into `dir`. */
export class Take {
  readonly shots: Shot[] = []
  private readonly marks: Mark[] = []
  private current: Shot | null = null
  private count = 0

  constructor(private readonly dir: string) {}

  /** Starts the screencast of `page`. Its frames reach the take only inside a shot of it. */
  async watch(page: Page, size: { width: number; height: number }): Promise<Screen> {
    const cdp = await page.context().newCDPSession(page)
    const screen = new Screen(page, cdp)
    cdp.on("Page.screencastFrame", async ({ data, sessionId }) => {
      const at = now()
      screen.latest = { data, at }
      if (this.current?.screen === screen) this.current.frames.push(await this.write(data, at))
      await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {})
    })
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 90,
      maxWidth: size.width,
      maxHeight: size.height,
      everyNthFrame: 1,
    })
    return screen
  }

  private async write(data: string, at: number): Promise<Frame> {
    const file = `${this.dir}/${String(this.count++).padStart(6, "0")}.jpg`
    await Deno.writeFile(file, Uint8Array.from(atob(data), (c) => c.charCodeAt(0)))
    return { file, at }
  }

  /** Starts a shot of `screen` with what it shows now. */
  async begin(screen: Screen): Promise<void> {
    if (this.current) throw new Error("a shot is running already")
    // A page that has not painted since the screencast started sends its first frame soon.
    for (const deadline = now() + 10; !screen.latest; await sleep(50)) {
      if (now() > deadline) throw new Error("the screencast sent no frame within 10 s")
    }
    const at = now()
    this.current = {
      screen,
      frames: [await this.write(screen.latest!.data, at)],
      start: at,
      end: at,
      speed: 1,
    }
  }

  /** Ends the shot. What happens until the next `begin` is cut. */
  end(): Shot {
    const shot = this.current
    if (!shot) throw new Error("no shot is running")
    shot.end = now()
    this.shots.push(shot)
    this.current = null
    return shot
  }

  /** Ends the shot and starts the next one of the same screen at once: nothing is cut. */
  async split(): Promise<Shot> {
    const shot = this.end()
    await this.begin(shot.screen)
    return shot
  }

  /**
   * Runs `step` in a shot of its own that plays in at most `seconds`: a page that answers slowly
   * on a loaded machine (a load, a key press that lags) then keeps the pace a person would see.
   */
  async within<T>(seconds: number, step: () => Promise<T>): Promise<T> {
    await this.split()
    const result = await step()
    const shot = await this.split()
    const length = shot.end - shot.start
    if (length > seconds) shot.speed = length / seconds
    return result
  }

  /** Where `at`, a moment of shot `index`, falls in the take's own played time. */
  private played(index: number, at: number): number {
    const before = this.shots.slice(0, index).reduce((sum, s) => sum + (s.end - s.start) / s.speed, 0)
    const shot = this.shots[index] ?? this.current!
    return before + (at - shot.start) / shot.speed
  }

  /** The take's played time so far. */
  private elapsed(): number {
    return this.played(this.shots.length, now())
  }

  /**
   * Starts a caption now, in the running shot. First waits, on screen, until the caption before
   * has been up long enough to read, so the encoder never refuses one as too short.
   */
  async caption(text: string): Promise<void> {
    if (!this.current) throw new Error("a caption needs a running shot")
    await this.readPrevious()
    this.marks.push({ shot: this.shots.length, at: now(), text })
  }

  /** Waits in the running shot until the last caption has been up long enough to read. */
  async readPrevious(margin = 0.3): Promise<void> {
    const last = this.marks.at(-1)
    if (!last) return
    const shown = this.elapsed() - this.played(last.shot, last.at)
    const left = readingSeconds(this.expand(last)) + margin - shown
    if (left > 0) await sleep(left * 1000)
  }

  /**
   * The caption's text, with `{fast}` replaced by ", sped up N×" when a shot during the caption
   * plays faster (by the fastest one), or by nothing when none does.
   */
  private expand(mark: Mark): string {
    if (!mark.text.includes("{fast}")) return mark.text
    const index = this.marks.indexOf(mark)
    const next = this.marks[index + 1]
    const during = this.shots.slice(mark.shot, next ? next.shot + 1 : undefined)
    // Before its wait is over, a caption counts as sped up, the longer wording.
    const speed = next || !this.current
      ? Math.max(1, ...during.map((s) => s.speed))
      : 99
    return mark.text.replace("{fast}", speed >= 1.5 ? `, sped up ${Math.round(speed)}×` : "")
  }

  /** The played length of the whole take, in seconds. */
  seconds(): number {
    return this.shots.reduce((sum, s) => sum + (s.end - s.start) / s.speed, 0)
  }

  /**
   * The captions as WebVTT in the finished video's time: the take starts after a title card of
   * `offset` seconds, and each caption lasts until the next one, the last until the take ends.
   */
  vtt(offset: number): string {
    const starts = this.marks.map((m) => offset + this.played(m.shot, m.at))
    // The take video holds whole frames: end with its last one.
    const end = offset + Math.floor(this.seconds() * FPS) / FPS - 0.01
    const cues = this.marks.map((mark, i) =>
      `${stamp(starts[i])} --> ${stamp(starts[i + 1] ?? end)}\n${this.expand(mark)}`
    )
    return `WEBVTT\n\n${cues.join("\n\n")}\n`
  }

  /**
   * The frame each slot of a {@link FPS} video shows: the newest frame painted by then, with each
   * shot played back to back at its own speed. An ffmpeg concat list of single images would do the
   * same in theory, but the image demuxer's 1/25 s clock rounds short frames away and the take
   * comes out a third shorter than it ran.
   */
  sequence(): string[] {
    const painted: { t: number; file: string }[] = []
    let base = 0
    for (const shot of this.shots) {
      for (const frame of shot.frames) {
        painted.push({ t: base + (frame.at - shot.start) / shot.speed, file: frame.file })
      }
      base += (shot.end - shot.start) / shot.speed
    }
    const files: string[] = []
    for (let slot = 0, j = 0; slot < Math.floor(base * FPS); slot++) {
      while (j + 1 < painted.length && painted[j + 1].t <= slot / FPS) j++
      files.push(painted[j].file)
    }
    return files
  }

  /** Stops every screencast this take started. */
  async stop(screens: Screen[]): Promise<void> {
    for (const screen of screens) await screen.cdp.send("Page.stopScreencast").catch(() => {})
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
