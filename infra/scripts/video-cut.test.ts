/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import type { RunCommandResult } from "@spy4x/platform/server/run-command"
import { type CutOptions, defaultModel, type Files, type Ports, videoCut } from "./video-cut.ts"

/**
 * The steps of `videoCut` against an in-memory folder and fake tools: which tool runs when, what
 * each step leaves behind, and how each failure reads. `video-cut-flow.test.ts` runs real ffmpeg.
 */

const OUT = `/rec/cut`
const MODEL = `/models/ggml-small.en.bin`

/** Ten words a second apart, 0.5 s each, then a 3 s pause and ninety more: 104 s of talk. */
function whisperJson(): string {
  const tokens = Array.from({ length: 100 }, (_, i) => {
    const from = (i < 10 ? i : i + 3) * 1000
    return { text: ` w${i}${i % 5 === 4 ? `.` : ``}`, offsets: { from, to: from + 500 } }
  })
  return JSON.stringify({
    transcription: [{
      text: tokens.map((t) => t.text).join(``),
      offsets: { from: 0, to: 103_500 },
      tokens,
    }],
  })
}

const EDIT_LIST = {
  cuts: [{ start: 2.5, end: 3, reason: `filler` }],
  chapters: [{ start: 0, title: `Start` }, { start: 40, title: `Middle` }],
  shorts: [{ start: 20, end: 60, title: `The short` }],
}

const MEASURE =
  `{"input_i":"-21","input_tp":"-6","input_lra":"2","input_thresh":"-31","target_offset":"0.1"}`

interface Fake {
  ports: Ports
  files: Map<string, string>
  calls: string[][]
  logs: string[]
}

type Override = (command: string[]) => Partial<RunCommandResult> | undefined

/** A folder in memory and tools that write what the real ones would; `override` changes one. */
function fake(override: Override = () => undefined, seed: Record<string, string> = {}): Fake {
  const files = new Map<string, string>(Object.entries({ [MODEL]: `model`, ...seed }))
  const calls: string[][] = []
  const logs: string[] = []
  const fs: Files = {
    exists: (path) => Promise.resolve(files.has(path)),
    readText: (path) => Promise.resolve(files.get(path) ?? null),
    writeText: (path, text) => Promise.resolve(void files.set(path, text)),
    remove: (path) => Promise.resolve(void files.delete(path)),
    mkdirp: () => Promise.resolve(),
    rename: (from, to) => Promise.resolve(void files.set(to, files.get(from) ?? ``)),
  }
  const ok = (stdout = ``, stderr = ``): RunCommandResult => ({
    success: true,
    code: 0,
    stdout,
    stderr,
  })
  const run = (command: string[], { cwd }: { cwd?: string }) => {
    calls.push(command)
    const changed = override(command)
    if (changed) return Promise.resolve({ ...ok(), ...changed })
    const [name] = command
    if (name === `ffprobe`) {
      return Promise.resolve(ok(JSON.stringify({
        format: { duration: `104` },
        streams: [{ codec_type: `video`, width: 1920, height: 1080, r_frame_rate: `30/1` }, {
          codec_type: `audio`,
        }],
      })))
    }
    if (name === `whisper-cli`) files.set(`${cwd}/whisper.json`, whisperJson())
    if (name === `claude`) {
      return Promise.resolve(ok(`\`\`\`json\n${JSON.stringify(EDIT_LIST)}\n\`\`\``))
    }
    if (name === `ffmpeg` && command.includes(`null`)) return Promise.resolve(ok(``, MEASURE))
    if (name === `ffmpeg`) files.set(`${cwd}/${command.at(-1)}`, `media`)
    return Promise.resolve(ok())
  }
  return { ports: { files: fs, run, log: (line) => logs.push(line) }, files, calls, logs }
}

const options = (extra: Partial<CutOptions> = {}): CutOptions => ({
  recording: `/rec/raw.mkv`,
  slug: `demo`,
  outDir: OUT,
  model: MODEL,
  claude: true,
  denoise: false,
  minSilence: 0.8,
  ...extra,
})

const names = (calls: string[][]) => calls.map((c) => c[0])

Deno.test("a first run transcribes, asks Claude, renders, levels the audio twice per output and writes the drafts", async () => {
  const f = fake()
  const result = await videoCut(options(), f.ports)
  expect(result.status).toBe(`done`)
  expect(names(f.calls)).toEqual([
    `ffprobe`,
    `ffmpeg`, // 16 kHz WAV for whisper
    `whisper-cli`,
    `claude`,
    `ffmpeg`, // long cut
    `ffmpeg`, // Short
    `ffmpeg`, // long: measure
    `ffmpeg`, // long: apply
    `ffmpeg`, // Short: measure
    `ffmpeg`, // Short: apply
  ])
  for (
    const name of [
      `transcript.json`,
      `brief.md`,
      `claude-reply.txt`,
      `edit-list.json`,
      `long.mp4`,
      `long.srt`,
      `short.mp4`,
      `short.ass`,
      `demo.kdenlive`,
      `titles.md`,
      `description.md`,
      `transcript.md`,
    ]
  ) expect({ name, kept: f.files.has(`${OUT}/${name}`) }).toEqual({ name, kept: true })
  for (const name of [`audio.wav`, `whisper.json`, `long.render.mp4`, `short.render.mp4`]) {
    expect({ name, kept: f.files.has(`${OUT}/${name}`) }).toEqual({ name, kept: false })
  }
  expect(f.files.get(`${OUT}/description.md`)).toContain(`0:00 Start\n`)
})

