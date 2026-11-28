/**
 * The pure parts of `deno task video:cut` (docs/video.md): the command line, whisper.cpp's word
 * times, silence cuts, the edit list and its validation, Claude's reply, caption cues, ffmpeg's
 * filter graphs and loudness filters, the Kdenlive project and the packaging drafts. Nothing here
 * runs a process or touches a file; `video-cut.ts` does the I/O.
 */

/** A time range in seconds. */
export interface Range {
  start: number
  end: number
}

export interface Word extends Range {
  text: string
}

export interface Segment extends Range {
  n: number
  text: string
}

export type CutReason = `silence` | `filler` | `retake` | `off-topic`

export const CUT_REASONS: readonly CutReason[] = [`silence`, `filler`, `retake`, `off-topic`]

export interface Cut extends Range {
  reason: CutReason
  note?: string
}

export interface Chapter {
  start: number
  title: string
}

export interface Short extends Range {
  title: string
}

/**
 * What Claude returns: ranges to remove, chapter marks, the one Short, and optionally three title
 * options and a description for the packaging drafts.
 */
export interface EditList {
  cuts: Cut[]
  chapters: Chapter[]
  shorts: Short[]
  titles?: string[]
  description?: string
}

export const SHORT_MIN_SECONDS = 30
export const SHORT_MAX_SECONDS = 55
export const SHORT_COUNT = 1
export const TITLE_COUNT = 3
export const DEFAULT_MIN_SILENCE_SECONDS = 0.8
/** Quiet kept on each side of a cut silence, so speech does not start abruptly. */
const SILENCE_PAD_SECONDS = 0.2
/** More cuts than this would make an ffmpeg graph of thousands of branches; no edit needs it. */
export const MAX_CUTS = 2000
/** A whisper.cpp file above this is not a recording's transcript; parsing it would take GBs. */
export const MAX_WHISPER_CHARS = 64 * 1024 * 1024
/** An edit list for hours of video is a few hundred KB; anything larger is not one. */
export const MAX_REPLY_CHARS = 1024 * 1024
/**
 * The brief goes to `claude -p` as one argument, and Linux caps one argument at 128 KiB. About an
 * hour of talk fits.
 */
export const MAX_BRIEF_CHARS = 120_000
const EPSILON = 0.001

const ms = (seconds: number) => Math.round(seconds * 1000) / 1000

/** The parsed command line of `deno task video:cut`. */
export interface CutArgs {
  recording: string
  slug: string
  out?: string
  claude: boolean
  denoise: boolean
  minSilence: number
}

export const USAGE =
  `Usage: deno task video:cut <recording> <slug> [--out <dir>] [--no-claude] [--denoise] [--min-silence ${DEFAULT_MIN_SILENCE_SECONDS}]`

/** A slug names the cut's files and its Kdenlive project, so it may not point anywhere else. */
export function assertSlug(slug: string): void {
  if (slug === `` || /[\\/]/.test(slug) || slug.includes(`..`)) {
    throw new Error(`The slug "${slug}" must be one plain name: no "/", "\\" or "..".`)
  }
}

/** Reads the command line; throws with the usage line on anything it does not know. */
export function parseArgs(args: string[]): CutArgs {
  const positional: string[] = []
  const parsed: Omit<CutArgs, `recording` | `slug`> = {
    claude: true,
    denoise: false,
    minSilence: DEFAULT_MIN_SILENCE_SECONDS,
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === `--no-claude`) parsed.claude = false
    else if (arg === `--denoise`) parsed.denoise = true
    else if (arg === `--out`) {
      const value = args[++i]
      if (!value) throw new Error(`--out needs a directory.\n${USAGE}`)
      parsed.out = value
    } else if (arg === `--min-silence`) {
      const value = Number(args[++i])
      if (!(value >= 0.3)) {
        throw new Error(`--min-silence must be a number of at least 0.3 seconds.\n${USAGE}`)
      }
      parsed.minSilence = value
    } else if (arg.startsWith(`--`)) throw new Error(`Unknown option "${arg}".\n${USAGE}`)
    else positional.push(arg)
  }
  if (positional.length !== 2) throw new Error(USAGE)
  const [recording, slug] = positional
  assertSlug(slug)
  return { recording, slug, ...parsed }
}

