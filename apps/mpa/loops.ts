// Seed's own site: see docs/start-a-product.md
/**
 * The website's feature loops: short silent clips of the real app, recorded once, in the dark
 * theme, by `deno task loops` (`screenshots/loops.ts`), and shown in both page themes. The clips
 * are in `media/video/` (served by `routes/video/[file].ts`), the posters in `static/video/`.
 */

/** The loops, by the feature each one proves. */
export const LOOP_NAMES = [`realtime`, `offline`, `shortcuts`] as const
export type LoopName = typeof LOOP_NAMES[number]

/** The CSS size each loop is drawn and recorded at; the files are twice as wide and tall. */
export const LOOP_SIZE = { width: 720, height: 450 } as const

/** Every clip file of every loop, as the video route lists them. */
export const LOOP_FILES: readonly string[] = LOOP_NAMES.flatMap((name) => [
  `${name}-loop-dark.webm`,
  `${name}-loop-dark.mp4`,
])

/** The `type` of each clip: AV1 first, for the browsers that play it, then H.264 for the rest. */
const WEBM = `video/webm; codecs="av01.0.08M.08"`
const MP4 = `video/mp4; codecs="avc1.640028"`

/** A loop's clip files, the preferred one first. */
export function loopSources(name: LoopName): { src: string; type: string }[] {
  return [
    { src: `/video/${name}-loop-dark.webm`, type: WEBM },
    { src: `/video/${name}-loop-dark.mp4`, type: MP4 },
  ]
}

/** A loop's poster files at 1× and 2×, for a `srcset`. */
export function loopPosterSrcset(name: LoopName): string {
  return [LOOP_SIZE.width, LOOP_SIZE.width * 2]
    .map((width) => `/video/${name}-loop-dark-${width}.webp ${width}w`).join(`, `)
}