Deno.test("a rerun reuses the transcript and the edit list and renders again", async () => {
  const first = fake()
  await videoCut(options(), first.ports)
  const seed = Object.fromEntries(
    [`transcript.json`, `edit-list.json`].map((
      name,
    ) => [`${OUT}/${name}`, first.files.get(`${OUT}/${name}`)!]),
  )
  const again = fake(undefined, seed)
  const result = await videoCut(options(), again.ports)
  expect(result.status).toBe(`done`)
  expect(names(again.calls)).not.toContain(`whisper-cli`)
  expect(names(again.calls)).not.toContain(`claude`)
  expect(names(again.calls).filter((n) => n === `ffmpeg`).length).toBe(6)
  expect(again.logs).toContain(`transcript: reusing ${OUT}/transcript.json`)
})

Deno.test("a second recording in the same work folder fails and leaves the first one's cut alone", async () => {
  const first = fake()
  await videoCut(options(), first.ports)
  expect(first.files.get(`${OUT}/source.txt`)).toBe(`/rec/raw.mkv\n`)
  const before = new Map(first.files)
  first.calls.length = 0
  await expect(videoCut(options({ recording: `/rec/other.mkv` }), first.ports)).rejects.toThrow(
    `${OUT} holds the cut of /rec/raw.mkv, not /rec/other.mkv. Pass --out <dir>`,
  )
  expect(first.calls).toEqual([])
  expect(first.files).toEqual(before)
})

Deno.test("--no-claude stops after the brief and says where the edit list goes", async () => {
  const f = fake()
  const result = await videoCut(options({ claude: false }), f.ports)
  expect(result).toEqual({
    status: `needs-edit-list`,
    brief: `${OUT}/brief.md`,
    editList: `${OUT}/edit-list.json`,
  })
  expect(names(f.calls)).toEqual([`ffprobe`, `ffmpeg`, `whisper-cli`])
  expect(f.files.get(`${OUT}/brief.md`)).toContain(`[1] 0.0–103.5 s`)
})

Deno.test("an edit list an agent wrote is used even with --no-claude", async () => {
  const f = fake(undefined, { [`${OUT}/edit-list.json`]: JSON.stringify(EDIT_LIST) })
  expect((await videoCut(options({ claude: false }), f.ports)).status).toBe(`done`)
  expect(names(f.calls)).not.toContain(`claude`)
})

Deno.test("an invalid edit list on disk fails with its problems and renders nothing", async () => {
  const bad = { ...EDIT_LIST, shorts: [...EDIT_LIST.shorts, EDIT_LIST.shorts[0]] }
  const f = fake(undefined, { [`${OUT}/edit-list.json`]: JSON.stringify(bad) })
  await expect(videoCut(options(), f.ports)).rejects.toThrow(`"shorts" needs exactly 1, got 2`)
  const broken = fake(undefined, { [`${OUT}/edit-list.json`]: `{` })
  await expect(videoCut(options(), broken.ports)).rejects.toThrow(
    `/rec/cut/edit-list.json" is not valid JSON`,
  )
  expect(names(f.calls)).not.toContain(`claude`)
  expect(f.files.has(`${OUT}/long.mp4`)).toBe(false)
})

Deno.test("an invalid Claude reply fails with the validation errors and keeps the raw reply", async () => {
  const f = fake((c) =>
    c[0] === `claude` ? { stdout: `{"cuts": [], "chapters": [], "shorts": []}` } : undefined
  )
  await expect(videoCut(options(), f.ports)).rejects.toThrow(
    `"chapters" needs at least one chapter.\n- "shorts" needs exactly 1, got 0.\nClaude's raw reply is in /rec/cut/claude-reply.txt.`,
  )
  expect(f.files.get(`${OUT}/claude-reply.txt`)).toBe(`{"cuts": [], "chapters": [], "shorts": []}`)
  expect(f.files.has(`${OUT}/edit-list.json`)).toBe(false)
})

Deno.test("a reply that is not JSON fails the same way", async () => {
  const f = fake((c) => c[0] === `claude` ? { stdout: `I cannot help with that.` } : undefined)
  await expect(videoCut(options(), f.ports)).rejects.toThrow(`Claude's reply holds no JSON object`)
  expect(f.files.get(`${OUT}/claude-reply.txt`)).toBe(`I cannot help with that.`)
})

