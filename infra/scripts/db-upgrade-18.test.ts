/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import {
  addRowCounts,
  compareRowCounts,
  engineSteps,
  type Output,
  type RowCounts,
  runUpgrade,
  unexpectedRestoreErrors,
  UpgradeFailedError,
  type UpgradeHost,
  type UpgradeState,
  upgradeState,
  type UpgradeSteps,
} from "./db-upgrade-18.ts"
import type { PostgresDataFacts } from "./postgres-data.ts"

const COUNTS: RowCounts = { "app/public.notes": 120, "app/public.users": 7 }

/**
 * Steps that record their calls. `fail` names the ones that throw, `after` the second count,
 * `interruptDuring` the step during which the person presses Ctrl-C.
 */
function steps(
  options: {
    state?: UpgradeState
    fail?: string | string[]
    after?: RowCounts
    interruptDuring?: string
  } = {},
): UpgradeSteps & { calls: string[] } {
  const calls: string[] = []
  let counted = 0
  let clock = 1000
  let interrupted = false
  const failing = [options.fail ?? []].flat()
  const step = (name: string) => () => {
    calls.push(name)
    if (options.interruptDuring === name) interrupted = true
    return failing.includes(name) ? Promise.reject(new Error(`${name} broke`)) : Promise.resolve()
  }
  return {
    calls,
    state: () => Promise.resolve(options.state ?? "ready"),
    pull: step("pull"),
    build: step("build"),
    stopApps: step("stopApps"),
    startApps: step("startApps"),
    countRows: async () => {
      await step("countRows")()
      return counted++ === 0 ? COUNTS : options.after ?? COUNTS
    },
    dump: step("dump"),
    startPostgres18: step("startPostgres18"),
    restore: step("restore"),
    mark: step("mark"),
    stopDatabase: step("stopDatabase"),
    startEverything: step("startEverything"),
    interrupted: () => interrupted,
    now: () => (clock += 2500),
    log: () => {},
  }
}

Deno.test("fetches and builds, stops the apps, dumps, moves to Postgres 18, restores, compares, marks, then starts the apps", async () => {
  const s = steps()
  const report = await runUpgrade(s)
  expect(s.calls).toEqual([
    "pull",
    "build",
    "stopApps",
    "countRows",
    "dump",
    "startPostgres18",
    "restore",
    "countRows",
    "mark",
    "startEverything",
  ])
  expect(report).toEqual({ changed: true, state: "ready", downtimeMs: 2500, tables: 2, rows: 127 })
})

Deno.test("a second run on an upgraded server changes nothing", async () => {
  for (const state of ["upgraded", "not-needed"] as const) {
    const s = steps({ state })
    expect(await runUpgrade(s)).toEqual({ changed: false, state })
    expect(s.calls).toEqual([])
  }
})

Deno.test("refuses before any step after a half-finished run, after a rollback, or when no database answers", async () => {
  for (const state of ["incomplete", "no-database", "rolled-back"] as const) {
    const s = steps({ state })
    await expect(runUpgrade(s)).rejects.toThrow(UpgradeFailedError)
    await expect(runUpgrade(s)).rejects.toThrow("Nothing was changed")
    expect(s.calls).toEqual([])
  }
})

Deno.test("an image that cannot be fetched or built stops the upgrade before anything is stopped", async () => {
  for (const fail of ["pull", "build"]) {
    const s = steps({ fail })
    await expect(runUpgrade(s)).rejects.toThrow(`${fail} broke\nNothing was changed`)
    expect(s.calls.slice(-1)).toEqual([fail])
    expect(s.calls).not.toContain("stopApps")
  }
})

Deno.test("an interruption before the apps stop ends the run with everything still running", async () => {
  for (const interruptDuring of ["pull", "build"]) {
    const s = steps({ interruptDuring })
    const failure = await runUpgrade(s).catch((error) => error)
    expect(failure).toBeInstanceOf(UpgradeFailedError)
    expect(failure.message).toContain("Interrupted")
    expect(failure.message).toContain("Nothing was changed")
    // The step that was running ends, and no other step starts.
    expect(s.calls.slice(-1)).toEqual([interruptDuring])
  }
})

Deno.test("an interruption before Postgres 16 stops starts the apps again and changes nothing else", async () => {
  for (const interruptDuring of ["stopApps", "countRows", "dump"]) {
    const s = steps({ interruptDuring })
    await expect(runUpgrade(s)).rejects.toThrow("Interrupted")
    // The step that was running ends, then the apps start; no other step runs.
    expect(s.calls.slice(-2)).toEqual([interruptDuring, "startApps"])
    expect(s.calls).not.toContain("startPostgres18")
  }
})

