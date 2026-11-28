/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import {
  applyArgs,
  assertSlug,
  buildCues,
  buildKdenlive,
  descriptionDraft,
  editBrief,
  type EditList,
  formatTimestamp,
  keepRanges,
  loudnessFilter,
  MAX_CUTS,
  MAX_REPLY_CHARS,
  MAX_WHISPER_CHARS,
  measureArgs,
  mergeRanges,
  parseArgs,
  parseClaudeReply,
  parseLoudnorm,
  parseProbe,
  parseWhisperJson,
  silenceCuts,
  titleOptions,
  toAss,
  toCutTime,
  toSrt,
  transcriptDraft,
  trimConcatGraph,
  validateEditList,
  type Word,
} from "./video-cut-lib.ts"

const tok = (text: string, from: number, to: number) => ({ text, offsets: { from, to } })

Deno.test("parseWhisperJson joins punctuation tokens to their word and skips special tokens", () => {
  const json = JSON.stringify({
    transcription: [{
      text: ` Hello, world.`,
      offsets: { from: 0, to: 1500 },
      tokens: [
        tok(`[_BEG_]`, 0, 0),
        tok(` Hello`, 100, 600),
        tok(`,`, 600, 650),
        tok(` world`, 700, 1200),
        tok(`.`, 1200, 1250),
        tok(`[_TT_75]`, 1500, 1500),
      ],
    }],
  })
  const { words, segments } = parseWhisperJson(json)
  expect(words).toEqual([
    { start: 0.1, end: 0.65, text: `Hello,` },
    { start: 0.7, end: 1.25, text: `world.` },
  ])
  expect(segments).toEqual([{ n: 1, start: 0, end: 1.5, text: `Hello, world.` }])
})

Deno.test("parseWhisperJson spreads a segment without tokens evenly over its time", () => {
  const { words } = parseWhisperJson(
    JSON.stringify({ transcription: [{ text: ` one two`, offsets: { from: 1000, to: 3000 } }] }),
  )
  expect(words).toEqual([{ start: 1, end: 2, text: `one` }, { start: 2, end: 3, text: `two` }])
})

Deno.test("parseWhisperJson says to use --output-json-full when there is no transcription", () => {
  expect(() => parseWhisperJson(`{"result":{}}`)).toThrow(`--output-json-full`)
  expect(() => parseWhisperJson(`null`)).toThrow(`--output-json-full`)
  expect(() => parseWhisperJson(`not json`)).toThrow(`not valid JSON`)
  expect(() => parseWhisperJson(`{"transcription":[]}`)).toThrow(`holds no words`)
})

Deno.test("parseWhisperJson skips malformed segments and tokens instead of crashing", () => {
  const json = JSON.stringify({
    transcription: [
      null,
      { text: 5, offsets: `x`, tokens: [null, { text: 3 }] },
      { text: ` ok`, offsets: { from: `a`, to: 500 }, tokens: [tok(` ok`, 0, 500)] },
    ],
  })
  expect(parseWhisperJson(json).words).toEqual([{ start: 0, end: 0.5, text: `ok` }])
})

Deno.test("parseWhisperJson refuses a file over the size limit before parsing it", () => {
  const huge = { length: MAX_WHISPER_CHARS + 1 } as unknown as string
  expect(() => parseWhisperJson(huge)).toThrow(`over the ${MAX_WHISPER_CHARS} limit`)
})

const words: Word[] = [
  { start: 0.1, end: 0.5, text: `a` },
  { start: 0.6, end: 1.0, text: `b` },
  { start: 3.0, end: 3.4, text: `c` },
]

Deno.test("silenceCuts cuts only gaps longer than the threshold and keeps 0.2 s each side", () => {
  expect(silenceCuts(words, 3.5, 0.8)).toEqual([{ start: 1.2, end: 2.8, reason: `silence` }])
  expect(silenceCuts(words, 3.5, 2.5)).toEqual([])
})

