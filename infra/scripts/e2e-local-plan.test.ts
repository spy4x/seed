/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { planLines, planPasses, SMOKE_SPECS } from "./e2e-local-plan.ts"

const EXISTING = [
  `e2e/notes.e2e.ts`,
  `e2e/sessions.e2e.ts`,
  `e2e/offline.e2e.ts`,
  `e2e/local-data.e2e.ts`,
]
const isSpecFile = (path: string): boolean => EXISTING.includes(path)

Deno.test("a run that names no spec runs the other specs on the dev server, then the offline specs on the built SPA", () => {
  expect(planPasses([], undefined, isSpecFile)).toEqual([
    { server: `dev`, specs: `other`, args: [] },
    { server: `built`, specs: `offline`, args: [] },
  ])
})

Deno.test("an argument that is not a spec path goes to both passes", () => {
  expect(planPasses([`-g`, `signing another`, `--workers=1`], undefined, isSpecFile)).toEqual([
    { server: `dev`, specs: `other`, args: [`-g`, `signing another`, `--workers=1`] },
    { server: `built`, specs: `offline`, args: [`-g`, `signing another`, `--workers=1`] },
  ])
})

Deno.test("a run that names only offline specs makes one pass, on the built SPA", () => {
  expect(planPasses([`e2e/offline.e2e.ts`, `e2e/local-data.e2e.ts:204`], undefined, isSpecFile))
    .toEqual([
      { server: `built`, specs: `offline`, args: [`offline.e2e.ts`, `local-data.e2e.ts:204`] },
    ])
})

Deno.test("a run that names only other specs makes one pass, on the dev server", () => {
  expect(planPasses([`e2e/notes.e2e.ts:42`, `--headed`], undefined, isSpecFile)).toEqual([
    { server: `dev`, specs: `other`, args: [`notes.e2e.ts:42`, `--headed`] },
  ])
})

Deno.test("a run that names both kinds gives each pass its own specs and every other argument", () => {
  expect(
    planPasses(
      [`e2e/offline.e2e.ts`, `--repeat-each=2`, `e2e/notes.e2e.ts`, `e2e/sessions.e2e.ts:70`],
      undefined,
      isSpecFile,
    ),
  ).toEqual([
    {
      server: `dev`,
      specs: `other`,
      args: [`notes.e2e.ts`, `sessions.e2e.ts:70`, `--repeat-each=2`],
    },
    { server: `built`, specs: `offline`, args: [`offline.e2e.ts`, `--repeat-each=2`] },
  ])
})

Deno.test("E2E_SPA puts every spec asked for on that one server, in the order given", () => {
  expect(planPasses([`e2e/offline.e2e.ts`, `-g`, `x`, `e2e/notes.e2e.ts`], `dev`, isSpecFile))
    .toEqual([{ server: `dev`, specs: `all`, args: [`offline.e2e.ts`, `-g`, `x`, `notes.e2e.ts`] }])
  expect(planPasses([], `built`, isSpecFile)).toEqual([{ server: `built`, specs: `all`, args: [] }])
})

Deno.test("--smoke stands for the specs of the smoke set, on the dev server, with the other arguments", () => {
  const anySpec = (path: string): boolean => path.endsWith(`.e2e.ts`)
  expect(planPasses([`--smoke`, `--repeat-each=2`], undefined, anySpec)).toEqual([
    { server: `dev`, specs: `other`, args: [...SMOKE_SPECS, `--repeat-each=2`] },
  ])
  expect(planPasses([`--smoke`, `e2e/offline.e2e.ts`], undefined, anySpec)).toEqual([
    { server: `dev`, specs: `other`, args: [...SMOKE_SPECS] },
    { server: `built`, specs: `offline`, args: [`offline.e2e.ts`] },
  ])
})

Deno.test("a path that names no existing spec file is passed on as it is, to both passes", () => {
  expect(planPasses([`e2e/missing.e2e.ts`], undefined, isSpecFile)).toEqual([
    { server: `dev`, specs: `other`, args: [`e2e/missing.e2e.ts`] },
    { server: `built`, specs: `offline`, args: [`e2e/missing.e2e.ts`] },
  ])
})

Deno.test("an existing file that is no spec is passed on as it is and starts no pass of its own", () => {
  const exists = (path: string): boolean => path === `e2e/fixtures/app.ts` || isSpecFile(path)
  expect(planPasses([`e2e/fixtures/app.ts`, `e2e/offline.e2e.ts`], undefined, exists)).toEqual([
    { server: `built`, specs: `offline`, args: [`offline.e2e.ts`, `e2e/fixtures/app.ts`] },
  ])
})

Deno.test("the plan is printed as one pass line followed by one line for each argument", () => {
  expect(planLines(planPasses([`-g`, `two words`], undefined, isSpecFile))).toEqual([
    `pass dev other`,
    `arg -g`,
    `arg two words`,
    `pass built offline`,
    `arg -g`,
    `arg two words`,
  ])
})