Deno.test("an interruption on a terminal that is gone still starts the apps again", async () => {
  // A dropped SSH connection: the hang-up arrives during the dump and every print fails.
  const s = steps({ interruptDuring: "dump" })
  s.log = () => {
    throw new Error("Input/output error (os error 5)")
  }
  await expect(runUpgrade(s)).rejects.toThrow("Interrupted")
  expect(s.calls.slice(-2)).toEqual(["dump", "startApps"])
})

Deno.test("a dump that Ctrl-C broke is reported as an interruption, with the dump's own error", async () => {
  const s = steps({ interruptDuring: "dump", fail: "dump" })
  const failure = await runUpgrade(s).catch((error) => error)
  expect(failure.message).toContain("Interrupted before Postgres 16 was stopped. dump broke")
  expect(s.calls.slice(-2)).toEqual(["dump", "startApps"])
})

Deno.test("an interruption after Postgres 16 stopped does not stop the upgrade half-way", async () => {
  for (const interruptDuring of ["startPostgres18", "restore", "mark"]) {
    const s = steps({ interruptDuring })
    expect((await runUpgrade(s)).changed).toBe(true)
    expect(s.calls.slice(-2)).toEqual(["mark", "startEverything"])
  }
})

Deno.test("apps that will not start again after a failed dump are reported beside the dump's error", async () => {
  const s = steps({ fail: ["dump", "startApps"] })
  const failure = await runUpgrade(s).catch((error) => error)
  expect(failure).toBeInstanceOf(UpgradeFailedError)
  expect(failure.message).toContain("dump broke")
  expect(failure.message).toContain("could not be started again (startApps broke)")
})

Deno.test("apps that do not start after the move fail the run and say the data is on Postgres 18", async () => {
  const s = steps({ fail: "startEverything" })
  await expect(runUpgrade(s)).rejects.toThrow("startEverything broke\nThe data is on Postgres 18")
  expect(s.calls).toContain("mark")
  expect(s.calls).not.toContain("stopDatabase")
})

Deno.test("a failed dump leaves Postgres 16 running and starts the apps again", async () => {
  for (const fail of ["countRows", "dump"]) {
    const s = steps({ fail })
    await expect(runUpgrade(s)).rejects.toThrow(`${fail} broke\nNothing was changed`)
    expect(s.calls.slice(-1)).toEqual(["startApps"])
    expect(s.calls).not.toContain("startPostgres18")
    expect(s.calls).not.toContain("mark")
  }
})

Deno.test("a row count that differs after the restore fails the upgrade and serves nothing", async () => {
  const s = steps({ after: { ...COUNTS, "app/public.notes": 119 } })
  await expect(runUpgrade(s)).rejects.toThrow("app/public.notes: 120 rows before, 119 after")
  expect(s.calls.slice(-2)).toEqual(["countRows", "stopDatabase"])
  expect(s.calls).not.toContain("mark")
  expect(s.calls).not.toContain("startEverything")
})

Deno.test("a failed restore stops the database and neither marks nor starts the apps", async () => {
  for (const fail of ["startPostgres18", "restore"]) {
    const s = steps({ fail })
    await expect(runUpgrade(s)).rejects.toThrow(`${fail} broke\nThe upgrade failed`)
    expect(s.calls.slice(-1)).toEqual(["stopDatabase"])
    expect(s.calls).not.toContain("mark")
    expect(s.calls).not.toContain("startEverything")
  }
})

Deno.test("row counts match only when every table is there with the same count", () => {
  expect(compareRowCounts(COUNTS, { ...COUNTS })).toEqual([])
  expect(compareRowCounts(COUNTS, { "app/public.users": 7 })).toEqual([
    "app/public.notes: 120 rows before, the table is missing after",
  ])
  expect(compareRowCounts(COUNTS, { ...COUNTS, "app/public.users": 0 })).toEqual([
    "app/public.users: 7 rows before, 0 after",
  ])
  expect(compareRowCounts(COUNTS, { ...COUNTS, "app/public.users": 8 })).toEqual([
    "app/public.users: 7 rows before, 8 after",
  ])
  expect(compareRowCounts(COUNTS, { ...COUNTS, "app/public.extra": 3 })).toEqual([
    "app/public.extra: not there before, 3 rows after",
  ])
})

Deno.test("reads one count per table and refuses a line it cannot read", () => {
  const counts: RowCounts = {}
  addRowCounts(counts, "app", "public.notes\t120\npublic.users\t0\n")
  expect(counts).toEqual({ "app/public.notes": 120, "app/public.users": 0 })
  expect(() => addRowCounts({}, "app", "public.notes\t")).toThrow("Cannot read the row count")
  expect(() => addRowCounts({}, "app", "public.notes\tmany")).toThrow("Cannot read the row count")
})

