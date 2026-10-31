/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import {
  batches,
  connectionTarget,
  finishedDescription,
  MemberRole,
  memberRoles,
  parseGroupArgs,
  planTier,
  tagNames,
  TIERS,
} from "./group-plan.ts"

/** The tag cap every group has (`TAG_MAX_PER_GROUP`). */
const TAG_CAP = 100
const DEV_ENV = { ENV: `dev`, DB_NAME: `app`, DB_USER: `app`, DB_PASS: `test-only` }

Deno.test(`the tiers hold 1k, 10k, 100k and 1M notes with their documented proportions`, () => {
  const sizes = TIERS.map((tier) => {
    const { notes, tags, members, activity, notifications } = planTier(tier)
    return { tier, notes, tags, members, activity, notifications }
  })
  expect(sizes).toEqual([
    { tier: `S`, notes: 1_000, tags: 20, members: 10, activity: 1_000, notifications: 1_000 },
    { tier: `M`, notes: 10_000, tags: 50, members: 100, activity: 10_000, notifications: 10_000 },
    {
      tier: `L`,
      notes: 100_000,
      tags: 100,
      members: 1_000,
      activity: 100_000,
      notifications: 100_000,
    },
    {
      tier: `XL`,
      notes: 1_000_000,
      tags: 100,
      members: 1_000,
      activity: 100_000,
      notifications: 100_000,
    },
  ])
})

Deno.test(`each tier has its own fixed version 7 group id, so a rerun finds its group`, () => {
  const ids = TIERS.map((tier) => planTier(tier).groupId)
  expect(new Set(ids).size).toBe(TIERS.length)
  for (const [i, tier] of TIERS.entries()) {
    expect(planTier(tier).groupId).toBe(ids[i])
    expect(ids[i]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  }
})

Deno.test(`a finished group's description differs per tier and fits the 500-character limit`, () => {
  const descriptions = TIERS.map((tier) => finishedDescription(planTier(tier)))
  expect(new Set(descriptions).size).toBe(TIERS.length)
  for (const text of descriptions) expect(text.length).toBeLessThanOrEqual(500)
})

Deno.test(`the batches cover every note exactly once`, () => {
  for (const tier of TIERS) {
    const plan = planTier(tier)
    const ranges = batches(plan.notes, plan.batch)
    expect(ranges[0].from).toBe(1)
    expect(ranges.at(-1)!.to).toBe(plan.notes)
    for (const [i, range] of ranges.entries()) {
      expect(range.to - range.from + 1).toBeLessThanOrEqual(plan.batch)
      if (i > 0) expect(range.from).toBe(ranges[i - 1].to + 1)
    }
  }
  expect(batches(5, 2)).toEqual([{ from: 1, to: 2 }, { from: 3, to: 4 }, { from: 5, to: 5 }])
})

Deno.test(`a generated group has exactly one owner and someone besides the owner who writes`, () => {
  for (const tier of TIERS) {
    const roles = memberRoles(planTier(tier).members)
    expect(roles.filter((role) => role === MemberRole.Owner)).toHaveLength(1)
    expect(roles[0]).toBe(MemberRole.Owner)
    expect(roles.filter((role) => role === MemberRole.Admin).length).toBeGreaterThanOrEqual(1)
    expect(roles.filter((role) => role === MemberRole.Editor).length).toBeGreaterThanOrEqual(1)
    expect(roles.filter((role) => role === MemberRole.Viewer).length).toBeGreaterThanOrEqual(1)
  }
})

Deno.test(`tag names stay within the cap, 40 characters and unique without regard to case`, () => {
  for (const tier of TIERS) {
    const names = tagNames(planTier(tier).tags)
    expect(names.length).toBeLessThanOrEqual(TAG_CAP)
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length)
    for (const name of names) expect(name.length).toBeLessThanOrEqual(40)
  }
})

Deno.test(`the command line builds a tier with members, removes or explains`, () => {
  expect(parseGroupArgs([`m`, `--member`, ` Ann@Example.com `, `--member`, `ann@example.com`]))
    .toEqual({
      action: `build`,
      tier: `M`,
      members: [`ann@example.com`],
      envFile: `infra/envs/.env`,
      port: null,
    })
  expect(parseGroupArgs([`--remove`])).toEqual({
    action: `remove`,
    tiers: [`S`, `M`, `L`, `XL`],
    envFile: `infra/envs/.env`,
    port: null,
  })
  expect(parseGroupArgs([`--remove`, `L`, `--env-file`, `infra/envs/.env.prod`, `--port`, `15432`]))
    .toEqual({ action: `remove`, tiers: [`L`], envFile: `infra/envs/.env.prod`, port: 15432 })
  expect(parseGroupArgs([`--explain`, `XL`])).toMatchObject({ action: `explain`, tier: `XL` })
})

Deno.test(`the command line refuses what it does not know instead of guessing`, () => {
  for (
    const args of [
      [],
      [`XXL`],
      [`S`, `M`],
      [`S`, `--force`],
      [`S`, `--member`],
      [`S`, `--member`, `not-an-address`],
      [`--remove`, `--member`, `ann@example.com`],
      [`--explain`, `S`, `--member`, `ann@example.com`],
      [`--remove`, `--explain`, `S`],
      [`S`, `--port`, `0`],
      [`S`, `--port`, `5432x`],
    ]
  ) {
    expect(() => parseGroupArgs(args), args.join(` `)).toThrow(`Usage:`)
  }
})

Deno.test(`the generator refuses an env file of neither a development stack nor the demo`, () => {
  expect(() => connectionTarget({ ...DEV_ENV, ENV: `prod` }, null)).toThrow(`ENV=prod`)
  expect(() => connectionTarget({ ...DEV_ENV, ENV: `` }, null)).toThrow(`load data goes only`)
  expect(() => connectionTarget({ ...DEV_ENV, ENV: `prod`, DEMO_MODE: `false` }, 5432))
    .toThrow(`load data goes only`)
  expect(
    connectionTarget(
      { ...DEV_ENV, ENV: `prod`, DEMO_MODE: `true`, DB_HOST_PORT: `127.0.0.1:5433` },
      null,
    ),
  )
    .toEqual({ port: 5433, database: `app`, user: `app`, password: `test-only` })
})

Deno.test(`the generator connects to the published port, or the one --port names`, () => {
  expect(connectionTarget({ ...DEV_ENV, DB_HOST_PORT: `127.0.0.1:5432` }, null).port).toBe(5432)
  expect(connectionTarget({ ...DEV_ENV, DB_PORT: `6543` }, null).port).toBe(6543)
  expect(connectionTarget({ ...DEV_ENV, DB_HOST_PORT: `127.0.0.1:5432` }, 15432).port).toBe(15432)
  expect(() => connectionTarget({ ...DEV_ENV, DB_PASS: `` }, null)).toThrow(`DB_PASS`)
  expect(() => connectionTarget(DEV_ENV, null)).toThrow(`No Postgres port`)
})