/** What the cut needs to know about the recording. */
export interface MediaInfo {
  seconds: number
  width: number
  height: number
  fpsNum: number
  fpsDen: number
  hasAudio: boolean
}

/** Reads ffprobe's `-print_format json -show_format -show_streams` output. */
export function parseProbe(json: string, path: string): MediaInfo {
  let data: {
    format?: { duration?: string }
    streams?: { codec_type?: string; width?: number; height?: number; r_frame_rate?: string }[]
  }
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error(`ffprobe printed no JSON for "${path}".`)
  }
  const streams = data.streams ?? []
  const video = streams.find((s) => s.codec_type === `video`)
  if (!video) throw new Error(`"${path}" has no video stream.`)
  const seconds = Number(data.format?.duration)
  if (!(seconds > 0)) throw new Error(`ffprobe found no duration in "${path}".`)
  const [num, den] = (video.r_frame_rate ?? `25/1`).split(`/`).map(Number)
  return {
    seconds,
    width: video.width ?? 0,
    height: video.height ?? 0,
    fpsNum: num || 25,
    fpsDen: den || 1,
    hasAudio: streams.some((s) => s.codec_type === `audio`),
  }
}

interface WhisperToken {
  text?: string
  offsets?: { from?: number; to?: number }
}

interface WhisperSegment {
  text?: string
  offsets?: { from?: number; to?: number }
  tokens?: WhisperToken[]
}

/**
 * Reads whisper.cpp's `--output-json-full` file. Words come from the tokens (a token starting with
 * a space begins a word, one without it, such as a comma, continues the previous word); a segment
 * without tokens falls back to its words spread evenly over its time. The special `[_BEG_]` and
 * `[_TT_n]` tokens are ignored.
 */
export function parseWhisperJson(text: string): { words: Word[]; segments: Segment[] } {
  if (text.length > MAX_WHISPER_CHARS) {
    throw new Error(
      `The Whisper file is ${text.length} characters, over the ${MAX_WHISPER_CHARS} limit.`,
    )
  }
  let data: { transcription?: WhisperSegment[] }
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`The Whisper file is not valid JSON.`)
  }
  if (!Array.isArray(data?.transcription)) {
    throw new Error(
      `The Whisper file has no "transcription" list. Run whisper.cpp with --output-json-full.`,
    )
  }
  const words: Word[] = []
  const segments: Segment[] = []
  const seconds = (value: unknown) =>
    typeof value === `number` && isFinite(value) ? value / 1000 : 0
  for (const seg of data.transcription) {
    const from = seconds(seg?.offsets?.from)
    const to = seconds(seg?.offsets?.to)
    const segText = typeof seg?.text === `string` ? seg.text.trim() : ``
    if (segText) segments.push({ n: segments.length + 1, start: from, end: to, text: segText })
    const tokens = (Array.isArray(seg?.tokens) ? seg.tokens : []).filter((t) =>
      typeof t?.text === `string` && !/^\[_[^\]]*\]$/.test(t.text.trim()) && t.offsets
    )
    if (tokens.length > 0) {
      let current: Word | undefined
      for (const t of tokens) {
        const tStart = seconds(t.offsets!.from)
        const tEnd = Math.max(tStart, seconds(t.offsets!.to))
        const raw = t.text!
        if (!current || /^\s/.test(raw)) {
          if (current) words.push(current)
          if (raw.trim() === ``) {
            current = undefined
            continue
          }
          current = { start: tStart, end: tEnd, text: raw.trim() }
        } else {
          current.text += raw
          current.end = Math.max(current.end, tEnd)
        }
      }
      if (current) words.push(current)
    } else if (segText) {
      const parts = segText.split(/\s+/)
      const step = (to - from) / parts.length
      parts.forEach((p, i) =>
        words.push({ start: from + i * step, end: from + (i + 1) * step, text: p })
      )
    }
  }
  if (words.length === 0) throw new Error(`The Whisper file holds no words.`)
  return { words, segments }
}

/**
 * Silences longer than `minSilence` seconds between words (and before the first or after the last
 * word), as cuts that keep 0.2 s of quiet on each side. Decided from the word times alone, so it
 * is deterministic.
 */