Deno.test("a restore's errors pass only for the role and the database a fresh server already has", () => {
  const known = 'ERROR:  role "app" already exists\nERROR:  database "app" already exists\n'
  expect(unexpectedRestoreErrors(known, "app", "app")).toEqual([])
  const lost = 'ERROR:  relation "notes" already exists'
  expect(unexpectedRestoreErrors(`${known}${lost}\nNOTICE:  fine\n`, "app", "app")).toEqual([lost])
  expect(unexpectedRestoreErrors('ERROR:  role "other" already exists', "app", "app")).toHaveLength(
    1,
  )
  expect(
    unexpectedRestoreErrors("psql: error: FATAL:  the database system is shutting down", "a", "a"),
  )
    .toHaveLength(1)
})

Deno.test("the state comes from the marker first, then the directories and the running version", () => {
  const facts: PostgresDataFacts = {
    oldDataExists: true,
    newDataExists: false,
    upgradeMarked: false,
    oldDataChangedSinceUpgrade: false,
  }
  expect(upgradeState(facts, 16)).toBe("ready")
  expect(upgradeState(facts, undefined)).toBe("no-database")
  expect(upgradeState({ ...facts, newDataExists: true }, 16)).toBe("incomplete")
  expect(upgradeState({ ...facts, newDataExists: true }, 18)).toBe("incomplete")
  const marked = { ...facts, newDataExists: true, upgradeMarked: true }
  expect(upgradeState(marked, 18)).toBe("upgraded")
  expect(upgradeState(marked, undefined)).toBe("upgraded")
  const fresh = { ...facts, oldDataExists: false, newDataExists: true }
  expect(upgradeState(fresh, 18)).toBe("not-needed")
  expect(upgradeState(fresh, undefined)).toBe("incomplete")
})

Deno.test("a rolled-back server is never reported as upgraded, whatever runs now", () => {
  const marked: PostgresDataFacts = {
    oldDataExists: true,
    newDataExists: true,
    upgradeMarked: true,
    oldDataChangedSinceUpgrade: false,
  }
  // Postgres 16 answers beside a marked directory: rolled back, and still on the old version.
  expect(upgradeState(marked, 16)).toBe("rolled-back")
  // Postgres 16 ran after the marker, then this version was deployed again over it: the stale
  // Postgres 18 directory may be running, or nothing at all.
  const stale = { ...marked, oldDataChangedSinceUpgrade: true }
  expect(upgradeState(stale, 18)).toBe("rolled-back")
  expect(upgradeState(stale, undefined)).toBe("rolled-back")
  expect(upgradeState(stale, 16)).toBe("rolled-back")
})

// --- The real steps, against a host that plays the container engine. ---

const VALUES = { PROJECT: "shop", DB_NAME: "app", DB_USER: "owner", ENV: "prod" }
const DUMP = "./.db-upgrade/postgres-16-test.sql"
const COMPOSE =
  "compose -f ./infra/compose/compose.shared.yml -f ./infra/compose/compose.prod.yml --env-file ./infra/envs/.env"
const WHOLE = "\n--\n-- PostgreSQL database cluster dump complete\n--\n\n"
const ok: Output = { code: 0, stdout: "", stderr: "" }

/** A host whose engine answers what `answers` gives; everything it is asked is in `ran`. */
function host(
  answers: {
    show?: (line: string) => number
    capture?: (line: string, stdinPath?: string) => Partial<Output>
    dumpExit?: number
    dumpTail?: string
  } = {},
): UpgradeHost & { ran: string[]; files: string[] } {
  const ran: string[] = []
  const files: string[] = []
  return {
    ran,
    files,
    show: (args) => {
      // Only what follows the Compose files and the env file tells the commands apart.
      const line = args.slice(args.indexOf("./infra/envs/.env") + 1).join(" ")
      ran.push(line)
      return Promise.resolve(answers.show?.(line) ?? 0)
    },
    capture: (args, stdinPath) => {
      const line = args.join(" ")
      ran.push(line)
      return Promise.resolve({ ...ok, ...answers.capture?.(line, stdinPath) })
    },
    toFile: (args, path, mode) => {
      ran.push(args.join(" "))
      files.push(`${path} ${mode.toString(8)}`)
      return Promise.resolve(answers.dumpExit ?? 0)
    },
    tail: () => Promise.resolve({ size: 4096, text: answers.dumpTail ?? WHOLE }),
    rename: (from, to) => {
      files.push(`${from} -> ${to}`)
      return Promise.resolve()
    },
    facts: () => Promise.reject(new Error("not read in these tests")),
    sleep: () => Promise.resolve(),
    interrupted: () => false,
    now: () => 0,
    log: () => {},
  }
}

Deno.test("a whole dump is written with pg_dumpall to a file only its owner can read", async () => {
  const h = host()
  await engineSteps(VALUES, DUMP, h).dump()
  expect(h.ran).toEqual(["exec shop-db pg_dumpall -U owner"])
  expect(h.files).toEqual([`${DUMP} 600`])
})

