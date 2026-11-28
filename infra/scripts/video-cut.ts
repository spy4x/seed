/// <reference lib="deno.ns" />
/**
 * `deno task video:cut <recording> <slug>`: a talking-head recording in, the finished cut out
 * (docs/video.md). Six steps, each resumable from the files it leaves in the work folder: the
 * transcript (whisper.cpp), the silences, the edit list (Claude, or one an agent wrote), the render
 * (ffmpeg), the audio (two-pass loudnorm) and the packaging drafts.
 *
 * The steps run through injected ports, so `video-cut.test.ts` drives them with fakes; the real
 * processes and files are wired in at the bottom, the only place that touches `Deno`.
 */
import { dirname, join, resolve } from "@std/path"
import type { FileSystemPort } from "@spy4x/platform/server"
import { runCommand, type RunCommandResult } from "@spy4x/platform/server/run-command"
import { denoFileSystem } from "@spy4x/platform/server/deno-fs"
import {
  applyArgs,
  buildCues,
  buildKdenlive,
  type Cut,
  type CutArgs,
  descriptionDraft,
  editBrief,
  type EditList,
  keepRanges,
  keptWords,
  LONG_CUES,
  MAX_BRIEF_CHARS,
  measureArgs,
  type MediaInfo,
  mergeRanges,
  parseArgs,
  parseClaudeReply,
  parseLoudnorm,
  parseProbe,
  parseWhisperJson,
  type Range,
  SHORT_CUES,
  silenceCuts,
  titleOptions,
  titlesDraft,
  toAss,
  toCutTime,
  toSrt,
  transcriptDraft,
  trimConcatGraph,
  validateEditList,
} from "./video-cut-lib.ts"

/** The file operations the cut uses; `denoFileSystem` in the CLI, a map in the tests. */
export type Files = Pick<
  FileSystemPort,
  `exists` | `readText` | `writeText` | `remove` | `mkdirp` | `rename`
>

/** Runs `command` in `cwd`, killed after `timeoutMs`; `runCommand` in the CLI. */
export type Run = (
  command: string[],
  options: { cwd?: string; timeoutMs: number },
) => Promise<RunCommandResult>

export interface Ports {
  files: Files
  run: Run
  log: (line: string) => void
}

export interface CutOptions extends Omit<CutArgs, `out` | `recording`> {
  /** Absolute path of the recording. */
  recording: string
  /** Absolute path of the work and output folder. */
  outDir: string
  /** Absolute path of the whisper.cpp model. */
  model: string
}

export type CutResult =
  | { status: `done`; files: string[] }
  | { status: `needs-edit-list`; brief: string; editList: string }

const SHORT_WIDTH = 1080
const SHORT_HEIGHT = 1920
/** Kept ranges shorter than this are dropped: a one-frame sliver adds nothing. */
const MIN_KEEP_SECONDS = 0.1
const MINUTE = 60_000
/** Each process is stopped after this long; a cut of a long recording on a slow CPU fits. */
const TIMEOUT_MS = {
  ffmpeg: 60 * MINUTE,
  ffprobe: MINUTE,
  "whisper-cli": 120 * MINUTE,
  claude: 15 * MINUTE,
}

const INSTALL: Record<string, string> = {
  ffmpeg: `sudo dnf install ffmpeg (Fedora) or sudo apt install ffmpeg (Debian, Ubuntu)`,
  ffprobe: `it comes with ffmpeg: sudo dnf install ffmpeg or sudo apt install ffmpeg`,
  "whisper-cli":
    `git clone https://github.com/ggml-org/whisper.cpp && cd whisper.cpp && cmake -B build && cmake --build build -j --config Release && cp build/bin/whisper-cli ~/.local/bin/`,
  claude:
    `npm install -g @anthropic-ai/claude-code, or rerun with --no-claude and write the edit list yourself`,
}

const MODEL_INSTALL =
  `mkdir -p ~/.local/share/whisper.cpp/models && curl -L -o ~/.local/share/whisper.cpp/models/ggml-small.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin, or set WHISPER_MODEL`

