/// <reference lib="deno.ns" />
/**
 * `deno task test:integration`: the integration tests, against your Postgres and Valkey, with
 * `ENV=test` and the read grants they need.
 *
 * - No paths: runs every file in `tests/integration`.
 * - File or folder paths (`deno task test:integration tests/integration/notes.integration.test.ts`):
 *   runs only those.
 * - Arguments that start with `-` (`--parallel`, `--filter=…`) go to `deno test`.
 *
 * Exits with the exit code of `deno test`.
 */

const READS = [
  `./libs/server/db/migrations`,
  `./libs/server/db/schema.sql`,
  `./libs/server/blog/seed-posts`,
]

/** The `deno test` arguments for the task's arguments: flags pass through, no path → the folder. */
export function integrationArgs(args: string[]): string[] {
  const flags = args.filter((arg) => arg.startsWith(`-`))
  const paths = args.filter((arg) => !arg.startsWith(`-`))
  return [
    `test`,
    `--no-prompt`,
    `-E`,
    `-N`,
    `-R=${READS.join(`,`)}`,
    ...flags,
    ...paths.length ? paths : [`tests/integration`],
  ]
}

if (import.meta.main) {
  const command = new Deno.Command(`deno`, {
    args: integrationArgs(Deno.args),
    env: { ENV: `test` },
    stdin: `inherit`,
    stdout: `inherit`,
    stderr: `inherit`,
  })
  Deno.exit((await command.output()).code)
}
