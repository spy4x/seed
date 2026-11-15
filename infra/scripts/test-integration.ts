/// <reference lib="deno.ns" />
/**
 * `deno task test:integration`: the integration tests, against your Postgres and Valkey, with
 * `ENV=test` and the read grants they need.
 *
 * - No paths: runs every file in `tests/integration`. On a Woodpecker pull request, only those
 *   whose imports reach a change (`relatedFlags` in `test.ts`), and says how many it skipped.
 * - File or folder paths (`deno task test:integration tests/integration/notes.integration.test.ts`):
 *   runs only those.
 * - Arguments that start with `-` (`--parallel`, `--filter=…`) go to `deno test`.
 *
 * Exits with the exit code of `deno test`.
 */
import { filesLine, filesRun, relatedFlags, testFiles } from "./test.ts"

/** What the tests read from disk; each is in `RUN_ALL`, so a change to it runs every test. */
export const READS = [
  `libs/server/db/migrations`,
  `libs/server/db/schema.sql`,
  `libs/server/blog/seed-posts`,
]

const FOLDER = `tests/integration`

/**
 * The `deno test` arguments for the task's arguments: flags pass through, no path → the folder,
 * limited by the `related` flags.
 */
export function integrationArgs(args: string[], related: string[] = []): string[] {
  const flags = args.filter((arg) => arg.startsWith(`-`))
  const paths = args.filter((arg) => !arg.startsWith(`-`))
  return [
    `test`,
    `--no-prompt`,
    `-E`,
    `-N`,
    `-R=${READS.map((path) => `./${path}`).join(`,`)}`,
    ...flags,
    ...paths.length ? paths : [...related, FOLDER],
  ]
}

if (import.meta.main) {
  const explicit = Deno.args.some((arg) => !arg.startsWith(`-`))
  const related = explicit ? [] : await relatedFlags(`test:integration`)
  const child = new Deno.Command(`deno`, {
    args: integrationArgs(Deno.args, related),
    env: { ENV: `test` },
    stdin: `inherit`,
    stdout: related.length ? `piped` : `inherit`,
    stderr: `inherit`,
  }).spawn()
  if (related.length) {
    // Shown as it comes, and kept to count the files that ran.
    const [shown, kept] = child.stdout.tee()
    const [output] = await Promise.all([
      new Response(kept).text(),
      shown.pipeTo(Deno.stdout.writable, { preventClose: true }),
    ])
    const total = (await testFiles()).filter((file) => file.startsWith(`${FOLDER}/`)).length
    console.log(filesLine(`test:integration`, filesRun(output), total))
  }
  Deno.exit((await child.status).code)
}