/** Runs a tool and returns its result; throws naming the tool when it is missing, stopped or failed. */
async function tool(ports: Ports, command: string[], cwd?: string): Promise<RunCommandResult> {
  const name = command[0] as keyof typeof TIMEOUT_MS
  const timeoutMs = TIMEOUT_MS[name]
  const result = await ports.run(command, { cwd, timeoutMs })
  if (result.success) return result
  if (result.signal) {
    throw new Error(`${name} did not finish within ${timeoutMs / MINUTE} minutes and was stopped.`)
  }
  if (result.error !== undefined) {
    throw new Error(
      `${name} could not start (${result.error.trim()}). Install it: ${INSTALL[name]}`,
    )
  }
  throw new Error(`${name} failed with exit code ${result.code}:\n${result.stderr.slice(-1500)}`)
}

const ffmpeg = (ports: Ports, args: string[], cwd: string) =>
  tool(ports, [`ffmpeg`, `-y`, `-hide_banner`, `-loglevel`, `error`, ...args], cwd)

async function probe(ports: Ports, path: string): Promise<MediaInfo> {
  const r = await tool(ports, [
    `ffprobe`,
    `-v`,
    `error`,
    `-print_format`,
    `json`,
    `-show_format`,
    `-show_streams`,
    path,
  ])
  return parseProbe(r.stdout, path)
}

/**
 * Step 1: the transcript. Skipped when `transcript.json` exists, so a re-render never transcribes
 * again. whisper.cpp reads 16 kHz mono WAV, which ffmpeg extracts first; its output is checked
 * before it is kept as `transcript.json`, so a broken run leaves nothing a rerun would trust.
 */
async function transcribe(o: CutOptions, ports: Ports): Promise<string> {
  const path = join(o.outDir, `transcript.json`)
  const existing = await ports.files.readText(path)
  if (existing !== null) {
    ports.log(`transcript: reusing ${path}`)
    return existing
  }
  if (!await ports.files.exists(o.model)) {
    throw new Error(`The whisper.cpp model "${o.model}" is missing. Install it: ${MODEL_INSTALL}`)
  }
  ports.log(`transcript: whisper.cpp on ${o.recording}`)
  await ffmpeg(ports, [
    `-i`,
    o.recording,
    `-vn`,
    `-ac`,
    `1`,
    `-ar`,
    `16000`,
    `-c:a`,
    `pcm_s16le`,
    `audio.wav`,
  ], o.outDir)
  await tool(ports, [
    `whisper-cli`,
    `-m`,
    o.model,
    `-f`,
    `audio.wav`,
    `-ojf`,
    `-of`,
    `whisper`,
    `-np`,
  ], o.outDir)
  const text = await ports.files.readText(join(o.outDir, `whisper.json`))
  if (text === null) throw new Error(`whisper-cli wrote no whisper.json in ${o.outDir}.`)
  parseWhisperJson(text)
  await ports.files.writeText(path, text)
  await ports.files.remove(join(o.outDir, `whisper.json`))
  await ports.files.remove(join(o.outDir, `audio.wav`))
  return text
}

/**
 * Step 3: the edit list. An existing `edit-list.json` wins; else `--no-claude` stops here; else
 * `claude -p` answers the brief, its raw reply is kept in `claude-reply.txt`, and the list is saved
 * only when it is valid.
 */