export function silenceCuts(
  words: Word[],
  mediaSeconds: number,
  minSilence = DEFAULT_MIN_SILENCE_SECONDS,
): Cut[] {
  const cuts: Cut[] = []
  const add = (start: number, end: number) => {
    if (end - start > EPSILON) cuts.push({ start: ms(start), end: ms(end), reason: `silence` })
  }
  if (words[0].start > minSilence) add(0, words[0].start - SILENCE_PAD_SECONDS)
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - words[i - 1].end
    if (gap > minSilence) {
      add(words[i - 1].end + SILENCE_PAD_SECONDS, words[i].start - SILENCE_PAD_SECONDS)
    }
  }
  const last = words[words.length - 1]
  if (mediaSeconds - last.end > minSilence) add(last.end + SILENCE_PAD_SECONDS, mediaSeconds)
  return cuts
}

/** Sorted union of ranges; touching or overlapping ranges become one. */
export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges.map((r) => ({ start: r.start, end: r.end })).sort((a, b) =>
    a.start - b.start
  )
  const merged: Range[] = []
  for (const r of sorted) {
    const last = merged[merged.length - 1]
    if (last && r.start <= last.end + EPSILON) last.end = Math.max(last.end, r.end)
    else merged.push(r)
  }
  return merged
}

/** The parts of `[from, to]` that no cut removes, in order. */
export function keepRanges(cuts: Range[], from: number, to: number): Range[] {
  const keeps: Range[] = []
  let at = from
  for (const c of mergeRanges(cuts)) {
    if (c.end <= from || c.start >= to) continue
    if (c.start - at > EPSILON) keeps.push({ start: ms(at), end: ms(Math.min(c.start, to)) })
    at = Math.max(at, c.end)
  }
  if (to - at > EPSILON) keeps.push({ start: ms(at), end: ms(to) })
  return keeps
}

export function totalSeconds(ranges: Range[]): number {
  return ms(ranges.reduce((sum, r) => sum + (r.end - r.start), 0))
}

const fmtRange = (r: Range) => `${r.start}–${r.end} s`

/**
 * Checks an edit list against the media. Every problem is reported with the range it concerns
 * (`cuts[2] 41–39.5 s: ends before it starts`), all at once, so one pass fixes the file.
 * `autoCuts` are the silence cuts the renderer adds, which count towards the Short's length.
 */
