/// <reference lib="deno.ns" />
/**
 * End to end, offline: `deno task video:cut` on an 80 s clip that ffmpeg makes (a test pattern and
 * a tone that sounds only while the fixture's words are spoken), with fake `whisper-cli` and
 * `claude` first on PATH. Real ffmpeg renders, levels and measures. A machine without ffmpeg fails
 * at the fixture, never skips. `deno task video:test` runs it; the unit group leaves it out
 * (infra/scripts/test.ts), because CI's `check` image has no ffmpeg.
 */
import { expect } from "@std/expect"
import { fromFileUrl, join } from "@std/path"

const ROOT = fromFileUrl(new URL(`../../`, import.meta.url))
const SECONDS = 80
/** Word `i` starts at 0.5 i seconds and lasts 0.4 s; a 3 s pause follows word 39. */
const PAUSE_AFTER = 39
const PAUSE = 3
const WORDS = 150

/** The fixture's whisper.cpp `--output-json-full` text; word 10 is "um". */
function whisperJson(): string {
  const segments = []
  for (let s = 0; s < WORDS / 5; s++) {
    const tokens = []
    for (let w = s * 5; w < s * 5 + 5; w++) {
      const from = Math.round((0.5 * w + (w > PAUSE_AFTER ? PAUSE : 0)) * 1000)
      tokens.push({
        text: ` ${w === 10 ? `um` : `word${w}`}${w % 5 === 4 ? `.` : ``}`,
        offsets: { from, to: from + 400 },
      })
    }
    segments.push({
      text: tokens.map((t) => t.text).join(``),
      offsets: { from: tokens[0].offsets.from, to: tokens[4].offsets.to },
      tokens: [{
        text: `[_BEG_]`,
        offsets: { from: tokens[0].offsets.from, to: tokens[0].offsets.from },
      }, ...tokens],
    })
  }
  return JSON.stringify({ transcription: segments })
}

const EDIT_LIST = {
  cuts: [
    { start: 5.0, end: 5.4, reason: `filler`, note: `um` },
    { start: 50.0, end: 52.0, reason: `retake` },
  ],
  chapters: [{ start: 0, title: `Start` }, { start: 30, title: `Middle` }, {
    start: 60,
    title: `End`,
  }],
  shorts: [{ start: 6, end: 42, title: `The short` }],
  titles: [`First title`, `Second title`, `Third title`],
  description: `A test clip.`,
}

