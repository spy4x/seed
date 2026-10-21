/// <reference lib="deno.ns" />
/**
 * Turns a raw take into a project's demo video: `demo.webm` (VP9 + Opus), `demo.mp4` (H.264 + AAC,
 * faststart), `poster.webp` and `poster-640.webp`, all in `out` (normally `media/demo/`).
 *
 * It adds the title card and the end card, burns in the captions from `captions.vtt`, lays the
 * music from `music.opus` under the whole video (trimmed, faded in over 1 s and out over 2 s, and
 * set to about -28 LUFS), and refuses to write a mix louder than -27 LUFS or above -1 dBTP. It
 * also refuses captions that a viewer cannot read in time, before it encodes anything.
 *
 * The take is a video file (a vhs or Playwright recording) or an ffmpeg concat list (`.txt`) of
 * screencast frames with their durations. The take carries no captions or cards of its own, so a
 * caption or music change re-encodes the last take without recording again.
 *
 * Usage from a recipe (needs ffmpeg with libvpx-vp9, libx264, libopus, libwebp and drawtext):
 *
 * ```ts
 * import { encodeDemo } from "./encode.ts"
 * await encodeDemo({
 *   take: `/tmp/take/demo-raw.mp4`,
 *   out: `media/demo`,
 *   title: `oko`,
 *   claim: `One page for every service, with its uptime`,
 *   end: `github.com/spy4x/oko`,
 * })
 * ```
 */
import { runCommand } from "@spy4x/platform/server/run-command"
import { denoFileSystem as fs } from "@spy4x/platform/server/deno-fs"

/** One caption: when it shows, in seconds of the finished video, and its line. */
export interface Cue {
  start: number
  end: number
  text: string
}

/** What EBU R 128 measures over a file's sound. */
export interface Loudness {
  /** Integrated loudness, LUFS. */
  integrated: number
  /** True peak, dBTP. */
  peak: number
}

/** What `encodeDemo` needs. Paths are relative to the working directory or absolute. */
export interface EncodeOptions {
  /** The raw take: a video file, or a `.txt` ffmpeg concat list of frames. */
  take: string
  /** Where the four outputs go; it also holds `captions.vtt` and `music.opus`. */
  out: string
  /** The title card: the project's name. */
  title: string
  /** The title card's second line: the one-line claim from the README. */
  claim: string
  /** The end card: the repository URL. */
  end: string
  /** Seconds cut from the take's start: a blank start, or Playwright's start lag. */
  trim?: number
  /** The poster: seconds into the take (after `trim`), or an image file. Default 0. */
  poster?: number | string
  /** Default `<out>/captions.vtt`. */
  captions?: string
  /** Default `<out>/music.opus`. */
  music?: string
  /** Default 1280x800. */
  size?: { width: number; height: number }
  /** A font file for the captions and cards. Default: fontconfig's semibold sans-serif. */
  font?: string
}

/** What one run produced. */
export interface EncodeSummary {
  seconds: number
  bytes: { webm: number; mp4: number }
  loudness: { webm: Loudness; mp4: Loudness }
}

export const FPS = 30
/** Seconds the title card and the end card stay on screen. */
export const CARD_SECONDS = { title: 2, end: 2 }
/** The loudness the music is set to, and the loudest mix the encoder writes. */
export const LOUDNESS = { target: -28, maxIntegrated: -27, maxPeak: -1 }
/** A caption shows at least this long, and long enough to read at this many characters a second. */
export const CAPTION_TIMING = { minSeconds: 2.5, charsPerSecond: 15 }
/** Longer captions do not fit one line at 1280 px; split them into two steps. */
export const CAPTION_MAX_CHARS = 64

const INK = `0x111318`
const BUDGET_BYTES_PER_45_SECONDS = 3_000_000

/** Reads a WebVTT file's cues. A cue's lines are joined with a space. */
export function parseVtt(text: string): Cue[] {
  const blocks = text.replace(/\r/g, ``).split(/\n{2,}/).map((block) => block.trim())
  if (!blocks[0]?.startsWith(`WEBVTT`)) throw new Error(`captions: the file must start with WEBVTT`)
  const cues: Cue[] = []
  for (const block of blocks.slice(1)) {
    if (!block || block.startsWith(`NOTE`)) continue
    const lines = block.split(`\n`)
    const at = lines.findIndex((line) => line.includes(`-->`))
    if (at === -1) throw new Error(`captions: a cue without a time line: ${block}`)
    const [start, end] = lines[at].split(`-->`).map((part) => seconds(part.trim().split(/\s/)[0]))
    cues.push({ start, end, text: lines.slice(at + 1).join(` `).trim() })
  }
  return cues
}