export function validateEditList(
  raw: unknown,
  mediaSeconds: number,
  autoCuts: Range[] = [],
): EditList {
  const problems: string[] = []
  const obj = (raw && typeof raw === `object` ? raw : {}) as Record<string, unknown>
  const list = (key: string): unknown[] => {
    if (!Array.isArray(obj[key])) {
      problems.push(`"${key}" must be a list.`)
      return []
    }
    return obj[key] as unknown[]
  }
  const checkRange = (label: string, r: Record<string, unknown>): boolean => {
    const { start, end } = r
    if (
      typeof start !== `number` || typeof end !== `number` || !isFinite(start) || !isFinite(end)
    ) {
      problems.push(`${label}: start and end must be numbers (seconds).`)
      return false
    }
    const where = `${label} ${fmtRange({ start, end })}`
    if (start < 0 || end > mediaSeconds + EPSILON) {
      problems.push(`${where}: outside the media (0–${ms(mediaSeconds)} s).`)
      return false
    }
    if (end <= start) {
      problems.push(`${where}: ends before it starts.`)
      return false
    }
    return true
  }
  const checkOrder = (label: string, previous: Range | undefined, r: Range) => {
    if (previous && r.start < previous.end - EPSILON) {
      const kind = r.start < previous.start ? `out of order` : `overlaps`
      problems.push(
        `${label} ${fmtRange(r)}: ${kind} with the range before it (${fmtRange(previous)}).`,
      )
    }
  }
  const nonEmpty = (value: unknown) => typeof value === `string` && value.trim() !== ``

  const cuts: Cut[] = []
  const cutsRaw = list(`cuts`)
  if (cutsRaw.length > MAX_CUTS) {
    problems.push(`"cuts" holds ${cutsRaw.length} ranges, more than ${MAX_CUTS}.`)
  } else {
    cutsRaw.forEach((c, i) => {
      const r = (c ?? {}) as Record<string, unknown>
      const label = `cuts[${i}]`
      if (!CUT_REASONS.includes(r.reason as CutReason)) {
        problems.push(`${label}: reason must be one of ${CUT_REASONS.join(`, `)}.`)
      }
      if (!checkRange(label, r)) return
      const cut = r as unknown as Cut
      checkOrder(label, cuts[cuts.length - 1], cut)
      cuts.push(cut)
    })
  }

  const chapters: Chapter[] = []
  list(`chapters`).slice(0, MAX_CUTS).forEach((c, i) => {
    const r = (c ?? {}) as Record<string, unknown>
    const label = `chapters[${i}]`
    if (!nonEmpty(r.title)) problems.push(`${label}: title must be a non-empty string.`)
    if (typeof r.start !== `number` || !(r.start >= 0) || r.start >= mediaSeconds) {
      problems.push(`${label} at ${r.start}: start must be a number inside the media.`)
      return
    }
    const prev = chapters[chapters.length - 1]
    if (prev && r.start <= prev.start) {
      problems.push(`${label} at ${r.start} s: not after the chapter before it (${prev.start} s).`)
    }
    chapters.push(r as unknown as Chapter)
  })
  if (chapters.length === 0) problems.push(`"chapters" needs at least one chapter.`)
  else if (chapters[0].start !== 0) {
    problems.push(`chapters[0] at ${chapters[0].start} s: the first chapter must start at 0.`)
  }

  const shorts: Short[] = []
  const shortsRaw = list(`shorts`)
  if (shortsRaw.length !== SHORT_COUNT) {
    problems.push(`"shorts" needs exactly ${SHORT_COUNT}, got ${shortsRaw.length}.`)
  }
  shortsRaw.slice(0, SHORT_COUNT).forEach((s, i) => {
    const r = (s ?? {}) as Record<string, unknown>
    const label = `shorts[${i}]`
    if (!nonEmpty(r.title)) problems.push(`${label}: title must be a non-empty string.`)
    if (!checkRange(label, r)) return
    const short = r as unknown as Short
    shorts.push(short)
    const length = totalSeconds(keepRanges([...autoCuts, ...cuts], short.start, short.end))
    if (length < SHORT_MIN_SECONDS || length > SHORT_MAX_SECONDS) {
      problems.push(
        `${label} ${
          fmtRange(short)
        }: ${length} s after the cuts, must be ${SHORT_MIN_SECONDS}–${SHORT_MAX_SECONDS} s.`,
      )
    }
  })

  const result: EditList = { cuts, chapters, shorts }
  if (obj.titles !== undefined) {
    if (
      !Array.isArray(obj.titles) || obj.titles.length !== TITLE_COUNT || !obj.titles.every(nonEmpty)
    ) {
      problems.push(`"titles", when given, must be ${TITLE_COUNT} non-empty strings.`)
    } else result.titles = obj.titles as string[]
  }
  if (obj.description !== undefined) {
    if (!nonEmpty(obj.description)) {
      problems.push(`"description", when given, must be a non-empty string.`)
    } else result.description = obj.description as string
  }

  if (problems.length > 0) {
    throw new Error(`The edit list is not valid:\n- ${problems.join(`\n- `)}`)
  }
  return result
}

/**
 * The JSON value in Claude's reply: the body of a fenced code block when there is one, else the
 * text from the first `{` to the last `}`. Throws when the reply is too long or holds no JSON.
 */
export function parseClaudeReply(reply: string): unknown {
  if (reply.length > MAX_REPLY_CHARS) {
    throw new Error(
      `Claude's reply is ${reply.length} characters, over the ${MAX_REPLY_CHARS} limit.`,
    )
  }
  const fenced = reply.match(/```(?:json)?[ \t]*\n([\s\S]*?)\n[ \t]*```/)
  const first = reply.indexOf(`{`)
  const last = reply.lastIndexOf(`}`)
  const text = fenced ? fenced[1] : first >= 0 && last > first ? reply.slice(first, last + 1) : ``
  if (!text.trim()) throw new Error(`Claude's reply holds no JSON object.`)
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`Claude's reply is not valid JSON: ${(error as Error).message}`)
  }
}

/** Maps a source time to the cut timeline, or the next kept moment when it was cut. */
export function toCutTime(t: number, keeps: Range[]): number {
  let out = 0
  for (const k of keeps) {
    if (t < k.start) return ms(out)
    if (t <= k.end) return ms(out + (t - k.start))
    out += k.end - k.start
  }
  return ms(out)
}