Deno.test("silenceCuts keeps a gap of the threshold or shorter", () => {
  const close: Word[] = [
    { start: 0, end: 0.5, text: `a` },
    { start: 1.1, end: 1.4, text: `b` }, // 0.6 s gap
    { start: 2.2, end: 2.7, text: `c` }, // 0.8 s gap, the threshold (0.8000…3 in floating point)
    { start: 3.5, end: 3.9, text: `d` }, // 0.8 s gap, the threshold (0.7999…8 in floating point)
  ]
  expect(silenceCuts(close, 3.9)).toEqual([])
})

Deno.test("silenceCuts cuts a long lead-in and a long tail", () => {
  expect(silenceCuts([{ start: 2, end: 3, text: `x` }], 10, 0.8)).toEqual([
    { start: 0, end: 1.8, reason: `silence` },
    { start: 3.2, end: 10, reason: `silence` },
  ])
})

Deno.test("keepRanges returns what the merged cuts leave inside the window", () => {
  const cuts = [{ start: 2, end: 4 }, { start: 3, end: 5 }, { start: 8, end: 9 }]
  expect(mergeRanges(cuts)).toEqual([{ start: 2, end: 5 }, { start: 8, end: 9 }])
  expect(keepRanges(cuts, 0, 10)).toEqual([
    { start: 0, end: 2 },
    { start: 5, end: 8 },
    { start: 9, end: 10 },
  ])
  expect(keepRanges(cuts, 3, 8.5)).toEqual([{ start: 5, end: 8 }])
})

Deno.test("toCutTime shifts a time by the cuts before it and moves a cut time to the next kept one", () => {
  const keeps = [{ start: 0, end: 2 }, { start: 5, end: 8 }]
  expect(toCutTime(1, keeps)).toBe(1)
  expect(toCutTime(6, keeps)).toBe(3)
  expect(toCutTime(3, keeps)).toBe(2)
})

const goodList = {
  cuts: [{ start: 5, end: 6, reason: `filler` }, { start: 20, end: 22, reason: `retake` }],
  chapters: [{ start: 0, title: `Start` }, { start: 40, title: `Later` }],
  shorts: [{ start: 10, end: 50, title: `A` }],
}
type Loose = Record<string, unknown>
const clone = () =>
  structuredClone(goodList) as unknown as {
    cuts: Loose[]
    chapters: Loose[]
    shorts: Loose[]
    titles?: unknown
    description?: unknown
  }

Deno.test("validateEditList accepts a well-formed list with one Short", () => {
  expect(validateEditList(goodList, 100).shorts.length).toBe(1)
})

Deno.test("validateEditList refuses two Shorts and none", () => {
  const two = clone()
  two.shorts.push({ start: 60, end: 95, title: `B` })
  expect(() => validateEditList(two, 100)).toThrow(`"shorts" needs exactly 1, got 2`)
  const none = clone()
  none.shorts = []
  expect(() => validateEditList(none, 100)).toThrow(`"shorts" needs exactly 1, got 0`)
})

Deno.test("validateEditList names an overlapping cut by its range", () => {
  const list = clone()
  list.cuts[1] = { start: 5.5, end: 8, reason: `filler` }
  expect(() => validateEditList(list, 100)).toThrow(
    `cuts[1] 5.5–8 s: overlaps with the range before it (5–6 s)`,
  )
})

Deno.test("validateEditList names a cut that is out of order", () => {
  const list = clone()
  list.cuts = [{ start: 20, end: 22, reason: `retake` }, { start: 5, end: 6, reason: `filler` }]
  expect(() => validateEditList(list, 100)).toThrow(`cuts[1] 5–6 s: out of order`)
})

Deno.test("validateEditList names a range outside the media and one that ends before it starts", () => {
  const list = clone()
  list.cuts = [{ start: 90, end: 120, reason: `filler` }]
  expect(() => validateEditList(list, 100)).toThrow(`cuts[0] 90–120 s: outside the media`)
  list.cuts = [{ start: 9, end: 8, reason: `filler` }]
  expect(() => validateEditList(list, 100)).toThrow(`cuts[0] 9–8 s: ends before it starts`)
})

Deno.test("validateEditList rejects a reason outside the four allowed", () => {
  const list = clone()
  list.cuts[0].reason = `boring`
  expect(() => validateEditList(list, 100)).toThrow(`cuts[0]: reason must be one of`)
})

