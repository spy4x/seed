/**
 * Makes the cover of one of Seed's blog posts: `deno task blog:cover <slug> <scene>`. It asks the
 * OpenAI Images API for one picture in the house style below plus the scene, and writes
 * `<slug>.webp` (1600×900), `<slug>-960.webp` (960×540, for phones) and `<slug>-640.webp`
 * (640×360, for the post list) beside this file.
 * The key comes from `OPENAI_API_KEY`. How to use it and the alt text of every cover: README.md.
 */
import { fromFileUrl } from "@std/path"
import type { EnvReader, FileSystemPort, RunCommandResult } from "@spy4x/platform/server"
import { processArgs, processEnv, runCommand, runtimeFileSystem } from "@spy4x/platform/server"

/** The image model. `gpt-image-2` was the newest stable one the key could use on 2026-11-04. */
export const COVER_MODEL = `gpt-image-2`

/** The landscape size asked for; the script crops it to 16:9. */
export const SOURCE_SIZE = `1536x1024`

/** What every cover looks like, so the set reads as one. The scene is added after it. */
export const HOUSE_STYLE = [
  `An editorial illustration for the blog of Seed, a free software starter kit.`,
  `Style: flat vector shapes in a gentle isometric perspective, clean geometric forms, soft`,
  `paper grain, subtle soft shadows, generous empty space, calm and modern, like the cover art`,
  `of a premium technology magazine. One clear subject, slightly right of centre, in a wide`,
  `16:9 framing, with nothing important near the top or bottom edge.`,
  `Palette: one accent hue, deep violet (#59168B), with its lighter lavender tints, on a calm`,
  `muted lavender-grey background, plus warm neutral greys and charcoal. No other saturated`,
  `colour.`,
  `Never: text, letters, numbers, words, labels, signs, logos, brand marks, code, screenshots,`,
  `user-interface mockups, people, faces, hands, cartoon characters, memes, photorealism.`,
].join(` `)

/** The full prompt for one cover: the house style, then the post's scene. */
export function coverPrompt(scene: string): string {
  return `${HOUSE_STYLE}\n\nScene: ${scene.trim()}`
}

/** What a run needs from the outside world, so a test can stand in for each part. */
export interface CoverDeps {
  env: EnvReader
  fetch: typeof fetch
  fs: FileSystemPort
  run: (command: readonly string[]) => Promise<RunCommandResult>
  /** The folder the covers are written to. */
  dir: string
}

/** Thrown for a run that cannot make a cover: bad input, no key, or a failed call or resize. */
export class CoverError extends Error {}

/**
 * Generates the cover of `slug` from `scene` and writes both WebP files into `deps.dir`. Answers
 * the two paths. The API's PNG goes to a temporary file in the same folder, removed at the end.
 */
export async function makeCover(slug: string, scene: string, deps: CoverDeps): Promise<string[]> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    throw new CoverError(`The slug must be lowercase words joined by hyphens: ${slug}`)
  }
  if (!scene.trim()) throw new CoverError(`Describe the scene after the slug.`)
  const key = deps.env.get(`OPENAI_API_KEY`)
  if (!key) throw new CoverError(`Set OPENAI_API_KEY to make a cover.`)

  const response = await deps.fetch(`https://api.openai.com/v1/images/generations`, {
    method: `POST`,
    headers: { authorization: `Bearer ${key}`, "content-type": `application/json` },
    body: JSON.stringify({
      model: COVER_MODEL,
      prompt: coverPrompt(scene),
      size: SOURCE_SIZE,
      quality: `high`,
      output_format: `png`,
      n: 1,
    }),
  })
  const body = await response.json().catch(() => null)
  const b64: unknown = body?.data?.[0]?.b64_json
  if (!response.ok || typeof b64 !== `string`) {
    const reason = body?.error?.message ?? `no image in the answer`
    throw new CoverError(`The Images API answered ${response.status}: ${reason}`)
  }

  const source = `${deps.dir}/.${slug}.source.png`
  const outputs = [
    [`${slug}.webp`, `1600x900`],
    [`${slug}-960.webp`, `960x540`],
    [`${slug}-640.webp`, `640x360`],
  ]
  await deps.fs.writeBytes!(source, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
  try {
    for (const [name, size] of outputs) {
      // Fill the size, crop the overflow from the middle, drop all metadata.
      const result = await deps.run([
        `magick`,
        source,
        `-resize`,
        `${size}^`,
        `-gravity`,
        `center`,
        `-extent`,
        size,
        `-strip`,
        `-quality`,
        `80`,
        `${deps.dir}/${name}`,
      ])
      if (!result.success) throw new CoverError(`magick failed for ${name}: ${result.stderr}`)
    }
  } finally {
    await deps.fs.remove(source)
  }
  return outputs.map(([name]) => `${deps.dir}/${name}`)
}

// `import.meta.main` is set on Deno, Bun and Node 24; this library's types leave it out.
if ((import.meta as ImportMeta & { main?: boolean }).main) {
  const [slug = ``, ...scene] = processArgs()
  const written = await makeCover(slug, scene.join(` `), {
    env: processEnv,
    fetch,
    fs: runtimeFileSystem,
    run: (command) => runCommand(command, { signal: AbortSignal.timeout(60_000) }),
    dir: fromFileUrl(new URL(`.`, import.meta.url)).replace(/\/$/, ``),
  })
  console.log(written.join(`\n`))
}
