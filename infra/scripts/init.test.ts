/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { parseEnvValues } from "./env-file.ts"
import { prepareEnv, projectSlug, randomHex, SECRETS } from "./init.ts"

const example = await Deno.readTextFile(`infra/envs/.env.example`)
const fake = (bytes: number) => `x`.repeat(bytes * 2)

Deno.test("a fresh env file gets the project name and every secret", () => {
  const { text, changed } = prepareEnv(example, undefined, `acme`, fake)
  const values = parseEnvValues(text, `.env`)
  expect(values.PROJECT).toBe(`acme`)
  for (const key of Object.keys(SECRETS)) expect(values[key], key).toBe(fake(SECRETS[key]))
  expect(changed).toEqual([`PROJECT`, ...Object.keys(SECRETS)])
})

Deno.test("only the secret lines change; comments and other values stay as written", () => {
  const { text } = prepareEnv(example, undefined, `app`, fake)
  const changedLines = text.split(`\n`).filter((line, i) => line !== example.split(`\n`)[i])
  expect(changedLines.map((line) => line.split(`=`)[0])).toEqual(Object.keys(SECRETS))
})

Deno.test("a second run changes nothing", () => {
  const first = prepareEnv(example, undefined, `acme`).text
  const second = prepareEnv(example, first, `other`)
  expect(second.changed).toEqual([])
  expect(second.text).toBe(first)
})

Deno.test("a secret someone set is kept, a placeholder left in an old file is replaced", () => {
  const old = example.replace(/^AUTH_PEPPER=.*$/m, `AUTH_PEPPER=mine-mine-mine`)
  const { text, changed } = prepareEnv(example, old, undefined, fake)
  const values = parseEnvValues(text, `.env`)
  expect(values.AUTH_PEPPER).toBe(`mine-mine-mine`)
  expect(values.KV_PASSWORD).toBe(fake(SECRETS.KV_PASSWORD))
  expect(changed).not.toContain(`AUTH_PEPPER`)
  expect(changed).not.toContain(`PROJECT`)
})

Deno.test("generated secrets meet the API's lengths and are hex", () => {
  expect(randomHex(SECRETS.AUTH_COOKIE_SECRET).length).toBeGreaterThanOrEqual(32)
  const seed = randomHex(SECRETS.SEED_PASSWORD)
  expect(seed.length).toBeGreaterThanOrEqual(8)
  expect(seed.length).toBeLessThanOrEqual(50)
  expect(seed).toMatch(/^[0-9a-f]+$/)
  expect(randomHex(24)).not.toBe(randomHex(24))
})

Deno.test("a project name becomes a Compose project name", () => {
  expect(projectSlug(`My Product`)).toBe(`my-product`)
  expect(projectSlug(` Financy! `)).toBe(`financy`)
  expect(() => projectSlug(`!!!`)).toThrow(`no letter or digit`)
})