Deno.test("a pg_dumpall that exits with an error fails the dump, even when its file looks whole", async () => {
  const h = host({ dumpExit: 1 })
  await expect(engineSteps(VALUES, DUMP, h).dump()).rejects.toThrow("pg_dumpall failed")
})

Deno.test("a dump without its closing comment is cut short and fails, even when pg_dumpall exits with 0", async () => {
  const h = host({ dumpTail: "COPY public.notes (id, body) FROM stdin;\n1\tfirst\n" })
  await expect(engineSteps(VALUES, DUMP, h).dump()).rejects.toThrow("The dump is cut short")
})

Deno.test("a failed dump's file is renamed, so it cannot pass for a good one", async () => {
  for (const answers of [{ dumpExit: 1 }, { dumpTail: "COPY" }]) {
    const h = host(answers)
    await expect(engineSteps(VALUES, DUMP, h).dump()).rejects.toThrow(`${DUMP}.partial`)
    expect(h.files.slice(-1)).toEqual([`${DUMP} -> ${DUMP}.partial`])
  }
})

Deno.test("the restore feeds the dump to psql and passes with only the two errors a fresh server gives", async () => {
  const stderr = 'ERROR:  role "owner" already exists\nERROR:  database "app" already exists\n'
  const fed: (string | undefined)[] = []
  const h = host({
    capture: (_line, stdinPath) => {
      fed.push(stdinPath)
      return { stderr }
    },
  })
  await engineSteps(VALUES, DUMP, h).restore()
  expect(h.ran).toEqual(["exec -i shop-db psql -X -U owner -d postgres -q"])
  expect(fed).toEqual([DUMP])
})

Deno.test("a restore that reports any other error fails, even when psql exits with 0", async () => {
  const stderr = 'ERROR:  role "owner" already exists\nERROR:  extension "old" is not available\n'
  const h = host({ capture: () => ({ stderr }) })
  await expect(engineSteps(VALUES, DUMP, h).restore()).rejects.toThrow(
    'The restore reported errors:\nERROR:  extension "old" is not available',
  )
})

Deno.test("a restore whose psql exits with an error fails", async () => {
  const h = host({ capture: () => ({ code: 2, stderr: "psql: error: connection lost" }) })
  await expect(engineSteps(VALUES, DUMP, h).restore()).rejects.toThrow(
    "The restore failed (exit 2)",
  )
})

Deno.test("fetching the image builds the db service only, fetching its base, and fails when the engine does", async () => {
  const h = host()
  await engineSteps(VALUES, DUMP, h).pull()
  expect(h.ran).toEqual(["build --pull db"])
  const offline = host({ show: () => 1 })
  await expect(engineSteps(VALUES, DUMP, offline).pull()).rejects.toThrow("build --pull db failed (exit 1)")
})

Deno.test("Postgres 16 is stopped with time to finish, then Postgres 18 starts alone and must answer as 18", async () => {
  const version = (num: string) => (line: string) =>
    line.includes("server_version_num") ? { stdout: `${num}\n` } : {}
  const h = host({ capture: version("180006") })
  await engineSteps(VALUES, DUMP, h).startPostgres18()
  expect(h.ran.slice(0, 3)).toEqual([
    "stop --timeout 120 db",
    `${COMPOSE} --dry-run up -d`,
    "up -d --no-deps db",
  ])
  const still16 = host({ capture: version("160011") })
  await expect(engineSteps(VALUES, DUMP, still16).startPostgres18()).rejects.toThrow(
    "shop-db runs Postgres 16, not 18",
  )
})

Deno.test("on a server whose network Compose would recreate, every container is removed before Postgres 18 starts", async () => {
  const answers = (dryRun: Partial<Output>) => (line: string) =>
    line.includes("--dry-run")
      ? dryRun
      : line.includes("server_version_num")
      ? { stdout: "180006\n" }
      : {}
  const recreated = host({
    capture: answers({ stderr: " Network shop_default Removing \n Network shop_default Removed \n" }),
  })
  await engineSteps(VALUES, DUMP, recreated).startPostgres18()
  expect(recreated.ran.slice(0, 4)).toEqual([
    "stop --timeout 120 db",
    `${COMPOSE} --dry-run up -d`,
    "--profile * down --remove-orphans",
    "up -d --no-deps db",
  ])

  // A dry run that fails proves nothing, whatever it printed: the upgrade goes on as before.
  const unknown = host({ capture: answers({ code: 1, stderr: " Network shop_default Removing \n" }) })
  await engineSteps(VALUES, DUMP, unknown).startPostgres18()
  expect(unknown.ran.filter((line) => line.includes("down"))).toEqual([])
})