Deno.test("validateEditList measures the Short after the cuts, silences included", () => {
  const list = clone()
  // 10–50 is 40 s; the 20–22 retake leaves 38. A silence cut over 25–58 leaves 13 s.
  expect(validateEditList(list, 100).shorts[0].end).toBe(50)
  expect(() => validateEditList(list, 100, [{ start: 25, end: 58 }])).toThrow(
    `shorts[0] 10–50 s: 13 s after the cuts, must be 30–55 s`,
  )
  list.shorts[0] = { start: 20, end: 99, title: `B` }
  expect(() => validateEditList(list, 100)).toThrow(`shorts[0] 20–99 s`)
})

Deno.test("validateEditList needs a first chapter at 0", () => {
  const list = clone()
  list.chapters[0].start = 3
  expect(() => validateEditList(list, 100)).toThrow(`chapters[0] at 3 s: the first chapter`)
})

Deno.test("validateEditList keeps three titles and a description, and refuses malformed ones", () => {
  const list = clone()
  list.titles = [`One`, `Two`, `Three`]
  list.description = `What it shows.`
  const valid = validateEditList(list, 100)
  expect(valid.titles).toEqual([`One`, `Two`, `Three`])
  expect(valid.description).toBe(`What it shows.`)
  list.titles = [`One`, ``]
  list.description = 5
  expect(() => validateEditList(list, 100)).toThrow(
    `"titles", when given, must be 3 non-empty strings`,
  )
  expect(() => validateEditList(list, 100)).toThrow(
    `"description", when given, must be a non-empty string`,
  )
})

Deno.test("validateEditList refuses more cuts than the limit without checking each", () => {
  const list = clone()
  list.cuts = Array.from(
    { length: MAX_CUTS + 1 },
    (_, i) => ({ start: i / 100, end: i / 100 + 0.005, reason: `filler` }),
  )
  expect(() => validateEditList(list, 100)).toThrow(
    `"cuts" holds ${MAX_CUTS + 1} ranges, more than ${MAX_CUTS}`,
  )
})

Deno.test("validateEditList reports a non-object as missing lists", () => {
  expect(() => validateEditList(`nope`, 100)).toThrow(`"cuts" must be a list`)
})

Deno.test("parseClaudeReply reads a bare object, a fenced block and an object amid prose", () => {
  expect(parseClaudeReply(`{"a":1}`)).toEqual({ a: 1 })
  expect(parseClaudeReply('Here it is:\n```json\n{"a":2}\n```\nDone.')).toEqual({ a: 2 })
  expect(parseClaudeReply(`Sure. {"a":{"b":3}} Hope it helps.`)).toEqual({ a: { b: 3 } })
})

Deno.test("parseClaudeReply fails on a reply with no JSON, broken JSON or too many characters", () => {
  expect(() => parseClaudeReply(`I cannot do that.`)).toThrow(`holds no JSON object`)
  expect(() => parseClaudeReply(`{"a":`)).toThrow(`holds no JSON object`)
  expect(() => parseClaudeReply(`{"a": nope}`)).toThrow(`not valid JSON`)
  expect(() => parseClaudeReply(`x`.repeat(MAX_REPLY_CHARS + 1))).toThrow(
    `over the ${MAX_REPLY_CHARS} limit`,
  )
})

Deno.test("loudnessFilter measures in the first pass and applies a linear gain from it in the second", () => {
  const measured = {
    input_i: `-23.5`,
    input_tp: `-4.2`,
    input_lra: `3.1`,
    input_thresh: `-34.0`,
    target_offset: `0.4`,
  }
  expect(loudnessFilter(false)).toBe(`loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json`)
  expect(loudnessFilter(false, measured)).toBe(
    `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=-23.5:measured_TP=-4.2:measured_LRA=3.1:measured_thresh=-34.0:offset=0.4:linear=true:print_format=summary`,
  )
  expect(loudnessFilter(true)).toMatch(/^afftdn,loudnorm=/)
  expect(loudnessFilter(true, measured)).toMatch(/^afftdn,loudnorm=.*linear=true/)
})