Deno.test("a missing tool fails with its name and an install line", async () => {
  const missing = (tool: string): Override => (c) =>
    c[0] === tool
      ? { success: false, code: -1, error: `No such file or directory (os error 2)` }
      : undefined
  const cases = [
    [
      `ffprobe`,
      `ffprobe could not start (No such file or directory (os error 2)). Install it: it comes with ffmpeg`,
    ],
    [
      `ffmpeg`,
      `ffmpeg could not start (No such file or directory (os error 2)). Install it: sudo dnf install ffmpeg`,
    ],
    [
      `whisper-cli`,
      `whisper-cli could not start (No such file or directory (os error 2)). Install it: git clone`,
    ],
    [
      `claude`,
      `claude could not start (No such file or directory (os error 2)). Install it: npm install -g`,
    ],
  ]
  for (const [tool, message] of cases) {
    await expect(videoCut(options(), fake(missing(tool)).ports)).rejects.toThrow(message)
  }
})

Deno.test("a missing model fails with its path and how to get it, before whisper runs", async () => {
  const f = fake()
  f.files.delete(MODEL)
  await expect(videoCut(options(), f.ports)).rejects.toThrow(
    `The whisper.cpp model "${MODEL}" is missing. Install it: mkdir -p`,
  )
  expect(names(f.calls)).not.toContain(`whisper-cli`)
})

Deno.test("an ffmpeg failure shows the end of its log; a stopped tool says it timed out", async () => {
  const failing = fake((c) =>
    c.includes(`-/filter_complex`)
      ? { success: false, code: 1, stderr: `Invalid argument` }
      : undefined
  )
  await expect(videoCut(options(), failing.ports)).rejects.toThrow(
    `ffmpeg failed with exit code 1:\nInvalid argument`,
  )
  expect([...failing.files.keys()].some((k) => k.endsWith(`.filter.txt`))).toBe(false)
  const stopped = fake((c) =>
    c[0] === `whisper-cli` ? { success: false, code: 143, signal: `SIGTERM` } : undefined
  )
  await expect(videoCut(options(), stopped.ports)).rejects.toThrow(
    `whisper-cli did not finish within 120 minutes`,
  )
})

Deno.test("a whisper run that writes no usable JSON leaves no transcript a rerun would trust", async () => {
  const f = fake((c) => {
    if (c[0] === `whisper-cli`) return { stdout: `` }
  })
  await expect(videoCut(options(), f.ports)).rejects.toThrow(`whisper-cli wrote no whisper.json`)
  const garbage = fake((c) => {
    if (c[0] === `whisper-cli`) {
      garbage.files.set(`${OUT}/whisper.json`, `{"nope":1}`)
      return {}
    }
  })
  await expect(videoCut(options(), garbage.ports)).rejects.toThrow(`--output-json-full`)
  expect(garbage.files.has(`${OUT}/transcript.json`)).toBe(false)
})

Deno.test("silent audio fails the loudness step instead of levelling it", async () => {
  const silent =
    `{"input_i":"-inf","input_tp":"-inf","input_lra":"0","input_thresh":"-70","target_offset":"0"}`
  const f = fake((c) => c[0] === `ffmpeg` && c.includes(`null`) ? { stderr: silent } : undefined)
  await expect(videoCut(options(), f.ports)).rejects.toThrow(`The audio is silent`)
})

Deno.test("--denoise puts afftdn in both loudness passes", async () => {
  const f = fake()
  await videoCut(options({ denoise: true }), f.ports)
  const filters = f.calls.filter((c) => c.includes(`-af`)).map((c) => c[c.indexOf(`-af`) + 1])
  expect(filters.length).toBe(4)
  expect(filters.every((filter) => filter.startsWith(`afftdn,loudnorm=`))).toBe(true)
})

Deno.test("a brief too long for one argument to claude fails and points to --no-claude", async () => {
  const words = Array.from({ length: 20_000 }, (_, i) => ({
    text: ` word${i}`,
    offsets: { from: i * 5, to: i * 5 + 4 },
  }))
  const long = JSON.stringify({
    transcription: words.map((t) => ({ text: t.text, offsets: t.offsets, tokens: [t] })),
  })
  const f = fake(undefined, { [`${OUT}/transcript.json`]: long })
  await expect(videoCut(options(), f.ports)).rejects.toThrow(`Rerun with --no-claude`)
  expect(names(f.calls)).not.toContain(`claude`)
})

Deno.test("the model defaults to small.en under HOME, WHISPER_MODEL overrides it, and no HOME fails", () => {
  const env = (vars: Record<string, string>) => (name: string) => vars[name]
  expect(defaultModel(env({ HOME: `/home/x` }))).toBe(
    `/home/x/.local/share/whisper.cpp/models/ggml-small.en.bin`,
  )
  expect(defaultModel(env({ HOME: `/home/x`, WHISPER_MODEL: `/m.bin` }))).toBe(`/m.bin`)
  expect(() => defaultModel(env({}))).toThrow(`HOME is not set`)
})