/** `hh:mm:ss.ttt` or `mm:ss.ttt` in seconds. */
function seconds(stamp: string): number {
  const parts = stamp.split(`:`).map(Number)
  if (parts.length < 2 || parts.some((part) => Number.isNaN(part))) {
    throw new Error(`captions: not a time: ${stamp}`)
  }
  return parts.reduce((total, part) => total * 60 + part, 0)
}

/**
 * Everything wrong with the captions of a video whose take runs from `from` to `to` (seconds of
 * the finished video, between the cards): too short to read, too long for one line, overlapping,
 * or over a card. Empty when they are fine.
 */
export function captionProblems(cues: Cue[], from: number, to: number): string[] {
  const problems: string[] = []
  if (cues.length === 0) problems.push(`there are no captions`)
  cues.forEach((cue, index) => {
    const name = `caption ${index + 1} ("${cue.text}")`
    const needs = Math.max(
      CAPTION_TIMING.minSeconds,
      cue.text.length / CAPTION_TIMING.charsPerSecond,
    )
    if (!cue.text) problems.push(`caption ${index + 1} is empty`)
    if (cue.end - cue.start < needs - 0.001) {
      problems.push(`${name} shows ${(cue.end - cue.start).toFixed(2)} s; it needs ${needs} s`)
    }
    if (cue.text.length > CAPTION_MAX_CHARS) {
      problems.push(`${name} has ${cue.text.length} characters; at most ${CAPTION_MAX_CHARS} fit`)
    }
    if (cue.start < from - 0.001 || cue.end > to + 0.001) {
      problems.push(`${name} runs over a card: keep it between ${from} s and ${to.toFixed(2)} s`)
    }
    const previous = cues[index - 1]
    if (previous && cue.start < previous.end - 0.001) {
      problems.push(`${name} overlaps the one before`)
    }
  })
  return problems
}

/** Why a mix is too loud to publish; empty when it is quiet enough. */
export function loudnessProblems(sound: Loudness): string[] {
  const problems: string[] = []
  if (sound.integrated > LOUDNESS.maxIntegrated) {
    problems.push(`${sound.integrated} LUFS is louder than ${LOUDNESS.maxIntegrated} LUFS`)
  }
  if (sound.peak > LOUDNESS.maxPeak) {
    problems.push(`the true peak ${sound.peak} dBTP is above ${LOUDNESS.maxPeak} dBTP`)
  }
  return problems
}

/** The gain, in dB, that brings music measured at `sound` to the target, with 1 dB of headroom. */
export function musicGain(sound: Loudness): number {
  const gain = Math.min(LOUDNESS.target - sound.integrated, LOUDNESS.maxPeak - 1 - sound.peak)
  return Math.round(gain * 10) / 10
}