export interface Cue extends Range {
  text: string
}

export interface CueOptions {
  maxWords: number
  maxChars: number
}

export const LONG_CUES: CueOptions = { maxWords: 12, maxChars: 42 }
/** Phone captions: short lines, big letters. */
export const SHORT_CUES: CueOptions = { maxWords: 4, maxChars: 24 }

/** The words whose middle a kept range holds, with their times on the cut timeline. */
export function keptWords(words: Word[], keeps: Range[]): Word[] {
  const kept: Word[] = []
  let offset = 0
  let w = 0
  for (const k of keeps) {
    while (w < words.length && (words[w].start + words[w].end) / 2 < k.start) w++
    for (let i = w; i < words.length; i++) {
      const word = words[i]
      const mid = (word.start + word.end) / 2
      if (mid >= k.end) break
      if (mid < k.start) continue
      kept.push({
        start: ms(offset + Math.max(word.start, k.start) - k.start),
        end: ms(offset + Math.min(word.end, k.end) - k.start),
        text: word.text,
      })
    }
    offset += k.end - k.start
  }
  return kept
}

/**
 * Caption cues on the cut timeline. A word counts when its middle is kept; a cue ends at sentence
 * punctuation (after three words), at the size limits, or when the speaker pauses.
 */
export function buildCues(words: Word[], keeps: Range[], options: CueOptions): Cue[] {
  const cues: Cue[] = []
  let current: Cue | undefined
  let count = 0
  const flush = () => {
    if (current) cues.push(current)
    current = undefined
    count = 0
  }
  for (const w of keptWords(words, keeps)) {
    if (current) {
      const tooLong = current.text.length + 1 + w.text.length > options.maxChars
      if (count >= options.maxWords || tooLong || w.start - current.end > 0.7) flush()
    }
    if (current) {
      current.text += ` ${w.text}`
      current.end = w.end
    } else current = { ...w }
    count++
    if (count >= 3 && /[.?!]$/.test(w.text)) flush()
  }
  flush()
  return cues
}

function srtTime(seconds: number): string {
  const total = Math.round(seconds * 1000)
  const p = (n: number, w = 2) => String(n).padStart(w, `0`)
  const h = Math.floor(total / 3600000)
  const m = Math.floor((total % 3600000) / 60000)
  const s = Math.floor((total % 60000) / 1000)
  return `${p(h)}:${p(m)}:${p(s)},${p(total % 1000, 3)}`
}

export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
    .join(`\n`)
}

export interface AssStyle {
  width: number
  height: number
  /** Letter height in pixels of the `width` x `height` frame. */
  fontSize: number
  /** Distance from the bottom edge to the text, in pixels. */
  marginBottom: number
  /** Distance from the left and right edges, in pixels. */
  marginSide: number
}

function assTime(seconds: number): string {
  const cs = Math.round(seconds * 100)
  const p = (n: number) => String(n).padStart(2, `0`)
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  return `${h}:${p(m)}:${p(s)}.${p(cs % 100)}`
}

/**
 * Burned-in captions as an ASS file. Its play resolution is the video's own, so sizes are real
 * pixels; an SRT is read by libass at 384x288 and scaled, which puts a phone-sized margin off the
 * screen.
 */
