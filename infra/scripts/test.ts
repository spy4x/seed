/// <reference lib="deno.ns" />
/**
 * `deno task test`: the unit tests, in groups that each run `deno test --parallel` with only the
 * permissions their files need, two groups at a time. A serial group runs alone at the end.
 *
 * - No arguments: a passing run prints one summary line. A failing group prints its failures,
 *   with the output of the failed tests, and the command that runs it again.
 * - `CI=true` or `--verbose`: every group's whole output, as `deno test` prints it.
 * - File or folder paths (`deno task test apps/api/routes/auth.test.ts --filter=429`): runs them
 *   with their group's permissions and prints everything. Other `-` arguments go to `deno test`.
 */

/** One `deno test` run: its permission flags and the files and folders it tests. */
export interface TestGroup {
  flags: string[]
  paths: string[]
  /** Paths under `paths` that another group tests. */
  ignore?: string[]
  /** Runs without `--parallel`, alone, once every other group is done. */
  serial?: boolean
}

/**
 * Tests that count timer turns or measure wall time, and fail when other test workers take the CPU.
 * They run in the serial group below.
 */
const TIMING_SENSITIVE = [
  `apps/api/routes/group-files.test.ts`,
  `apps/spa/src/offline/OfflineStatus.test.tsx`,
  `apps/spa/src/offline/index.test.ts`,
]

/**
 * libs/ui's interaction tests load happy-dom, whose WebSocket package reads the two WS_* variables;
 * the blog's tests read Seed's own posts.
 */
const APP_FLAGS = [
  `--allow-env=WS_NO_BUFFER_UTIL,WS_NO_UTF_8_VALIDATE`,
  `--allow-read=libs/server/blog/seed-posts`,
]

export const GROUPS: TestGroup[] = [
  {
    flags: APP_FLAGS,
    paths: [
      `apps/api`,
      `apps/spa/src`,
      `apps/admin/src`,
      `apps/worker`,
      `apps/healthcheck.test.ts`,
      `libs`,
      `e2e/fixtures`,
    ],
    ignore: TIMING_SENSITIVE,
  },
  { flags: APP_FLAGS, paths: TIMING_SENSITIVE, serial: true },
  // Fresh reads its build id from DENO_DEPLOYMENT_ID, GITHUB_SHA or CI_COMMIT_SHA when it loads.
  {
    flags: [
      `--allow-env=DENO_DEPLOYMENT_ID,GITHUB_SHA,CI_COMMIT_SHA`,
      `--allow-read=.`,
    ],
    paths: [`apps/mpa`],
    ignore: [`apps/mpa/changelog-start.test.ts`],
  },
  {
    flags: [`--allow-read`, `--allow-write`, `--allow-run=git`],
    paths: [`apps/mpa/changelog-start.test.ts`],
  },
  // Each test below reads files, so it runs with its own read grant.
  {
    flags: [`--allow-read=apps,libs`],
    paths: [`tests/spacing.test.ts`, `tests/test-catalog-boundary.test.ts`],
  },
  {
    flags: [`--allow-read=apps,libs/ui`],
    paths: [`tests/ui-boundary.test.ts`, `tests/no-direct-date-format.test.ts`],
  },
  {
    flags: [`--allow-read=apps/api`],
    paths: [
      `tests/api-error-shape.test.ts`,
      `tests/api-spa-switch.test.ts`,
      `tests/api-notes-switch.test.ts`,
    ],
  },
  {
    flags: [
      `--allow-read=deno.jsonc,Dockerfile.base,apps/api/dockerfile.node,apps/api/dockerfile.bun,apps/mpa/dockerfile.node,apps/mpa/dockerfile.bun`,
    ],
    paths: [`tests/dockerfile-base.test.ts`],
  },
  {
    flags: [`--allow-read=.dockerignore,.gitignore,infra/deploy/include.txt`],
    paths: [`tests/dockerignore.test.ts`, `tests/gitignore.test.ts`],
  },
  {
    flags: [`--allow-read=infra/compose,apps/worker/+main.ts`],
    paths: [
      `tests/compose-migrate.test.ts`,
      `tests/compose-mpa.test.ts`,
      `tests/compose-api-env.test.ts`,
      `tests/compose-exposure.test.ts`,
      `tests/compose-admin.test.ts`,
      `tests/compose-runtime.test.ts`,
    ],
  },
  {
    flags: [
      `--allow-read=infra/compose,infra/postgres,infra/envs/.env.example,infra/scripts/e2e-local.sh,.woodpecker/ci.yml,docs/handoff.md,docs/woodpecker-ci-setup.md`,
    ],
    paths: [`tests/compose-postgres.test.ts`],
  },
  {
    flags: [
      `--allow-read=infra/compose,infra/configs,infra/backup`,
      `--allow-run=sh`,
    ],
    paths: [
      `tests/compose-monitoring.test.ts`,
      `tests/monitoring-alerts.test.ts`,
    ],
  },
  {
    flags: [`--allow-read=libs/server/db/migrations`],
    paths: [`tests/migration-names.test.ts`],
  },
  {
    flags: [`--allow-read=docs`],
    paths: [`tests/docs-map.test.ts`],
  },
  // infra/scripts is left out of the other tools (deno.jsonc "exclude"); its tests run here.
  {
    flags: [
      `--allow-read=infra/envs,infra/compose/compose.shared.yml,deno.jsonc,tests`,
      `--allow-write=tests`,
      `--allow-run=git`,
    ],
    paths: [`infra/scripts`],
  },
  {
    flags: [`--allow-read`, `--allow-write`, `--allow-env`, `--allow-run=deno`],
    paths: [`tests/db-reset-main.test.ts`],
  },
  {
    flags: [`--allow-read=apps/spa,docs/offline.md`],
    paths: [`tests/offline-removal.test.ts`],
  },
  {
    flags: [`--allow-read=apps/spa`],
    paths: [`tests/realtime-removal.test.ts`, `tests/spa-reads.test.ts`],
  },
  {
    flags: [
      `--allow-read=apps/spa,tests`,
      `--allow-write=tests`,
      `--allow-run=sh`,
    ],
    paths: [`tests/spa-runtime-config.test.ts`],
  },
  {
    flags: [
      `--allow-read=.woodpecker/ci.yml,e2e,docs/browser-tests.md,docs/woodpecker-ci-setup.md`,
    ],
    paths: [`tests/ci-browser-tests.test.ts`],
  },
  // Reads every file git tracks (docs/ids.md), which `git ls-files` lists.
  {
    flags: [`--allow-read=.`, `--allow-write=tests`, `--allow-run=git`],
    paths: [`tests/no-uuid-v4.test.ts`],
  },
  { flags: [`--allow-read=apps,libs,e2e`], paths: [`tests/no-issue-numbers-in-comments.test.ts`] },
  {
    flags: [`--allow-read=.`, `--allow-env`, `--allow-sys`],
    paths: [`tests/playwright-retries.test.ts`],
  },
  // Looks for Dockerfiles in every directory.
  { flags: [`--allow-read=.`], paths: [`tests/dockerfiles.test.ts`] },
  { flags: [], paths: [`tests/load/group-plan.test.ts`] },
  // The catalogs, and the apps' and libraries' sources for the keys they name.
  { flags: [`--allow-read=i18n,apps,libs`], paths: [`i18n`] },
]

