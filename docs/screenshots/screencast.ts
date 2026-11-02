/**
 * Records a page through Chromium's screencast, for the videos the recipes make: the admin panel
 * video (`admin-video.ts`) and the website's feature loops (`apps/mpa/screenshots/loops.ts`).
 * Each frame is a JPEG on disk with the moment it was painted; `concatList` plays the kept shots
 * back in real time through ffmpeg's concat demuxer.
 */
import type { CDPSession } from "playwright"

/** One screencast frame on disk and when it was painted, in seconds. */
export interface Frame {
  file: string
  at: number
}

/** One shot: its frames, and when it ended. */
export interface Segment {
  frames: Frame[]
  end: number
}

/**
 * Collects the screencast's frames. Frames arrive only when the page paints, so the newest one is
 * always kept: it is the first frame of the next shot, whatever happened since.
 */
export class Recorder {
  private latest: { data: string; at: number } | null = null
  private current: Frame[] | null = null
  private count = 0
  readonly segments: Segment[] = []

  /** `viewport` is the page's CSS size; frames come at twice it, the device pixels at 2×. */
  constructor(
    private readonly cdp: CDPSession,
    private readonly dir: string,
    private readonly viewport: { width: number; height: number },
  ) {}

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
      maxWidth: this.viewport.width * 2,
      maxHeight: this.viewport.height * 2,
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
 * The concat list that plays the shots back to back in real time: each frame lasts until the
 * next one was painted, and a shot's last frame until the shot ended. `fps` is the output's rate.
 */
export function concatList(segments: Segment[], fps: number): string {
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
  lines.push(`file '${last.file}'`, `duration ${(1 / fps).toFixed(4)}`)
  return lines.join("\n") + "\n"
}