/** Encodes the take, cards, captions and music into the four outputs. See the module comment. */
export async function encodeDemo(options: EncodeOptions): Promise<EncodeSummary> {
  const { take, out, title, claim, end } = options
  const { width, height } = options.size ?? { width: 1280, height: 800 }
  const trim = options.trim ?? 0
  const font = options.font ?? (await run([`fc-match`, `-f`, `%{file}`, `sans-serif:semibold`]))
  const captions = options.captions ?? `${out}/captions.vtt`
  const music = options.music ?? `${out}/music.opus`
  const takeSeconds = (await duration(take)) - trim
  const total = CARD_SECONDS.title + takeSeconds + CARD_SECONDS.end
  const vtt = await fs.readText(captions)
  if (vtt === null) throw new Error(`${captions} is missing`)
  const cues = parseVtt(vtt)
  const problems = captionProblems(cues, CARD_SECONDS.title, CARD_SECONDS.title + takeSeconds)
  if (claim.length > CAPTION_MAX_CHARS) problems.push(`the claim is longer than one line`)
  if (problems.length) throw new Error(`captions:\n- ${problems.join(`\n- `)}`)
  if (await duration(music) < total) {
    throw new Error(`${music} is shorter than the video's ${total.toFixed(1)} s`)
  }

  const fade = `afade=t=in:d=1,afade=t=out:st=${(total - 2).toFixed(3)}:d=2`
  const music0 = `atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS,${fade}`
  const gain = musicGain(await loudness([`-i`, music, `-af`, music0]))

  await fs.mkdirp(out)
  const work = `${out}/.encode-work`
  await fs.mkdirp(work)
  const texts: string[] = []
  /** A drawtext filter for `text`, read from a file so no character needs escaping. */
  const text = async (line: string, style: string, enable?: string) => {
    const file = `${work}/${texts.length}.txt`
    texts.push(file)
    await fs.writeText(file, line)
    return `drawtext=fontfile=${quote(font)}:textfile=${quote(file)}:expansion=none:${style}` +
      (enable ? `:enable='${enable}'` : ``)
  }
  try {
    const scale = width / 1280
    const px = (n: number) => Math.round(n * scale)
    const band = px(84)
    const fit = `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos:` +
      `out_range=tv,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${INK},setsar=1,format=yuv420p`
    const card = (seconds: number) =>
      `color=c=${INK}:s=${width}x${height}:r=${FPS}:d=${seconds},setsar=1,format=yuv420p`
    const centred = `x=(w-text_w)/2`
    const titleCard = [
      card(CARD_SECONDS.title),
      await text(title, `fontsize=${px(60)}:fontcolor=0xf2f2f5:${centred}:y=h/2-lh-${px(14)}`),
      await text(claim, `fontsize=${px(30)}:fontcolor=0xa9adb8:${centred}:y=h/2+${px(14)}`),
    ].join(`,`)
    const endCard = [
      card(CARD_SECONDS.end),
      await text(end, `fontsize=${px(40)}:fontcolor=0xf2f2f5:${centred}:y=(h-lh)/2`),
    ].join(`,`)
    const burned: string[] = []
    for (const cue of cues) {
      const when = `gte(t,${cue.start})*lt(t,${cue.end})`
      burned.push(
        `drawbox=x=0:y=ih-${band}:w=iw:h=${band}:color=${INK}@0.75:t=fill:enable='${when}'`,
        await text(
          cue.text,
          `fontsize=${px(32)}:fontcolor=white:${centred}:y=h-${band}+(${band}-lh)/2`,
          when,
        ),
      )
    }
    const graph = [
      `${titleCard}[title]`,
      // setpts before fps: fps then holds each frame of a concat list for its listed duration.
      `[0:v]trim=start=${trim},setpts=PTS-STARTPTS,fps=${FPS},${fit}[take]`,
      `${endCard}[end]`,
      `[title][take][end]concat=n=3:v=1:a=0,${burned.join(`,`)}[v]`,
      `[1:a]${music0},volume=${gain}dB[a]`,
    ].join(`;`)
    const encode = (file: string, codec: string[]) =>
      run([
        `ffmpeg`,
        ...[`-y`, `-hide_banner`, `-loglevel`, `error`, `-threads`, `2`, ...input(take), `-i`, music],
        ...[`-filter_complex`, graph, `-map`, `[v]`, `-map`, `[a]`, `-t`, total.toFixed(3)],
        ...[`-map_metadata`, `-1`, ...codec, file],
      ])
    const budget = Math.max(1, total / 45) * BUDGET_BYTES_PER_45_SECONDS
    const bytes = { webm: 0, mp4: 0 }
    for (const crf of [36, 40, 44]) {
      await encode(`${out}/demo.webm`, [
        ...[`-threads`, `2`, `-c:v`, `libvpx-vp9`, `-b:v`, `0`, `-crf`, `${crf}`, `-row-mt`, `1`, `-deadline`],
        ...[`good`, `-cpu-used`, `2`, `-g`, `300`, `-c:a`, `libopus`, `-b:a`, `96k`],
      ])
      bytes.webm = await size(`${out}/demo.webm`)
      if (bytes.webm <= budget) break
    }
    for (const crf of [26, 29, 32]) {
      await encode(`${out}/demo.mp4`, [
        ...[`-threads`, `2`, `-c:v`, `libx264`, `-preset`, `slow`, `-crf`, `${crf}`, `-pix_fmt`, `yuv420p`],
        ...[`-g`, `300`, `-c:a`, `aac`, `-b:a`, `128k`, `-movflags`, `+faststart`],
      ])
      bytes.mp4 = await size(`${out}/demo.mp4`)
      if (bytes.mp4 <= budget) break
    }

    const sound = {
      webm: await loudness([`-i`, `${out}/demo.webm`]),
      mp4: await loudness([`-i`, `${out}/demo.mp4`]),
    }
    const loud = Object.entries(sound).flatMap(([file, measured]) =>
      loudnessProblems(measured).map((problem) => `demo.${file}: ${problem}`)
    )
    if (loud.length) {
      await fs.remove(`${out}/demo.webm`)
      await fs.remove(`${out}/demo.mp4`)
      throw new Error(`the mix is too loud, so both videos were deleted: ${loud.join(`; `)}`)
    }

    const still = typeof options.poster === `string`
      ? [`-i`, options.poster]
      : [...input(take), `-ss`, `${trim + (options.poster ?? 0)}`]
    await run([
      `ffmpeg`,
      ...[`-y`, `-hide_banner`, `-loglevel`, `error`, `-threads`, `2`, ...still, `-frames:v`, `1`, `-vf`, fit],
      ...[`-map_metadata`, `-1`, `-c:v`, `libwebp`, `-quality`, `82`, `${out}/poster.webp`],
    ])
    await run([
      `ffmpeg`,
      ...[`-y`, `-hide_banner`, `-loglevel`, `error`, `-threads`, `2`, `-i`, `${out}/poster.webp`],
      ...[`-vf`, `scale=640:-2:flags=lanczos`, `-c:v`, `libwebp`, `-quality`, `82`],
      `${out}/poster-640.webp`,
    ])

    const over = bytes.webm > budget || bytes.mp4 > budget ? ` (above the ${budget} B aim)` : ``
    console.log(
      `${out}: ${total.toFixed(1)} s, webm ${bytes.webm} B, mp4 ${bytes.mp4} B${over}, ` +
        `${sound.mp4.integrated} LUFS, true peak ${sound.mp4.peak} dBTP, music gain ${gain} dB`,
    )
    return { seconds: total, bytes, loudness: sound }
  } finally {
    for (const file of texts) await fs.remove(file)
    await fs.remove(work)
  }
}

