/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import {
  NEW_DATA_DIR,
  OLD_DATA_DIR,
  type PostgresDataFacts,
  postgresUpgradeRefusal,
  readPostgresDataFacts,
  type StatModified,
  UPGRADE_MARKER,
} from "./postgres-data.ts"

const facts = (overrides: Partial<PostgresDataFacts>): PostgresDataFacts => ({
  oldDataExists: false,
  newDataExists: false,
  upgradeMarked: false,
  oldDataChangedSinceUpgrade: false,
  ...overrides,
})
const UNMOVED = facts({ oldDataExists: true })

Deno.test("deno task compose refuses to start the database beside unmoved Postgres 16 data", () => {
  for (
    const args of [
      ["up", "-d", "--build"],
      ["start"],
      ["restart", "db"],
      ["run", "migrate"],
      ["create"],
      ["scale", "db=1"],
      ["watch"],
    ]
  ) {
    const refusal = postgresUpgradeRefusal(args, UNMOVED)
    expect({ args, refusal }).toEqual({
      args,
      refusal: expect.stringContaining("Refusing to start"),
    })
    expect(refusal).toContain("deno task db:upgrade-18")
  }
})

Deno.test("a failed upgrade's half-filled directory does not lift the refusal", () => {
  expect(postgresUpgradeRefusal(["up", "-d"], facts({ oldDataExists: true, newDataExists: true })))
    .toContain("Refusing to start")
})

Deno.test("deno task compose starts once the upgrade wrote its marker", () => {
  const upgraded = facts({ oldDataExists: true, newDataExists: true, upgradeMarked: true })
  expect(postgresUpgradeRefusal(["up", "-d"], upgraded)).toBeUndefined()
})

Deno.test("a machine with no Postgres 16 data is never refused", () => {
  expect(postgresUpgradeRefusal(["up", "-d"], facts({}))).toBeUndefined()
  expect(postgresUpgradeRefusal(["up", "-d"], facts({ newDataExists: true }))).toBeUndefined()
})

Deno.test("commands that start nothing run beside unmoved data", () => {
  for (const args of [["ps"], ["logs", "db"], ["stop"], ["down"], ["build"]]) {
    expect({ args, refusal: postgresUpgradeRefusal(args, UNMOVED) }).toEqual({
      args,
      refusal: undefined,
    })
  }
})

Deno.test("after a rollback, deno task compose refuses to start Postgres 18 on the copy from before it", () => {
  const rolledBack = facts({
    oldDataExists: true,
    newDataExists: true,
    upgradeMarked: true,
    oldDataChangedSinceUpgrade: true,
  })
  const refusal = postgresUpgradeRefusal(["up", "-d", "--build"], rolledBack)
  expect(refusal).toContain("Refusing to start")
  expect(refusal).toContain("Postgres 16 ran again")
  expect(postgresUpgradeRefusal(["ps"], rolledBack)).toBeUndefined()
})

const MARKER = `${NEW_DATA_DIR}/${UPGRADE_MARKER}`
/** A disk that holds `times` (path to seconds); `unreadable` paths answer "permission denied". */
const disk = (times: Record<string, number>, unreadable: string[] = []): StatModified => (path) => {
  if (unreadable.includes(path)) return Promise.reject(new Deno.errors.PermissionDenied(path))
  if (!(path in times)) return Promise.reject(new Deno.errors.NotFound(path))
  return Promise.resolve({ mtime: new Date(times[path] * 1000) })
}

Deno.test("an old directory last changed before the marker was written is an upgraded server", async () => {
  const stat = disk({ [OLD_DATA_DIR]: 100, [NEW_DATA_DIR]: 110, [MARKER]: 130 })
  expect(await readPostgresDataFacts(stat)).toEqual({
    oldDataExists: true,
    newDataExists: true,
    upgradeMarked: true,
    oldDataChangedSinceUpgrade: false,
  })
})

Deno.test("an old directory changed after the marker was written is a rolled-back server", async () => {
  const stat = disk({ [OLD_DATA_DIR]: 131, [NEW_DATA_DIR]: 110, [MARKER]: 130 })
  expect((await readPostgresDataFacts(stat)).oldDataChangedSinceUpgrade).toBe(true)
})

Deno.test("a marker that is missing or cannot be read does not count as a finished upgrade", async () => {
  const dirs = { [OLD_DATA_DIR]: 100, [NEW_DATA_DIR]: 110 }
  for (const stat of [disk(dirs), disk({ ...dirs, [MARKER]: 130 }, [MARKER])]) {
    expect(await readPostgresDataFacts(stat)).toEqual({
      oldDataExists: true,
      newDataExists: true,
      upgradeMarked: false,
      oldDataChangedSinceUpgrade: false,
    })
  }
})

Deno.test("a machine with neither directory has no facts to refuse on", async () => {
  expect(await readPostgresDataFacts(disk({}))).toEqual(facts({}))
})
