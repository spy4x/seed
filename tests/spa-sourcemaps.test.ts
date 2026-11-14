/// <reference lib="deno.ns" />
/**
 * The SPA's source maps reach the error tracker and never a visitor (docs/stack.md, "Source maps").
 * `apps/spa/dockerfile.prod` keeps them out of the served nginx stage and in the `sourcemaps` stage,
 * which the release pipeline skips; `apps/spa/upload-sourcemaps.sh` uploads them on a deploy and
 * never fails it. The script runs here with a fake `sentry-cli` first on `PATH`.
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"

const SCRIPT = fromFileUrl(new URL("../apps/spa/upload-sourcemaps.sh", import.meta.url))
const DOCKERFILE = fromFileUrl(new URL("../apps/spa/dockerfile.prod", import.meta.url))
const RELEASE_PIPELINE = fromFileUrl(new URL("../.woodpecker/release.yml", import.meta.url))

/**
 * Records its arguments and the variables the script exports, one per line, then exits with
 * FAKE_EXIT. It calls no other `sentry-cli`, and refuses to run inside itself.
 */
const FAKE_SENTRY_CLI = `#!/bin/sh
if [ -n "$FAKE_DEPTH" ]; then exit 99; fi
export FAKE_DEPTH=1
{
  echo "args: $*"
  echo "url: $SENTRY_URL"
  echo "token: $SENTRY_AUTH_TOKEN"
  echo "org: $SENTRY_ORG"
  echo "project: $SENTRY_PROJECT"
} > "$FAKE_LOG"
exit "\${FAKE_EXIT:-0}"
`

const SET = {
  APP_COMMIT: `0123456789abcdef0123456789abcdef01234567`,
  SOURCEMAPS_URL: `https://errors.example.com`,
  SOURCEMAPS_TOKEN: `token-for-test`,
  SOURCEMAPS_ORG: `acme`,
  SOURCEMAPS_PROJECT: `spa`,
}

interface Run {
  code: number
  stdout: string
  /** What the fake sentry-cli recorded, or undefined when the script never called it. */
  call?: string
}