/** The `deno test` arguments of a group, for the given paths (all of the group's by default). */
export function testArgs(
  group: TestGroup,
  paths = group.paths,
  extra: string[] = [],
): string[] {
  const ignore = group.ignore?.length ? [`--ignore=${group.ignore.join(`,`)}`] : []
  return [
    `test`,
    `--no-prompt`,
    ...group.serial ? [] : [`--parallel`],
    ...group.flags,
    ...ignore,
    ...extra,
    ...paths,
  ]
}

function covers(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`)
}

/** The group whose paths hold `path` and do not ignore it. Undefined when no group tests it. */
export function groupOf(path: string): TestGroup | undefined {
  const clean = path.replace(/^\.\//, ``).replace(/\/$/, ``)
  return GROUPS.find((group) =>
    group.paths.some((root) => covers(root, clean)) &&
    !group.ignore?.some((ignored) => covers(ignored, clean))
  )
}

/** Test and step counts read from `deno test` summary lines. */
export interface Totals {
  passed: number
  failed: number
  ignored: number
  steps: number
}

const ANSI = /\x1b\[[0-9;]*m/g

/** Adds up the counts of every `ok | … passed …` or `FAILED | …` line in `output`. */
export function totalsOf(output: string): Totals {
  const totals: Totals = { passed: 0, failed: 0, ignored: 0, steps: 0 }
  for (const line of output.replace(ANSI, ``).split(`\n`)) {
    if (!/^(ok|FAILED) \| /.test(line)) continue
    for (
      const [, count, kind, steps] of line.matchAll(
        /(\d+) (passed|failed|ignored)(?: \((\d+) steps?\))?/g,
      )
    ) {
      totals[kind as `passed` | `failed` | `ignored`] += Number(count)
      if (kind === `passed`) totals.steps += Number(steps ?? 0)
    }
  }
  return totals
}

const PASSED = / \.\.\. ok \(/
const BLOCK_START = /^------- (post-test )?output -------$/
const BLOCK_END = /^----- (post-test )?output end -----$/

/**
 * The output of a failed group without what passed: the result lines of passing tests and steps,
 * the output those tests printed, the "running N tests" headers and the "Check" lines. Failed tests,
 * their output,
 * the ERRORS section and anything else stay.
 */
export function failuresOf(output: string): string {
  // Lines, with each output block gathered into one entry; a block belongs to the result line
  // that follows it.
  const entries: string[][] = []
  let block: string[] | undefined
  for (const line of output.split(`\n`)) {
    const plain = line.replace(ANSI, ``)
    if (block) {
      block.push(line)
      if (BLOCK_END.test(plain)) block = undefined
    } else if (BLOCK_START.test(plain)) entries.push(block = [line])
    else entries.push([line])
  }
  const kept = entries.filter((entry, index) => {
    const plain = entry[0].replace(ANSI, ``)
    if (entry.length > 1 || BLOCK_START.test(plain)) {
      const result = entries.slice(index + 1).find((next) => next.length === 1)?.[0] ?? ``
      return !PASSED.test(result.replace(ANSI, ``))
    }
    return !PASSED.test(plain) && !/ \.\.\.$/.test(plain) && !/^Check /.test(plain) &&
      !/^running \d+ tests? from /.test(plain)
  })
  return kept.flat().join(`\n`).replace(/\n{3,}/g, `\n\n`).trim()
}

/**
 * Runs `deno <args>` and returns whether it passed, and its stdout and then its stderr. A run still
 * going after two minutes is named once, so a hung test shows where it hangs.
 */
async function capture(args: string[]): Promise<{ success: boolean; output: string }> {
  const slow = setTimeout(
    () => console.log(`Still running after 2 min: deno ${args.join(` `)}`),
    120_000,
  )
  const { success, stdout, stderr } = await new Deno.Command(`deno`, { args }).output()
  clearTimeout(slow)
  const decoder = new TextDecoder()
  return { success, output: decoder.decode(stdout) + decoder.decode(stderr) }
}

/**
 * Groups run at once. Each already runs its files on every core (`--parallel`); two at a time
 * hides the small groups' start-up behind the large one without starving it.
 */
const JOBS = 2

/** Runs `tasks` with at most `limit` at a time and returns their results in order. */
async function pool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = []
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++
      results[index] = await tasks[index]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}

/** Runs the given paths, each with its group's permissions, printing everything as it comes. */
async function runPaths(paths: string[], extra: string[]): Promise<number> {
  const runs = new Map<TestGroup, string[]>()
  for (const path of paths) {
    const group = groupOf(path)
    if (!group) {
      console.error(`No test group covers ${path}; the groups are in infra/scripts/test.ts.`)
      return 2
    }
    runs.set(group, [...runs.get(group) ?? [], path])
  }
  let code = 0
  for (const [group, groupPaths] of runs) {
    const { success } = await new Deno.Command(`deno`, { args: testArgs(group, groupPaths, extra) })
      .spawn().status
    if (!success) code = 1
  }
  return code
}

/** Runs every group, a few at a time, and prints failures and one summary line, or everything. */
async function runAll(extra: string[], verbose: boolean): Promise<number> {
  const started = performance.now()
  const run = (group: TestGroup) => () => capture(testArgs(group, group.paths, extra))
  const parallel = GROUPS.filter((group) => !group.serial)
  const serial = GROUPS.filter((group) => group.serial)
  const results = await pool(parallel.map(run), JOBS)
  for (const group of serial) results.push(await run(group)())
  const order = [...parallel, ...serial]
  let failed = 0
  results.forEach(({ success, output }, index) => {
    if (verbose) console.log(output)
    if (success) return
    if (!verbose) console.log(failuresOf(output))
    failed++
    console.log(`\nFailed: deno ${testArgs(order[index], order[index].paths, extra).join(` `)}\n`)
  })
  const totals = totalsOf(results.map(({ output }) => output).join(`\n`))
  const seconds = Math.round((performance.now() - started) / 1000)
  const counts = `${totals.passed} passed (${totals.steps} steps) | ${totals.failed} failed` +
    (totals.ignored ? ` | ${totals.ignored} ignored` : ``)
  console.log(
    failed
      ? `test: FAILED | ${counts} | ${failed} of ${GROUPS.length} groups failed | ${seconds}s`
      : `test: ok | ${counts} | ${GROUPS.length} groups | ${seconds}s`,
  )
  if (failed) console.log(`One file with all its output: deno task test <file>`)
  return failed ? 1 : 0
}

if (import.meta.main) {
  const verbose = Deno.args.includes(`--verbose`) || Deno.env.get(`CI`) === `true`
  const extra = Deno.args.filter((arg) => arg.startsWith(`-`) && arg !== `--verbose`)
  const paths = Deno.args.filter((arg) => !arg.startsWith(`-`))
  Deno.exit(paths.length ? await runPaths(paths, extra) : await runAll(extra, verbose))
}