async function editList(
  o: CutOptions,
  ports: Ports,
  brief: string,
  media: MediaInfo,
  silences: Cut[],
): Promise<EditList | undefined> {
  const path = join(o.outDir, `edit-list.json`)
  const existing = await ports.files.readText(path)
  if (existing !== null) {
    ports.log(`edit list: using ${path}`)
    let raw: unknown
    try {
      raw = JSON.parse(existing)
    } catch (error) {
      throw new Error(`The edit list "${path}" is not valid JSON: ${(error as Error).message}`)
    }
    return validateEditList(raw, media.seconds, silences)
  }
  if (!o.claude) return undefined
  if (brief.length > MAX_BRIEF_CHARS) {
    throw new Error(
      `The brief is ${brief.length} characters, over the ${MAX_BRIEF_CHARS} one argument to claude can hold. Rerun with --no-claude and write ${path} yourself.`,
    )
  }
  ports.log(`edit list: asking claude -p`)
  const r = await tool(ports, [
    `claude`,
    `--tools`,
    ``,
    `--no-session-persistence`,
    `--output-format`,
    `text`,
    `-p`,
    brief,
  ], o.outDir)
  const replyPath = join(o.outDir, `claude-reply.txt`)
  await ports.files.writeText(replyPath, r.stdout)
  let list: EditList
  try {
    list = validateEditList(parseClaudeReply(r.stdout), media.seconds, silences)
  } catch (error) {
    throw new Error(`${(error as Error).message}\nClaude's raw reply is in ${replyPath}.`)
  }
  await ports.files.writeText(path, `${JSON.stringify(list, null, 2)}\n`)
  return list
}

/** Renders `graph` of the recording into `out` (in `outDir`); the graph goes through a file. */
async function render(o: CutOptions, ports: Ports, graph: string, hasAudio: boolean, out: string) {
  const script = `${out}.filter.txt`
  await ports.files.writeText(join(o.outDir, script), graph)
  try {
    await ffmpeg(ports, [
      `-i`,
      o.recording,
      `-/filter_complex`,
      script,
      `-map`,
      `[v]`,
      ...(hasAudio ? [`-map`, `[a]`] : []),
      `-c:v`,
      `libx264`,
      `-preset`,
      `veryfast`,
      `-crf`,
      `20`,
      `-pix_fmt`,
      `yuv420p`,
      ...(hasAudio ? [`-c:a`, `aac`, `-b:a`, `192k`] : []),
      out,
    ], o.outDir)
  } finally {
    await ports.files.remove(join(o.outDir, script))
  }
}

/**
 * Step 5: levels `input` into `output` with two loudnorm passes: the first measures, the second
 * applies those values as one linear gain, with the video copied. Removes `input`.
 */
async function level(
  o: CutOptions,
  ports: Ports,
  input: string,
  output: string,
  hasAudio: boolean,
) {
  if (hasAudio) {
    const measure = await tool(ports, [`ffmpeg`, ...measureArgs(input, o.denoise)], o.outDir)
    const measured = parseLoudnorm(measure.stderr)
    await tool(ports, [`ffmpeg`, ...applyArgs(input, output, o.denoise, measured)], o.outDir)
    await ports.files.remove(join(o.outDir, input))
  } else await ports.files.rename(join(o.outDir, input), join(o.outDir, output))
}