Deno.test("the loudness passes measure the audio alone and copy the video when applying", () => {
  const measure = measureArgs(`long.render.mp4`, false)
  expect(measure.slice(-4)).toEqual([`-vn`, `-f`, `null`, `-`])
  expect(measure).not.toContain(`error`)
  const m = {
    input_i: `-20`,
    input_tp: `-3`,
    input_lra: `2`,
    input_thresh: `-30`,
    target_offset: `0`,
  }
  const apply = applyArgs(`long.render.mp4`, `long.mp4`, false, m)
  expect(apply.join(` `)).toContain(`-c:v copy`)
  expect(apply.join(` `)).toContain(`linear=true`)
  expect(apply.at(-1)).toBe(`long.mp4`)
})

Deno.test("parseLoudnorm reads the last JSON block of ffmpeg's log", () => {
  const log =
    `[Parsed_loudnorm_0 @ 0x1] \n{\n\t"input_i" : "-21.03",\n\t"input_tp" : "-17.99",\n\t` +
    `"input_lra" : "0.00",\n\t"input_thresh" : "-31.03",\n\t"output_i" : "-14.0",\n\t` +
    `"normalization_type" : "dynamic",\n\t"target_offset" : "0.01"\n}\n`
  expect(parseLoudnorm(`noise {x} ${log}`)).toEqual({
    input_i: `-21.03`,
    input_tp: `-17.99`,
    input_lra: `0.00`,
    input_thresh: `-31.03`,
    target_offset: `0.01`,
  })
})

Deno.test("parseLoudnorm fails on a log without a measure, a missing number and silent audio", () => {
  expect(() => parseLoudnorm(`error: no audio`)).toThrow(`printed no measurement`)
  expect(() => parseLoudnorm(`{"input_i": "-20"}`)).toThrow(`no number for input_tp`)
  const silent =
    `{"input_i":"-inf","input_tp":"-inf","input_lra":"0","input_thresh":"-70","target_offset":"0"}`
  expect(() => parseLoudnorm(silent)).toThrow(`The audio is silent`)
})

Deno.test("parseProbe reads length, frame size, rate and audio, and fails without video", () => {
  const json = JSON.stringify({
    format: { duration: `101.3` },
    streams: [{ codec_type: `video`, width: 1920, height: 1080, r_frame_rate: `30000/1001` }, {
      codec_type: `audio`,
    }],
  })
  expect(parseProbe(json, `a.mkv`)).toEqual({
    seconds: 101.3,
    width: 1920,
    height: 1080,
    fpsNum: 30000,
    fpsDen: 1001,
    hasAudio: true,
  })
  expect(() => parseProbe(`{"streams":[]}`, `a.mkv`)).toThrow(`"a.mkv" has no video stream`)
  expect(() => parseProbe(`oops`, `a.mkv`)).toThrow(`ffprobe printed no JSON`)
})

Deno.test("buildCues drops words in cuts, shifts the rest onto the cut timeline and splits at sentence ends", () => {
  const w: Word[] = [
    { start: 0, end: 0.4, text: `one` },
    { start: 0.5, end: 0.9, text: `two` },
    { start: 1.0, end: 1.4, text: `three.` },
    { start: 1.5, end: 1.9, text: `cut` },
    { start: 5.0, end: 5.4, text: `four` },
  ]
  const cues = buildCues(w, [{ start: 0, end: 1.5 }, { start: 5, end: 6 }], {
    maxWords: 12,
    maxChars: 42,
  })
  expect(cues).toEqual([
    { start: 0, end: 1.4, text: `one two three.` },
    { start: 1.5, end: 1.9, text: `four` },
  ])
  expect(toSrt(cues)).toBe(
    `1\n00:00:00,000 --> 00:00:01,400\none two three.\n\n2\n00:00:01,500 --> 00:00:01,900\nfour\n`,
  )
})

Deno.test("buildCues keeps phone captions to the word and character limits", () => {
  const w: Word[] = Array.from(
    { length: 9 },
    (_, i) => ({ start: i * 0.5, end: i * 0.5 + 0.4, text: `word${i}` }),
  )
  const cues = buildCues(w, [{ start: 0, end: 10 }], { maxWords: 4, maxChars: 24 })
  expect(cues.map((c) => c.text)).toEqual([
    `word0 word1 word2 word3`,
    `word4 word5 word6 word7`,
    `word8`,
  ])
})

