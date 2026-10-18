/// <reference lib="deno.ns" />
/**
 * Decides which Playwright passes one `deno task e2e:local` makes, and against what: the specs
 * that start the app with no network run against the built SPA, every other spec against the dev
 * server (docs/offline.md, "The app shell"). `e2e-local.sh` runs this file with the value of
 * `E2E_SPA` (or an empty string) and its own arguments, and reads the plan from standard output.
 */

/** What serves the SPA during a pass. */
export type Server = `dev` | `built`

/** Which spec files a pass may see: all of them, the offline ones, or all but the offline ones. */
export type Specs = `all` | `offline` | `other`

/** One run of Playwright. */
export interface Pass {
  server: Server
  specs: Specs
  /** The arguments for `playwright test`, spec paths already as Playwright must get them. */
  args: string[]
}

/** The specs that load a page with the network cut. */
export const OFFLINE_SPECS = [`offline.e2e.ts`, `local-data.e2e.ts`, `search-offline.e2e.ts`]

/**
 * The smoke set: the specs CI runs on every pull request (`.woodpecker/ci.yml`, step `e2e-smoke`),
 * and `deno task e2e:local --smoke` here. The whole suite runs after the merge, on `main`. A spec
 * joins the set with one line here; before you add one, run it ten times in a row
 * (`deno task e2e:local e2e/<spec> --repeat-each=10`): a spec that fails once on a healthy branch
 * blocks every pull request.
 */
export const SMOKE_SPECS = [
  `auth-profile-ws-push.e2e.ts`, // sign-up over the API, sign-in, the profile, sign-out
  `sign-in-next.e2e.ts`, // sign-in from a link, with and without a one-time code
  `notes.e2e.ts`, // a note created, edited and deleted; what a viewer may do
  `profile-two-tabs.e2e.ts`, // the profile saved in one tab shows in another
  `groups-pages.e2e.ts`, // a group created, renamed, deleted and restored
  `url-filters.e2e.ts`, // the address filters of the pinned library follow back and forward
]

/** The argument that stands for the specs of {@link SMOKE_SPECS}. */
export const SMOKE_FLAG = `--smoke`

const baseName = (path: string): string => path.slice(path.lastIndexOf(`/`) + 1)

/**
 * The passes of one run, in the order they are made.
 *
 * `--smoke` stands for the specs of {@link SMOKE_SPECS}, as if each were named.
 * An argument is a spec when the part before its first colon ends in `.e2e.ts` and `isSpecFile`
 * finds that file; `e2e/notes.e2e.ts:42` becomes `notes.e2e.ts:42`, because Playwright matches it
 * against the path of the harness's copy. Every other argument goes to every pass as it is.
 *
 * - `forced` set: one pass on that server with every argument, in the order given.
 * - No spec named: every other spec on the dev server, then the offline specs on the built SPA.
 * - Specs named: a pass on the dev server when a spec that is not offline is named, then a pass
 *   on the built SPA when an offline one is, each with its own specs.
 */
export function planPasses(
  args: string[],
  forced: Server | undefined,
  isSpecFile: (path: string) => boolean,
): Pass[] {
  const other: string[] = []
  const offline: string[] = []
  const shared: string[] = []
  const all: string[] = []
  const named = args.flatMap((arg) =>
    arg === SMOKE_FLAG ? SMOKE_SPECS.map((name) => `e2e/${name}`) : [arg]
  )
  for (const arg of named) {
    const file = arg.split(`:`)[0]
    if (!file.endsWith(`.e2e.ts`) || !isSpecFile(file)) {
      shared.push(arg)
      all.push(arg)
      continue
    }
    const name = baseName(file)
    const forPlaywright = name + arg.slice(file.length)
    if (OFFLINE_SPECS.includes(name)) offline.push(forPlaywright)
    else other.push(forPlaywright)
    all.push(forPlaywright)
  }
  if (forced) return [{ server: forced, specs: `all`, args: all }]
  const noneNamed = other.length + offline.length === 0
  const passes: Pass[] = []
  if (noneNamed || other.length > 0) {
    passes.push({ server: `dev`, specs: `other`, args: [...other, ...shared] })
  }
  if (noneNamed || offline.length > 0) {
    passes.push({ server: `built`, specs: `offline`, args: [...offline, ...shared] })
  }
  return passes
}

/**
 * The plan as `e2e-local.sh` reads it: a `pass <server> <specs>` line for each pass, followed by
 * one `arg <argument>` line for each of its arguments.
 */
export function planLines(passes: Pass[]): string[] {
  return passes.flatMap((pass) => [
    `pass ${pass.server} ${pass.specs}`,
    ...pass.args.map((arg) => `arg ${arg}`),
  ])
}

if (import.meta.main) {
  const [forced, ...args] = Deno.args
  if (forced !== `` && forced !== `dev` && forced !== `built`) {
    console.error(`E2E_SPA is "${forced}"; it must be dev or built`)
    Deno.exit(1)
  }
  if (args.some((arg) => /[\r\n]/.test(arg))) {
    console.error(`an argument holds a line break`)
    Deno.exit(1)
  }
  const isSpecFile = (path: string): boolean => {
    try {
      return Deno.statSync(path).isFile
    } catch {
      return false
    }
  }
  for (const line of planLines(planPasses(args, forced || undefined, isSpecFile))) {
    console.log(line)
  }
}