/** The input arguments for a take: a concat list of frames, or a video file. */
function input(take: string): string[] {
  return take.endsWith(`.txt`) ? [`-f`, `concat`, `-safe`, `0`, `-i`, take] : [`-i`, take]
}

/** A path as a quoted filter option value. */
function quote(path: string): string {
  if (/['\\]/.test(path)) throw new Error(`a path with ' or \\ cannot go into a filter: ${path}`)
  return `'${path}'`
}

/** Runs a command and returns its standard output; throws with its error output when it fails. */
async function run(command: string[]): Promise<string> {
  const result = await runCommand(command, {})
  if (!result.success) {
    throw new Error(`${command[0]} failed: ${result.error ?? result.stderr.slice(-2000)}`)
  }
  return result.stdout.trim()
}

/** A media file's length in seconds, as ffprobe reads it. */
async function duration(file: string): Promise<number> {
  const out = await run([
    ...[`ffprobe`, `-v`, `error`, ...input(file).filter((arg) => arg !== `-i`)],
    ...[`-show_entries`, `format=duration`, `-of`, `csv=p=0`],
  ])
  const value = Number(out)
  if (!value) throw new Error(`ffprobe could not read the length of ${file}`)
  return value
}

/** A file's size in bytes, as ffprobe reads it. */
async function size(file: string): Promise<number> {
  return Number(
    await run([`ffprobe`, `-v`, `error`, ...[`-show_entries`, `format=size`], ...[
      `-of`,
      `csv=p=0`,
      file,
    ]]),
  )
}

/** The loudness of the sound that `args` (inputs and an optional `-af` chain) produce. */
async function loudness(args: string[]): Promise<Loudness> {
  const at = args.indexOf(`-af`)
  const chain = at === -1 ? [] : [args[at + 1]]
  const inputs = at === -1 ? args : args.slice(0, at)
  const result = await runCommand([
    ...[`ffmpeg`, `-hide_banner`, `-nostats`, `-threads`, `2`, ...inputs, `-map`, `0:a`],
    ...[`-af`, [...chain, `ebur128=peak=true`].join(`,`), `-f`, `null`, `-`],
  ], {})
  const summary = result.stderr.slice(result.stderr.lastIndexOf(`Summary:`))
  const integrated = summary.match(/I:\s+(-?[\d.]+) LUFS/)?.[1]
  const peak = summary.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1]
  if (!result.success || !integrated || !peak) {
    throw new Error(`ffmpeg could not measure the loudness: ${result.stderr.slice(-2000)}`)
  }
  return { integrated: Number(integrated), peak: Number(peak) }
}