Deno.test("toAss sizes the caption in pixels of the video frame and strips override braces", () => {
  const ass = toAss([{ start: 1.5, end: 62.25, text: `hi {there}` }], {
    width: 1080,
    height: 1920,
    fontSize: 64,
    marginBottom: 420,
    marginSide: 60,
  })
  expect(ass).toContain(`PlayResX: 1080\nPlayResY: 1920`)
  expect(ass).toContain(`Style: Default,DejaVu Sans,64,`)
  expect(ass).toContain(`,2,60,60,420,1`)
  expect(ass).toContain(`Dialogue: 0,0:00:01.50,0:01:02.25,Default,,0,0,0,,hi there`)
})

Deno.test("trimConcatGraph trims every kept range and joins them", () => {
  const graph = trimConcatGraph([{ start: 0, end: 2 }, { start: 5, end: 8 }], true, `crop=1:1`)
  expect(graph).toContain(`[0:v]trim=start=5:end=8,setpts=PTS-STARTPTS[v1]`)
  expect(graph).toContain(`[0:a]atrim=start=5:end=8,asetpts=PTS-STARTPTS[a1]`)
  expect(graph).toContain(`[v0][a0][v1][a1]concat=n=2:v=1:a=1[vc][a]`)
  expect(graph).toContain(`[vc]crop=1:1[v]`)
  expect(trimConcatGraph([{ start: 0, end: 2 }], false)).toContain(
    `[v0]concat=n=1:v=1:a=0[vc];\n[vc]null[v]`,
  )
})

Deno.test("buildKdenlive writes the kept ranges as frame entries on a video and an audio track, plus guides", () => {
  const xml = buildKdenlive({
    title: `demo & <co>`,
    mediaPath: `/tmp/a b.mp4`,
    width: 1920,
    height: 1080,
    fpsNum: 25,
    fpsDen: 1,
    mediaSeconds: 100,
    keeps: [{ start: 0, end: 5 }, { start: 6, end: 20 }, { start: 22, end: 100 }],
    chapters: [{ start: 0, title: `Intro "x"` }, { start: 4.4, title: `Next` }],
  })
  expect(xml.startsWith(`<?xml version="1.0" encoding="utf-8"?>\n<mlt `)).toBe(true)
  // Well formed: every opening tag is closed in order.
  const stack: string[] = []
  for (const m of xml.matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
    if (m[3] === `/` || m[2] === `xml`) continue
    if (m[1] === `/`) expect(stack.pop()).toBe(m[2])
    else stack.push(m[2])
  }
  expect(stack).toEqual([])
  expect(xml).toContain(`title="demo &amp; &lt;co&gt;"`)
  expect(xml).toContain(`<property name="resource">/tmp/a b.mp4</property>`)
  for (const track of [`producer_v`, `producer_a`]) {
    const entries = [
      ...xml.matchAll(new RegExp(`<entry producer="${track}" in="(\\d+)" out="(\\d+)"/>`, `g`)),
    ]
    expect(entries.map((e) => [e[1], e[2]])).toEqual([[`0`, `124`], [`150`, `499`], [
      `550`,
      `2499`,
    ]])
  }
  // Cut length: 125 + 350 + 1950 frames.
  expect(xml).toContain(`<tractor id="tractor_main" in="0" out="2424">`)
  const guides = xml.match(/docproperties\.guides">([^<]*)</)![1].replaceAll(`&quot;`, `"`)
  expect(JSON.parse(guides)).toEqual([
    { comment: `Intro "x"`, pos: 0, type: 0 },
    { comment: `Next`, pos: 110, type: 0 },
  ])
})

Deno.test("editBrief lists numbered segments, asks for one Short, titles and a description, and JSON only", () => {
  const brief = editBrief(
    [{ n: 1, start: 0, end: 4.5, text: `Hello there.` }, { n: 2, start: 5, end: 9, text: `Next.` }],
    [{ start: 1, end: 2, reason: `silence` }],
    120,
  )
  expect(brief).toContain(`[1] 0.0–4.5 s  Hello there.`)
  expect(brief).toContain(`[2] 5.0–9.0 s  Next.`)
  for (const reason of [`filler`, `retake`, `off-topic`]) expect(brief).toContain(`\`${reason}\``)
  expect(brief).toContain(`exactly 1 self-contained moment`)
  expect(brief).toContain(`30–55 s`)
  expect(brief).toContain(`\`titles\`: 3 title options`)
  expect(brief).toContain(`\`description\``)
  expect(brief).toContain(`one JSON object`)
})