export function toAss(cues: Cue[], style: AssStyle): string {
  const events = cues.map((c) =>
    `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${
      c.text.replace(/[{}\\]/g, ``)
    }`
  )
  const outline = Math.max(2, Math.round(style.fontSize / 14))
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${style.width}
PlayResY: ${style.height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,${style.fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,${outline},0,2,${style.marginSide},${style.marginSide},${style.marginBottom},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join(`\n`)}
`
}

/**
 * The request Claude answers with the edit list: a short instruction, the JSON shape to return,
 * and the transcript as numbered segments with their times.
 */
export function editBrief(segments: Segment[], silences: Cut[], mediaSeconds: number): string {
  const lines = segments.map((s) =>
    `[${s.n}] ${s.start.toFixed(1)}–${s.end.toFixed(1)} s  ${s.text}`
  )
  return `# Edit list request

You edit a talking-head video, ${ms(mediaSeconds)} s long. Below is its transcript as numbered
segments with source times in seconds. The ${silences.length} long silences are already cut
by a script; do not list them. Reply with one JSON object and nothing else.

- \`cuts\`: ranges to remove, in time order, never overlapping. \`reason\` is \`filler\` (um, uh,
  false starts), \`retake\` (the speaker repeats a line, cut the weaker take) or \`off-topic\`.
  Cut on word boundaries and keep the edit conservative.
- \`chapters\`: 3 to 8 marks, ordered; the first starts at 0; \`title\` is plain and specific.
- \`shorts\`: exactly ${SHORT_COUNT} self-contained moment for a vertical clip. It is
  ${SHORT_MIN_SECONDS}–${SHORT_MAX_SECONDS} s long after the cuts, starts on a hook and ends on a
  finished thought.
- \`titles\`: ${TITLE_COUNT} title options for the video, plain and specific, under 70 characters.
- \`description\`: two or three sentences for the video's description: what it shows and for whom.

All times are source seconds, inside 0–${ms(mediaSeconds)}.

\`\`\`json
{
  "cuts": [{ "start": 12.4, "end": 13.1, "reason": "filler", "note": "um" }],
  "chapters": [{ "start": 0, "title": "Why I built it" }],
  "shorts": [{ "start": 40.0, "end": 82.5, "title": "The mistake that cost a week" }],
  "titles": ["…", "…", "…"],
  "description": "…"
}
\`\`\`

## Transcript

${lines.join(`\n`)}
`
}

/**
 * An ffmpeg filter graph that keeps the given source ranges and joins them, ending in the labels
 * `[v]` (and `[a]` with audio). `videoTail` is appended to the video chain (crop, scale, captions).
 */
export function trimConcatGraph(keeps: Range[], hasAudio: boolean, videoTail = ``): string {
  const parts: string[] = []
  keeps.forEach((k, i) => {
    parts.push(`[0:v]trim=start=${k.start}:end=${k.end},setpts=PTS-STARTPTS[v${i}]`)
    if (hasAudio) parts.push(`[0:a]atrim=start=${k.start}:end=${k.end},asetpts=PTS-STARTPTS[a${i}]`)
  })
  const inputs = keeps.map((_, i) => hasAudio ? `[v${i}][a${i}]` : `[v${i}]`).join(``)
  parts.push(
    `${inputs}concat=n=${keeps.length}:v=1:a=${hasAudio ? 1 : 0}${hasAudio ? `[vc][a]` : `[vc]`}`,
  )
  parts.push(`[vc]${videoTail || `null`}[v]`)
  return parts.join(`;\n`)
}

/** Where the audio of every output is levelled to: YouTube's loudness, one dB of headroom. */
export const LOUDNESS = { integrated: -14, truePeak: -1, range: 11 }

/** The values loudnorm's first pass prints, which its second pass takes back. */
export interface LoudnormMeasure {
  input_i: string
  input_tp: string
  input_lra: string
  input_thresh: string
  target_offset: string
}

const MEASURE_KEYS = [`input_i`, `input_tp`, `input_lra`, `input_thresh`, `target_offset`] as const

/**
 * The audio filter of a loudness pass. Without `measured` it is the first pass, which only
 * measures and prints JSON; with it, the second pass applies one linear gain from those values.
 * `denoise` puts `afftdn` first, in both passes, so the measure is of the audio that is levelled.
 */
export function loudnessFilter(denoise: boolean, measured?: LoudnormMeasure): string {
  const base = `loudnorm=I=${LOUDNESS.integrated}:TP=${LOUDNESS.truePeak}:LRA=${LOUDNESS.range}`
  const loudnorm = measured
    ? `${base}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}` +
      `:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}` +
      `:offset=${measured.target_offset}:linear=true:print_format=summary`
    : `${base}:print_format=json`
  return denoise ? `afftdn,${loudnorm}` : loudnorm
}

/** ffmpeg arguments of the first pass: decode the audio of `input` and measure it. */
export function measureArgs(input: string, denoise: boolean): string[] {
  return [
    `-hide_banner`,
    `-nostats`,
    `-i`,
    input,
    `-af`,
    loudnessFilter(denoise),
    `-vn`,
    `-f`,
    `null`,
    `-`,
  ]
}

/** ffmpeg arguments of the second pass: level the audio of `input` into `output`, video copied. */
export function applyArgs(
  input: string,
  output: string,
  denoise: boolean,
  measured: LoudnormMeasure,
): string[] {
  return [
    `-y`,
    `-hide_banner`,
    `-loglevel`,
    `error`,
    `-i`,
    input,
    `-af`,
    loudnessFilter(denoise, measured),
    `-c:v`,
    `copy`,
    `-c:a`,
    `aac`,
    `-b:a`,
    `192k`,
    `-ar`,
    `48000`,
    `-movflags`,
    `+faststart`,
    output,
  ]
}

/**
 * The JSON block loudnorm's first pass prints at the end of ffmpeg's log. Throws when there is
 * none, when a value is not a number, or when the audio is silent (`-inf`), which no gain can level.
 */
export function parseLoudnorm(stderr: string): LoudnormMeasure {
  const start = stderr.lastIndexOf(`{`)
  const end = stderr.lastIndexOf(`}`)
  let data: Record<string, unknown>
  try {
    if (start < 0 || end < start) throw new Error()
    data = JSON.parse(stderr.slice(start, end + 1))
  } catch {
    throw new Error(`ffmpeg's loudnorm printed no measurement:\n${stderr.slice(-500)}`)
  }
  for (const key of MEASURE_KEYS) {
    const value = data[key]
    if (value === `-inf`) {
      throw new Error(`The audio is silent (loudnorm ${key} is -inf); nothing to level.`)
    }
    if (typeof value !== `string` || !isFinite(Number(value))) {
      throw new Error(`loudnorm's measurement has no number for ${key}: ${JSON.stringify(value)}.`)
    }
  }
  return Object.fromEntries(
    MEASURE_KEYS.map((key) => [key, data[key]]),
  ) as unknown as LoudnormMeasure
}

export interface KdenliveInput {
  title: string
  mediaPath: string
  width: number
  height: number
  fpsNum: number
  fpsDen: number
  /** Whole source length, for the bin clip. */
  mediaSeconds: number
  keeps: Range[]
  /** Chapter marks on the cut timeline, in seconds. */
  chapters: Chapter[]
}

const esc = (s: string) =>
  s.replace(/&/g, `&amp;`).replace(/</g, `&lt;`).replace(/>/g, `&gt;`).replace(/"/g, `&quot;`)

/**
 * A Kdenlive project (MLT XML, document version 1.1) of the cut: the source in the bin, one video
 * and one audio track holding the kept ranges back to back, and the chapters as guides. Edit it in
 * Kdenlive like any project.
 */
export function buildKdenlive(input: KdenliveInput): string {
  const fps = input.fpsNum / input.fpsDen
  const frames = (s: number) => Math.round(s * fps)
  const sourceFrames = frames(input.mediaSeconds)
  const entries = (producer: string) =>
    input.keeps.map((k) =>
      `  <entry producer="${producer}" in="${frames(k.start)}" out="${
        Math.max(frames(k.end) - 1, frames(k.start))
      }"/>`
    ).join(`\n`)
  const total = input.keeps.reduce((n, k) => n + Math.max(frames(k.end) - frames(k.start), 1), 0)
  const guides = JSON.stringify(
    input.chapters.map((c) => ({ comment: c.title, pos: frames(c.start), type: 0 })),
  )
  const clip = (id: string, extra: string) =>
    ` <producer id="${id}" in="0" out="${sourceFrames - 1}">
  <property name="length">${sourceFrames}</property>
  <property name="eof">pause</property>
  <property name="resource">${esc(input.mediaPath)}</property>
  <property name="mlt_service">avformat-novalidate</property>
  <property name="seekable">1</property>${extra}
  <property name="kdenlive:id">2</property>
 </producer>`
  const { width, height, fpsNum, fpsDen } = input
  return `<?xml version="1.0" encoding="utf-8"?>
<mlt LC_NUMERIC="C" version="7.22.0" title="${esc(input.title)}" producer="main_bin">
 <profile description="${width}x${height} ${
    fps.toFixed(2)
  } fps" width="${width}" height="${height}" progressive="1" sample_aspect_num="1" sample_aspect_den="1" display_aspect_num="${width}" display_aspect_den="${height}" frame_rate_num="${fpsNum}" frame_rate_den="${fpsDen}" colorspace="709"/>
${
    clip(
      `producer0`,
      `\n  <property name="kdenlive:clip_type">0</property>\n  <property name="kdenlive:folderid">-1</property>`,
    )
  }
${clip(`producer_v`, `\n  <property name="set.test_audio">1</property>`)}
${clip(`producer_a`, `\n  <property name="set.test_image">1</property>`)}
 <playlist id="playlist_a">
  <property name="kdenlive:audio_track">1</property>
  <property name="kdenlive:track_name">Audio</property>
${entries(`producer_a`)}
 </playlist>
 <tractor id="tractor_a" in="0" out="${total - 1}">
  <property name="kdenlive:audio_track">1</property>
  <property name="kdenlive:trackheight">67</property>
  <track hide="video" producer="playlist_a"/>
 </tractor>
 <playlist id="playlist_v">
  <property name="kdenlive:track_name">Video</property>
${entries(`producer_v`)}
 </playlist>
 <tractor id="tractor_v" in="0" out="${total - 1}">
  <property name="kdenlive:trackheight">67</property>
  <track hide="audio" producer="playlist_v"/>
 </tractor>
 <playlist id="main_bin">
  <property name="kdenlive:docproperties.version">1.1</property>
  <property name="kdenlive:docproperties.guides">${esc(guides)}</property>
  <property name="kdenlive:docproperties.profile">${width}x${height}</property>
  <entry producer="producer0" in="0" out="${sourceFrames - 1}"/>
 </playlist>
 <producer id="black_track" in="0" out="${total - 1}">
  <property name="resource">black</property>
  <property name="mlt_service">color</property>
  <property name="set.test_audio">0</property>
 </producer>
 <tractor id="tractor_main" in="0" out="${total - 1}">
  <property name="kdenlive:projectTractor">1</property>
  <track producer="black_track"/>
  <track producer="tractor_a"/>
  <track producer="tractor_v"/>
  <transition mlt_service="mix" a_track="0" b_track="1" always_active="1" sum="1"/>
  <transition mlt_service="qtblend" a_track="0" b_track="2" compositing="0" distort="0" rotate_center="0"/>
 </tractor>
</mlt>
`
}

/** Formats seconds as a YouTube chapter timestamp: `0:00`, `2:14`, `1:02:14`. */
export function formatTimestamp(totalSeconds: number): string {
  const s = Math.floor(totalSeconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, `0`)
  return h > 0 ? `${h}:${String(m).padStart(2, `0`)}:${ss}` : `${m}:${ss}`
}

const sentences = (text: string) =>
  text.replace(/\s+/g, ` `).trim().split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean)

/**
 * The three title options: Claude's when the edit list has them, else the first sentences of the
 * transcript that fit a title (15–90 characters), topped up with the Short's and the first
 * chapter's titles.
 */
export function titleOptions(list: EditList, fullText: string): string[] {
  if (list.titles) return list.titles
  const fitting = sentences(fullText).filter((s) => s.length >= 15 && s.length <= 90)
  const options = [
    ...new Set([...fitting, ...list.shorts.map((s) => s.title), list.chapters[0].title]),
  ]
  return options.slice(0, TITLE_COUNT)
}

export function titlesDraft(titles: string[]): string {
  return `# Title options\n\n${titles.map((title, i) => `${i + 1}. ${title}`).join(`\n`)}\n`
}

/**
 * The YouTube description: Claude's text, or the transcript's first three sentences, then the
 * chapters as timestamps on the cut timeline.
 */
export function descriptionDraft(list: EditList, fullText: string, chapters: Chapter[]): string {
  const summary = list.description ?? sentences(fullText).slice(0, 3).join(` `)
  const lines = chapters.map((c) => `${formatTimestamp(c.start)} ${c.title}`).join(`\n`)
  return `${summary}\n\n${lines}\n`
}

/** The cut's words as plain text under its chapter titles: raw material for the post. */
export function transcriptDraft(slug: string, words: Word[], chapters: Chapter[]): string {
  const parts: string[] = [`# ${slug}: transcript of the cut`]
  let next = 0
  let paragraph: string[] = []
  const flush = () => {
    if (paragraph.length) parts.push(paragraph.join(` `))
    paragraph = []
  }
  for (const w of words) {
    while (next < chapters.length && chapters[next].start <= w.start + EPSILON) {
      flush()
      parts.push(`## ${chapters[next++].title}`)
    }
    paragraph.push(w.text)
  }
  flush()
  return `${parts.join(`\n\n`)}\n`
}
