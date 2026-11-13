/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { integrationArgs } from "./test-integration.ts"

const BASE = [
  `test`,
  `--no-prompt`,
  `-E`,
  `-N`,
  `-R=./libs/server/db/migrations,./libs/server/db/schema.sql,./libs/server/blog/seed-posts`,
]
const FILE = `tests/integration/notes.integration.test.ts`

Deno.test("runs the whole integration folder when given no arguments", () => {
  expect(integrationArgs([])).toEqual([...BASE, `tests/integration`])
})

Deno.test("runs only the path it is given", () => {
  expect(integrationArgs([FILE])).toEqual([...BASE, FILE])
})

Deno.test("passes a flag alone to deno test and still runs the whole folder", () => {
  expect(integrationArgs([`--parallel`])).toEqual([...BASE, `--parallel`, `tests/integration`])
})

Deno.test("passes a flag through and runs only the path given with it", () => {
  expect(integrationArgs([FILE, `--filter=x`])).toEqual([...BASE, `--filter=x`, FILE])
})
