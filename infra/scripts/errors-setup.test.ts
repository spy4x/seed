/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { parseEnvValues } from "./env-file.ts"
import { internalDsn, parseSetupOutput, setupProblem, writeDsns } from "./errors-setup.ts"

const READY = {
  COMPOSE_PROFILES: `monitoring, errors`,
  PROJECT: `acme`,
  ERRORS_DOMAIN: `errors.example.com`,
  DEV_EMAIL: `ops@example.com`,
  GLITCHTIP_ADMIN_PASSWORD: `x`.repeat(40),
}

const API = `http://0123456789abcdef0123456789abcdef@acme-errors:8000/1`
const SPA = `https://fedcba9876543210fedcba9876543210@errors.example.com/2`

Deno.test("setup runs only with the errors profile on, and says how to turn it on", () => {
  expect(setupProblem(READY)).toBeUndefined()
  expect(setupProblem({ ...READY, COMPOSE_PROFILES: `monitoring,files` }))
    .toContain(`Add errors to COMPOSE_PROFILES`)
  expect(setupProblem({ ...READY, COMPOSE_PROFILES: `` })).toContain(`errors profile is off`)
})

Deno.test("setup refuses an env file without the host, the operator's address or the password", () => {
  for (const key of [`PROJECT`, `ERRORS_DOMAIN`, `DEV_EMAIL`, `GLITCHTIP_ADMIN_PASSWORD`]) {
    expect(setupProblem({ ...READY, [key]: `` }), key).toContain(`${key} is empty`)
    const { [key as keyof typeof READY]: _, ...without } = READY
    expect(setupProblem(without), key).toContain(`${key} is empty`)
  }
})

Deno.test("GlitchTip's last line gives the DSNs, whatever it printed before", () => {
  const line = JSON.stringify({ dsns: { api: SPA, spa: SPA }, made: [`superuser`] })
  expect(parseSetupOutput(`a warning\n${line}\n`)).toEqual({
    dsns: { api: SPA, spa: SPA },
    made: [`superuser`],
  })
})

Deno.test("output that does not end in the expected line fails without quoting it", () => {
  const leaked = `{"dsns":{"api":"${SPA}"},"made":[]}`
  for (const stdout of [``, `Traceback ${SPA}`, leaked, `{"dsns":{"api":"","spa":""},"made":[]}`]) {
    let message = ``
    try {
      parseSetupOutput(stdout)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message, stdout).not.toBe(``)
    expect(message).not.toContain(`fedcba`)
  }
})

Deno.test("the API's DSN names GlitchTip's container, keeping the key and the project", () => {
  expect(internalDsn(`https://0123456789abcdef0123456789abcdef@errors.example.com/1`, `acme`))
    .toBe(API)
})

Deno.test("a DSN without a key or a project number is refused", () => {
  for (const dsn of [``, `https://errors.example.com/1`, `https://key@errors.example.com/`]) {
    expect(() => internalDsn(dsn, `acme`), dsn).toThrow(`no usable DSN`)
  }
  expect(() => internalDsn(`https://key@errors.example.com/x`, `acme`)).toThrow(`no usable DSN`)
})

const FILE = [
  `# Error tracker`,
  `ERROR_REPORT_DSN=`,
  `# The browser's`,
  `SPA_ERROR_REPORT_DSN=`,
  `OTHER=1`,
  ``,
].join(`\n`)

Deno.test("empty DSNs are written, and every other line stays as written", () => {
  const { text, written, kept } = writeDsns(FILE, { ERROR_REPORT_DSN: API, SPA_ERROR_REPORT_DSN: SPA })
  expect(written).toEqual([`ERROR_REPORT_DSN`, `SPA_ERROR_REPORT_DSN`])
  expect(kept).toEqual([])
  const values = parseEnvValues(text, `.env`)
  expect(values.ERROR_REPORT_DSN).toBe(API)
  expect(values.SPA_ERROR_REPORT_DSN).toBe(SPA)
  const changed = text.split(`\n`).filter((line, i) => line !== FILE.split(`\n`)[i])
  expect(changed.map((line) => line.split(`=`)[0])).toEqual([
    `ERROR_REPORT_DSN`,
    `SPA_ERROR_REPORT_DSN`,
  ])
})

Deno.test("a second run writes nothing", () => {
  const dsns = { ERROR_REPORT_DSN: API, SPA_ERROR_REPORT_DSN: SPA }
  const first = writeDsns(FILE, dsns).text
  expect(writeDsns(first, dsns)).toEqual({ text: first, written: [], kept: [] })
})

Deno.test("a DSN someone set to another tracker is kept and reported", () => {
  const theirs = FILE.replace(`ERROR_REPORT_DSN=\n`, `ERROR_REPORT_DSN=https://k@other.example/9\n`)
  const { text, written, kept } = writeDsns(theirs, {
    ERROR_REPORT_DSN: API,
    SPA_ERROR_REPORT_DSN: SPA,
  })
  expect(kept).toEqual([`ERROR_REPORT_DSN`])
  expect(written).toEqual([`SPA_ERROR_REPORT_DSN`])
  expect(parseEnvValues(text, `.env`).ERROR_REPORT_DSN).toBe(`https://k@other.example/9`)
})

Deno.test("a DSN line missing from an older env file is added at the end", () => {
  const old = `PROJECT=acme`
  const { text, written } = writeDsns(old, { ERROR_REPORT_DSN: API, SPA_ERROR_REPORT_DSN: SPA })
  expect(written).toEqual([`ERROR_REPORT_DSN`, `SPA_ERROR_REPORT_DSN`])
  expect(text).toBe(`PROJECT=acme\nERROR_REPORT_DSN=${API}\nSPA_ERROR_REPORT_DSN=${SPA}\n`)
})
