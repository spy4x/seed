/** The shape of lighthouserc.json that the quick run reads and changes. */
export interface LighthouseConfig {
  ci: {
    collect: { url: string[]; numberOfRuns: number; [key: string]: unknown }
    [key: string]: unknown
  }
}

/**
 * The pages a pull request measures (`LIGHTHOUSE_PAGES=quick` in run.sh, #876): one of each
 * template the website renders. The home page, the pricing table, a blog post and the docs index.
 * Every path must also be in lighthouserc.json, which a push to `main` and a tag measure in full.
 */
export const QUICK_PATHS = [`/`, `/pricing`, `/blog/how-the-website-speed-check-works`, `/docs`]

/**
 * Turns the full configuration into the pull-request one: only the {@link QUICK_PATHS}, one run
 * each, with the same assertions and settings. Throws when a quick path is missing from the full
 * list, so the two lists cannot drift apart.
 */
export function quickConfig(full: LighthouseConfig): LighthouseConfig {
  const url = QUICK_PATHS.map((path) => {
    const found = full.ci.collect.url.find((candidate) => new URL(candidate).pathname === path)
    if (!found) throw new Error(`${path} is in QUICK_PATHS but not in lighthouserc.json`)
    return found
  })
  return { ...full, ci: { ...full.ci, collect: { ...full.ci.collect, url, numberOfRuns: 1 } } }
}

// `deno run quick.ts <full config> <output>`: writes the quick configuration for run.sh.
if (import.meta.main) {
  const [source, output] = Deno.args
  const full = JSON.parse(await Deno.readTextFile(source)) as LighthouseConfig
  await Deno.writeTextFile(output, JSON.stringify(quickConfig(full), null, 2))
}
