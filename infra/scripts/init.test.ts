/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { parseEnvValues } from "./env-file.ts"
import {
  KEEPS_OLD_DATA,
  nameFlag,
  prepareEnv,
  projectSlug,
  randomHex,
  SECRET_PREFIXES,
  SECRETS,
  writeSafely,
} from "./init.ts"

const example = await Deno.readTextFile(`infra/envs/.env.example`)
const fake = (bytes: number) => `x`.repeat(bytes * 2)
/** The value `prepareEnv` writes for `key` with the fake generator. */
const faked = (key: string) => (SECRET_PREFIXES[key] ?? ``) + fake(SECRETS[key])

Deno.test("a fresh env file gets the project name and every secret", () => {
  const { text, changed } = prepareEnv(example, undefined, `acme`, fake)
  const values = parseEnvValues(text, `.env`)
  expect(values.PROJECT).toBe(`acme`)
  for (const key of Object.keys(SECRETS)) expect(values[key], key).toBe(faked(key))
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

Deno.test("a placeholder keeps its quotes and its note", () => {
  const old = example.replace(/^KV_PASSWORD=.*$/m, `KV_PASSWORD="change-me" # dev only`)
  const { text } = prepareEnv(example, old, undefined, fake)
  expect(text).toContain(`KV_PASSWORD="${fake(SECRETS.KV_PASSWORD)}" # dev only\n`)
})

Deno.test("a placeholder written with export or spaces is replaced, so a second run is quiet", () => {
  const old = example
    .replace(/^KV_PASSWORD=.*$/m, `export KV_PASSWORD=change-me`)
    .replace(/^GRAFANA_PASS=.*$/m, `GRAFANA_PASS = change-me`)
  const first = prepareEnv(example, old, undefined, fake)
  expect(first.text).toContain(`export KV_PASSWORD=${fake(SECRETS.KV_PASSWORD)}\n`)
  expect(first.text).toContain(`GRAFANA_PASS = ${fake(SECRETS.GRAFANA_PASS)}\n`)
  expect(prepareEnv(example, first.text, undefined).changed).toEqual([])
})

Deno.test("a key set twice: the line Compose reads is replaced, the other is kept", () => {
  const old = example.replace(/^KV_PASSWORD=.*$/m, `KV_PASSWORD=mine\nKV_PASSWORD=change-me`)
  const { text } = prepareEnv(example, old, undefined, fake)
  expect(text).toContain(`KV_PASSWORD=mine\nKV_PASSWORD=${fake(SECRETS.KV_PASSWORD)}\n`)
  expect(parseEnvValues(text, `.env`).KV_PASSWORD).toBe(fake(SECRETS.KV_PASSWORD))
})

Deno.test("the file store's key and secrets take the form Garage accepts", () => {
  const values = parseEnvValues(prepareEnv(example, undefined, `acme`).text, `.env`)
  expect(values.S3_ACCESS_KEY_ID).toMatch(/^GK[0-9a-f]{24}$/)
  expect(values.S3_SECRET_ACCESS_KEY).toMatch(/^[0-9a-f]{64}$/)
  expect(values.GARAGE_RPC_SECRET).toMatch(/^[0-9a-f]{64}$/)
  const placeholders = parseEnvValues(example, `.env.example`)
  for (const key of [`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `GARAGE_RPC_SECRET`]) {
    expect(values[key], key).not.toBe(placeholders[key])
  }
})

Deno.test("the pepper and the Grafana password carry a warning, the others do not", () => {
  expect(Object.keys(KEEPS_OLD_DATA).sort()).toEqual([`AUTH_PEPPER`, `GRAFANA_PASS`])
  for (const key of Object.keys(KEEPS_OLD_DATA)) expect(SECRETS).toHaveProperty(key)
})

Deno.test("--name needs a value", () => {
  expect(nameFlag([])).toBeUndefined()
  expect(nameFlag([`--yes`, `--name`, `Acme`])).toBe(`Acme`)
  expect(() => nameFlag([`--name`])).toThrow(`--name needs a value`)
  expect(() => nameFlag([`--name`, `--yes`])).toThrow(`--name needs a value`)
})

/** Runs `body` in a fresh folder under tests/ (gitignored), removed afterwards. */
async function inScratch(body: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ dir: `tests`, prefix: `.scratch-init-` })
  try {
    await body(dir)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

const modeOf = async (path: string) => (await Deno.stat(path)).mode! & 0o777

Deno.test("a safe write creates the file with the mode asked for, and leaves no temporary file", () =>
  inScratch(async (dir) => {
    await writeSafely(`${dir}/vapid.json`, `{}`, 0o600)
    expect(await Deno.readTextFile(`${dir}/vapid.json`)).toBe(`{}`)
    expect(await modeOf(`${dir}/vapid.json`)).toBe(0o600)
    expect([...Deno.readDirSync(dir)].map((entry) => entry.name)).toEqual([`vapid.json`])
  }))

Deno.test("a safe write keeps the mode of the file it replaces", () =>
  inScratch(async (dir) => {
    await Deno.writeTextFile(`${dir}/.env`, `A=1`)
    await Deno.chmod(`${dir}/.env`, 0o600)
    await writeSafely(`${dir}/.env`, `A=2`)
    expect(await Deno.readTextFile(`${dir}/.env`)).toBe(`A=2`)
    expect(await modeOf(`${dir}/.env`)).toBe(0o600)
  }))

Deno.test("a temporary file left by a crash does not bring its mode along", () =>
  inScratch(async (dir) => {
    await Deno.writeTextFile(`${dir}/vapid.json.tmp`, `half`, { mode: 0o644 })
    await Deno.chmod(`${dir}/vapid.json.tmp`, 0o644)
    await writeSafely(`${dir}/vapid.json`, `{}`, 0o600)
    expect(await modeOf(`${dir}/vapid.json`)).toBe(0o600)
    expect([...Deno.readDirSync(dir)].map((entry) => entry.name)).toEqual([`vapid.json`])
  }))