/** Runs the script with exactly these variables and the fake sentry-cli. */
async function run(env: Record<string, string>, fakeExit = 0): Promise<Run> {
  // Under tests/, which the task grants: the OS temp folder moves with TMPDIR.
  const dir = await Deno.makeTempDir({
    dir: fromFileUrl(new URL(".", import.meta.url)),
    prefix: ".scratch-sourcemaps-",
  })
  try {
    await Deno.writeTextFile(`${dir}/sentry-cli`, FAKE_SENTRY_CLI, { mode: 0o755 })
    const log = `${dir}/call.log`
    const result = await new Deno.Command(`sh`, {
      args: [SCRIPT],
      clearEnv: true,
      env: { PATH: `${dir}:/usr/bin:/bin`, FAKE_LOG: log, FAKE_EXIT: String(fakeExit), ...env },
    }).output()
    const call = await Deno.readTextFile(log).catch((err) => {
      if (err instanceof Deno.errors.NotFound) return undefined
      throw err
    })
    return { code: result.code, stdout: new TextDecoder().decode(result.stdout), call }
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

Deno.test("the upload sends the maps for the commit's release with the token outside the command line", async () => {
  const result = await run(SET)

  expect(result.code).toBe(0)
  expect(result.call?.split(`\n`)).toEqual([
    `args: sourcemaps upload --release ${SET.APP_COMMIT} --url-prefix ~/ /sourcemaps`,
    `url: https://errors.example.com`,
    `token: token-for-test`,
    `org: acme`,
    `project: spa`,
    ``,
  ])
  expect(result.stdout).toContain(`uploaded for release ${SET.APP_COMMIT}`)
})

Deno.test("a deploy without the tracker's address or token uploads nothing and succeeds", async () => {
  for (const name of [`SOURCEMAPS_URL`, `SOURCEMAPS_TOKEN`]) {
    const result = await run({ ...SET, [name]: `` })
    expect({ name, code: result.code, call: result.call }).toEqual({
      name,
      code: 0,
      call: undefined,
    })
    expect(result.stdout.trim().split(`\n`)).toHaveLength(1)
  }
})

Deno.test("a deploy without the organization or project uploads nothing and succeeds", async () => {
  for (const name of [`SOURCEMAPS_ORG`, `SOURCEMAPS_PROJECT`]) {
    const result = await run({ ...SET, [name]: `` })
    expect({ name, code: result.code, call: result.call }).toEqual({
      name,
      code: 0,
      call: undefined,
    })
  }
})

Deno.test("a build without a commit uploads nothing, since its reports name no release", async () => {
  const result = await run({ ...SET, APP_COMMIT: `` })

  expect(result.code).toBe(0)
  expect(result.call).toBeUndefined()
  expect(result.stdout).toContain(`no commit`)
})

Deno.test("a failed upload does not fail the deploy and says so", async () => {
  const result = await run(SET, 1)

  expect(result.call).toBeDefined()
  expect(result.code).toBe(0)
  expect(result.stdout).toContain(`not uploaded: sentry-cli failed`)
})

/** The Dockerfile's instructions, one per entry, continuation lines joined. */
async function instructions(): Promise<string[]> {
  const text = await Deno.readTextFile(DOCKERFILE)
  return text.replace(/\\\r?\n/g, ` `).split(`\n`).map((line) => line.trim())
    .filter((line) => line !== `` && !line.startsWith(`#`))
}

/** The instructions of each stage, by its name (`AS …`) or `final` for the last one. */
async function stages(): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {}
  let current: string[] = []
  const names: string[] = []
  for (const line of await instructions()) {
    if (/^FROM\s/i.test(line)) {
      current = []
      const name = /\sAS\s+(\S+)$/i.exec(line)?.[1] ?? `unnamed-${names.length}`
      names.push(name)
      result[name] = current
    }
    current.push(line)
  }
  result.final = result[names.at(-1)!]
  return result
}

Deno.test("the served SPA image is the last stage and copies no source map", async () => {
  const { build, sourcemaps, final } = await stages()

  expect(final[0]).toContain(`nginx`)
  expect(final).not.toBe(sourcemaps)
  // The maps leave the served files in the very step that writes them, so no layer holds one.
  const buildStep = build.find((line) => line.includes(`deno task spa:build`))
  expect(buildStep).toContain(`cp -R apps/spa/dist apps/spa/sourcemaps`)
  expect(buildStep).toContain(`find apps/spa/dist -name '*.map' -delete`)
  const copies = final.filter((line) => line.startsWith(`COPY`)).join(`\n`)
  expect(copies).toContain(`/app/apps/spa/dist `)
  expect(copies).not.toContain(`sourcemaps`)
})

Deno.test("the source map stage holds the maps and gets no token at build time", async () => {
  const { sourcemaps } = await stages()

  expect(sourcemaps[0]).toMatch(
    /^FROM docker\.io\/getsentry\/sentry-cli:[\d.]+@sha256:[0-9a-f]{64} AS sourcemaps$/,
  )
  expect(sourcemaps).toContain(`COPY --from=build /app/apps/spa/sourcemaps /sourcemaps`)
  expect(sourcemaps.filter((line) => /^(ARG|ENV)\s/.test(line) && /TOKEN|SOURCEMAPS_/.test(line)))
    .toEqual([])
})

Deno.test("the SPA build writes hidden source maps, which no bundle names", async () => {
  const config = await Deno.readTextFile(
    fromFileUrl(new URL(`../apps/spa/vite.config.ts`, import.meta.url)),
  )

  expect(config).toMatch(/\n {2}build: \{[^}]*\n {4}sourcemap: `hidden`,\n/)
})

Deno.test("the release pipeline skips the source map stage, so a published image uploads nothing", async () => {
  const pipeline = await Deno.readTextFile(RELEASE_PIPELINE)
  const spa = pipeline.split(`\n`).find((line) =>
    line.includes(`--dockerfile apps/spa/dockerfile.prod`)
  )

  expect(spa).toContain(`--skip-unused-stages`)
})