/** Runs every step; see the top of this file. */
export async function videoCut(o: CutOptions, ports: Ports): Promise<CutResult> {
  await ports.files.mkdirp(o.outDir)
  const media = await probe(ports, o.recording)

  const { words, segments } = parseWhisperJson(await transcribe(o, ports))
  const silences = silenceCuts(words, media.seconds, o.minSilence)
  ports.log(`silences: ${silences.length} longer than ${o.minSilence} s`)

  const briefPath = join(o.outDir, `brief.md`)
  const brief = editBrief(segments, silences, media.seconds)
  await ports.files.writeText(briefPath, brief)
  const list = await editList(o, ports, brief, media, silences)
  if (!list) {
    return {
      status: `needs-edit-list`,
      brief: briefPath,
      editList: join(o.outDir, `edit-list.json`),
    }
  }

  const cuts: Range[] = mergeRanges([...silences, ...list.cuts])
  const keepsOf = (from: number, to: number) =>
    keepRanges(cuts, from, to).filter((k) => k.end - k.start >= MIN_KEEP_SECONDS)
  const keeps = keepsOf(0, media.seconds)
  if (keeps.length === 0) throw new Error(`The cuts remove the whole video.`)
  const short = list.shorts[0]
  const shortKeeps = keepsOf(short.start, short.end)
  if (shortKeeps.length === 0) throw new Error(`The cuts remove the whole Short.`)

  const written: string[] = []
  const write = async (name: string, text: string) => {
    await ports.files.writeText(join(o.outDir, name), text)
    written.push(join(o.outDir, name))
  }

  ports.log(`render: long cut, Short, captions, Kdenlive project`)
  await render(o, ports, trimConcatGraph(keeps, media.hasAudio), media.hasAudio, `long.render.mp4`)
  await write(`long.srt`, toSrt(buildCues(words, keeps, LONG_CUES)))
  // Phone captions: 64 px letters, 420 px above the bottom edge, clear of the app's buttons.
  await write(
    `short.ass`,
    toAss(buildCues(words, shortKeeps, SHORT_CUES), {
      width: SHORT_WIDTH,
      height: SHORT_HEIGHT,
      fontSize: 64,
      marginBottom: 420,
      marginSide: 60,
    }),
  )
  const tail = `crop=floor(ih*9/16/2)*2:ih,scale=${SHORT_WIDTH}:${SHORT_HEIGHT},ass=short.ass`
  await render(
    o,
    ports,
    trimConcatGraph(shortKeeps, media.hasAudio, tail),
    media.hasAudio,
    `short.render.mp4`,
  )
  const chapters = list.chapters.map((c) => ({ start: toCutTime(c.start, keeps), title: c.title }))
  await write(
    `${o.slug}.kdenlive`,
    buildKdenlive({
      ...media,
      title: o.slug,
      mediaPath: o.recording,
      mediaSeconds: media.seconds,
      keeps,
      chapters,
    }),
  )

  ports.log(`audio: levelling to -14 LUFS, -1 dBTP${o.denoise ? `, denoised` : ``}`)
  for (const name of [`long`, `short`]) {
    await level(o, ports, `${name}.render.mp4`, `${name}.mp4`, media.hasAudio)
    written.push(join(o.outDir, `${name}.mp4`))
  }

  const cutWords = keptWords(words, keeps)
  const fullText = cutWords.map((w) => w.text).join(` `)
  await write(`titles.md`, titlesDraft(titleOptions(list, fullText)))
  await write(`description.md`, descriptionDraft(list, fullText, chapters))
  await write(`transcript.md`, transcriptDraft(o.slug, cutWords, chapters))
  return { status: `done`, files: written }
}

/** The default whisper.cpp model, under the person's home. */
export function defaultModel(env: (name: string) => string | undefined): string {
  const fromEnv = env(`WHISPER_MODEL`)
  if (fromEnv) return fromEnv
  const home = env(`HOME`)
  if (!home) throw new Error(`HOME is not set; set WHISPER_MODEL to the whisper.cpp model's path.`)
  return join(home, `.local/share/whisper.cpp/models/ggml-small.en.bin`)
}

if (import.meta.main) {
  try {
    const args = parseArgs(Deno.args)
    const recording = resolve(args.recording)
    const outDir = resolve(args.out ?? join(dirname(recording), `cut`))
    const result = await videoCut(
      { ...args, recording, outDir, model: defaultModel((name) => Deno.env.get(name)) },
      {
        files: denoFileSystem,
        run: (command, { cwd, timeoutMs }) =>
          runCommand(command, { cwd, signal: AbortSignal.timeout(timeoutMs) }),
        log: (line) => console.log(line),
      },
    )
    if (result.status === `done`) {
      for (const file of result.files) console.log(`  ✓ ${file}`)
      console.log(`\nCut ready in ${outDir}. Nothing was uploaded.`)
    } else {
      console.log(
        `\nStopped before the edit list (--no-claude). Answer ${result.brief} with its JSON, save it as ${result.editList}, then run the same command again: it reuses the transcript and renders.`,
      )
    }
  } catch (error) {
    console.error(`\n  ✗ ${(error as Error).message}\n`)
    Deno.exit(1)
  }
}
