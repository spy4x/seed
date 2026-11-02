// Seed's own site: see docs/start-a-product.md
/**
 * The website's feature loops: short silent clips of the real app, light and dark, recorded by
 * `deno task loops` (`screenshots/loops.ts`). The clips are in `media/video/` (served by
 * `routes/video/[file].ts`), the posters in `static/video/`. This module imports nothing heavy, since
 * an island reads it.
 */

/** The loops, by the feature each one proves. */
export const LOOP_NAMES = [`realtime`, `offline`, `shortcuts`] as const
export type LoopName = typeof LOOP_NAMES[number]

/** The CSS size each loop is drawn and recorded at; the files are twice as wide and tall. */
export const LOOP_SIZE = { width: 720, height: 450 } as const

const THEMES = [`light`, `dark`] as const

/** Every clip file of every loop, as the video route lists them. */
export const LOOP_FILES: readonly string[] = LOOP_NAMES.flatMap((name) =>
  THEMES.flatMap((theme) => [`${name}-loop-${theme}.webm`, `${name}-loop-${theme}.mp4`])
)

/** The `type` of each clip: AV1 first, for the browsers that play it, then H.264 for the rest. */
const WEBM = `video/webm; codecs="av01.0.08M.08"`
const MP4 = `video/mp4; codecs="avc1.640028"`

/** One theme's clip files, the preferred one first. */
export function loopSources(
  name: LoopName,
  theme: typeof THEMES[number],
): { src: string; type: string }[] {
  return [
    { src: `/video/${name}-loop-${theme}.webm`, type: WEBM },
    { src: `/video/${name}-loop-${theme}.mp4`, type: MP4 },
  ]
}

/** One theme's poster files at 1× and 2×, for a `srcset`. */
export function loopPosterSrcset(name: LoopName, theme: typeof THEMES[number]): string {
  return [LOOP_SIZE.width, LOOP_SIZE.width * 2]
    .map((width) => `/video/${name}-loop-${theme}-${width}.webp ${width}w`).join(`, `)
}