Deno.test("assertSlug rejects a slug that names another folder", () => {
  for (const bad of [``, `../x`, `a/b`, `a\\b`, `..`, `x..y`]) {
    expect(() => assertSlug(bad)).toThrow(`must be one plain name`)
  }
  assertSlug(`my-video-2`)
})

Deno.test("parseArgs reads the recording, the slug and every option", () => {
  expect(parseArgs([`raw.mkv`, `demo`])).toEqual({
    recording: `raw.mkv`,
    slug: `demo`,
    claude: true,
    denoise: false,
    minSilence: 0.8,
  })
  expect(
    parseArgs([
      `raw.mkv`,
      `demo`,
      `--out`,
      `/tmp/x`,
      `--no-claude`,
      `--denoise`,
      `--min-silence`,
      `1.5`,
    ]),
  )
    .toEqual({
      recording: `raw.mkv`,
      slug: `demo`,
      out: `/tmp/x`,
      claude: false,
      denoise: true,
      minSilence: 1.5,
    })
})

Deno.test("parseArgs refuses a missing slug, an unknown option, a short silence and a bad slug", () => {
  expect(() => parseArgs([`raw.mkv`])).toThrow(`Usage: deno task video:cut`)
  expect(() => parseArgs([`raw.mkv`, `demo`, `--burn`])).toThrow(`Unknown option "--burn"`)
  expect(() => parseArgs([`raw.mkv`, `demo`, `--min-silence`, `0.1`])).toThrow(
    `at least 0.3 seconds`,
  )
  expect(() => parseArgs([`raw.mkv`, `demo`, `--min-silence`])).toThrow(`at least 0.3 seconds`)
  expect(() => parseArgs([`raw.mkv`, `demo`, `--out`])).toThrow(`--out needs a directory`)
  expect(() => parseArgs([`raw.mkv`, `../up`])).toThrow(`must be one plain name`)
})

Deno.test("formatTimestamp matches YouTube's chapter format", () => {
  expect([0, 134.9, 3734].map(formatTimestamp)).toEqual([`0:00`, `2:14`, `1:02:14`])
})

const list: EditList = {
  cuts: [],
  chapters: [{ start: 0, title: `Start here` }, { start: 30, title: `The fix` }],
  shorts: [{ start: 0, end: 40, title: `The short title` }],
}

Deno.test("titleOptions uses Claude's titles, else three drafts from the transcript and the edit list", () => {
  expect(titleOptions({ ...list, titles: [`A`, `B`, `C`] }, `whatever`)).toEqual([`A`, `B`, `C`])
  expect(titleOptions(list, `Hi. This sentence is long enough to title. Short.`)).toEqual([
    `This sentence is long enough to title.`,
    `The short title`,
    `Start here`,
  ])
})

Deno.test("descriptionDraft ends with the chapters as YouTube timestamps", () => {
  const chapters = [{ start: 0, title: `Start here` }, { start: 75.4, title: `The fix` }]
  expect(descriptionDraft(list, `One. Two. Three. Four.`, chapters)).toBe(
    `One. Two. Three.\n\n0:00 Start here\n1:15 The fix\n`,
  )
  expect(descriptionDraft({ ...list, description: `Claude's.` }, `One.`, chapters)).toMatch(
    /^Claude's\.\n\n0:00/,
  )
})

Deno.test("transcriptDraft puts the cut's words under their chapter titles", () => {
  const w: Word[] = [
    { start: 0, end: 1, text: `Hello` },
    { start: 1, end: 2, text: `there.` },
    { start: 31, end: 32, text: `Fixed.` },
  ]
  expect(transcriptDraft(`demo`, w, list.chapters)).toBe(
    `# demo: transcript of the cut\n\n## Start here\n\nHello there.\n\n## The fix\n\nFixed.\n`,
  )
})