async function run(
  command: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<{ code: number; out: string; err: string }> {
  const r = await new Deno.Command(command[0], {
    args: command.slice(1),
    ...options,
    stdout: `piped`,
    stderr: `piped`,
  })
    .output()
  const dec = new TextDecoder()
  return { code: r.code, out: dec.decode(r.stdout), err: dec.decode(r.stderr) }
}

/** Integrated loudness (LUFS) and true peak (dBTP) of a file's audio, by ffmpeg's ebur128. */
async function loudness(path: string): Promise<{ integrated: number; truePeak: number }> {
  const r = await run([
    `ffmpeg`,
    `-hide_banner`,
    `-nostats`,
    `-i`,
    path,
    `-af`,
    `ebur128=peak=true`,
    `-f`,
    `null`,
    `-`,
  ])
  expect(r.code).toBe(0)
  const summary = r.err.slice(r.err.lastIndexOf(`Summary:`))
  return {
    integrated: Number(summary.match(/I:\s+(-?[\d.]+) LUFS/)![1]),
    truePeak: Number(summary.match(/Peak:\s+(-?[\d.]+) dBFS/)![1]),
  }
}

async function probe(path: string): Promise<{ seconds: number; width: number; height: number }> {
  const r = await run([
    `ffprobe`,
    `-v`,
    `error`,
    `-print_format`,
    `json`,
    `-show_format`,
    `-show_streams`,
    path,
  ])
  const data = JSON.parse(r.out)
  const video = data.streams.find((s: { codec_type: string }) => s.codec_type === `video`)
  return { seconds: Number(data.format.duration), width: video.width, height: video.height }
}

/** Writes an executable fake; it refuses to run inside another fake, so it can never recurse. */
async function fakeBinary(bin: string, name: string, body: string): Promise<void> {
  const path = join(bin, name)
  await Deno.writeTextFile(
    path,
    `#!/bin/sh\n[ -n "$VIDEO_CUT_FAKE" ] && exit 97\nexport VIDEO_CUT_FAKE=1\n${body}\n`,
  )
  await Deno.chmod(path, 0o755)
}

Deno.test("video:cut turns a recording into a levelled long cut, one Short, captions, a Kdenlive project and drafts, and re-renders without transcribing again", async (t) => {
  const dir = await Deno.makeTempDir({ prefix: `video-cut-flow-` })
  try {
    const clip = join(dir, `raw.mkv`)
    const out = join(dir, `cut`)
    const bin = join(dir, `bin`)
    await Deno.mkdir(bin)
    // The tone sounds while a word is spoken (0.4 s of every 0.5 s) and not in the pause or the tail.
    const tone = `0.1*sin(2*PI*220*t)*lt(mod(t,0.5),0.4)*not(between(t,19.9,23))*lt(t,77.9)`
    const fixture = await run([
      `ffmpeg`,
      `-y`,
      `-hide_banner`,
      `-loglevel`,
      `error`,
      `-f`,
      `lavfi`,
      `-i`,
      `testsrc=size=640x360:rate=25:duration=${SECONDS}`,
      `-f`,
      `lavfi`,
      `-i`,
      `aevalsrc=exprs='${tone}':s=48000:d=${SECONDS}`,
      `-c:v`,
      `libx264`,
      `-preset`,
      `ultrafast`,
      `-pix_fmt`,
      `yuv420p`,
      `-c:a`,
      `aac`,
      clip,
    ]).catch((error) => ({ code: -1, out: ``, err: String(error) }))
    expect({ fixture: fixture.code, err: fixture.err }).toEqual({ fixture: 0, err: `` })

    await Deno.writeTextFile(join(dir, `whisper.json`), whisperJson())
    await Deno.writeTextFile(join(dir, `model.bin`), `fake model`)
    await Deno.writeTextFile(
      join(dir, `reply.txt`),
      `Here:\n\`\`\`json\n${JSON.stringify(EDIT_LIST)}\n\`\`\`\n`,
    )
    // whisper-cli writes <-of>.json; each run adds a line to whisper-calls.
    await fakeBinary(
      bin,
      `whisper-cli`,
      `echo run >> "${dir}/whisper-calls"\nwhile [ $# -gt 0 ]; do [ "$1" = -of ] && of=$2; shift; done\ncp "${dir}/whisper.json" "$of.json"`,
    )
    await fakeBinary(bin, `claude`, `echo run >> "${dir}/claude-calls"\ncat "${dir}/reply.txt"`)
    const env = { PATH: `${bin}:${Deno.env.get(`PATH`)}`, WHISPER_MODEL: join(dir, `model.bin`) }
    const cut = () =>
      run([`deno`, `task`, `--quiet`, `video:cut`, clip, `demo`], { cwd: ROOT, env })
    const lines = async (name: string) =>
      (await Deno.readTextFile(join(dir, name)).catch(() => ``)).split(`\n`).filter(Boolean).length

    const first = await cut()
    expect({ code: first.code, err: first.err }).toEqual({ code: 0, err: `` })

    await t.step(
      `the long cut is the recording less the silences and the edit's cuts`,
      async () => {
        // 80 s less 2.7 + 1.9 s of silence, 0.4 s filler and 2 s retake.
        expect(Math.abs((await probe(join(out, `long.mp4`))).seconds - 73)).toBeLessThan(0.15)
      },
    )

    await t.step(
      `the one Short is 1080x1920 and as long as the edit list says after the cuts`,
      async () => {
        const short = await probe(join(out, `short.mp4`))
        expect([short.width, short.height]).toEqual([1080, 1920])
        expect(Math.abs(short.seconds - 33.3)).toBeLessThan(0.15)
        expect(
          await Array.fromAsync(Deno.readDir(out), (e) => e.name).then((n) =>
            n.filter((x) => /^short.*\.mp4$/.test(x))
          ),
        )
          .toEqual([`short.mp4`])
      },
    )

    await t.step(
      `the long cut and the Short are at -14 LUFS (±1) with a true peak at or under -1 dBTP`,
      async () => {
        for (const name of [`long.mp4`, `short.mp4`]) {
          const { integrated, truePeak } = await loudness(join(out, name))
          expect({ name, near: Math.abs(integrated + 14) <= 1, integrated }).toEqual({
            name,
            near: true,
            integrated,
          })
          expect({ name, underPeak: truePeak <= -1, truePeak }).toEqual({
            name,
            underPeak: true,
            truePeak,
          })
        }
      },
    )

    await t.step(`captions, the Kdenlive project and the drafts are written`, async () => {
      const srt = await Deno.readTextFile(join(out, `long.srt`))
      expect(srt).toContain(`1\n00:00:00,000 --> `)
      expect(/\bum\b/.test(srt)).toBe(false)
      expect(await Deno.readTextFile(join(out, `short.ass`))).toContain(`PlayResY: 1920`)
      const xml = await Deno.readTextFile(join(out, `demo.kdenlive`))
      const entries = [...xml.matchAll(/<entry producer="producer_v" in="(\d+)" out="(\d+)"\/>/g)]
      // Kept: 0–5, 5.4–20.1, 22.8–50, 52–78.1 at 25 fps.
      expect(entries.map((e) => [+e[1], +e[2]])).toEqual([[0, 124], [135, 502], [570, 1249], [
        1300,
        1951,
      ]])
      expect(await Deno.readTextFile(join(out, `titles.md`))).toBe(
        `# Title options\n\n1. First title\n2. Second title\n3. Third title\n`,
      )
      expect(await Deno.readTextFile(join(out, `description.md`))).toBe(
        `A test clip.\n\n0:00 Start\n0:26 Middle\n0:54 End\n`,
      )
      expect(await Deno.readTextFile(join(out, `transcript.md`))).toContain(`## Middle\n\n`)
    })

    await t.step(
      `a changed edit list renders again without running whisper or Claude again`,
      async () => {
        const list = JSON.parse(await Deno.readTextFile(join(out, `edit-list.json`)))
        list.cuts = list.cuts.filter((c: { reason: string }) => c.reason !== `retake`)
        await Deno.writeTextFile(join(out, `edit-list.json`), JSON.stringify(list))
        const again = await cut()
        expect({ code: again.code, err: again.err }).toEqual({ code: 0, err: `` })
        expect(again.out).toContain(`transcript: reusing`)
        expect(await lines(`whisper-calls`)).toBe(1)
        expect(await lines(`claude-calls`)).toBe(1)
        // The 2 s retake is back in.
        expect(Math.abs((await probe(join(out, `long.mp4`))).seconds - 75)).toBeLessThan(0.15)
      },
    )
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
