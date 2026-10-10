/// <reference lib="deno.ns" />
/**
 * The SPA container writes `/config.json` at start with `apps/spa/runtime-config.sh`, from the
 * variables named in `apps/spa/public-env.allow`. Everything in that file reaches every visitor's
 * browser, so these tests hold two lines: no secret-looking name is listed, and a variable that is
 * not listed never reaches the file.
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"

const SCRIPT = fromFileUrl(new URL("../apps/spa/runtime-config.sh", import.meta.url))
const ALLOW = fromFileUrl(new URL("../apps/spa/public-env.allow", import.meta.url))

/** Names of variables that hold secrets. Public settings must not match. */
const SECRET_LOOKING =
  /SECRET|PASSWORD|PASSWD|TOKEN|PRIVATE|CREDENTIAL|API_?KEY|COOKIE|SALT|PEPPER/i

function listed(text: string): { name: string; key: string }[] {
  return text.split("\n").map((line) => line.trim()).filter((line) =>
    line !== "" && !line.startsWith("#")
  ).map((line) => {
    const [name, key] = line.split(/\s+/)
    return { name, key }
  })
}

/**
 * A scratch folder under `tests/`, which the task grants: the OS temp folder moves with `TMPDIR`,
 * which a permission flag cannot follow.
 */
function tempDir(): Promise<string> {
  return Deno.makeTempDir({ dir: fromFileUrl(new URL(".", import.meta.url)), prefix: ".scratch-" })
}

interface Run {
  code: number
  stderr: string
  /** The parsed file, or undefined when the script wrote none. */
  config?: Record<string, unknown>
}

/** Runs the script with exactly these variables, on this allow list. */
async function run(env: Record<string, string>, allow = ALLOW): Promise<Run> {
  const dir = await tempDir()
  try {
    const out = `${dir}/config.json`
    const result = await new Deno.Command("sh", {
      args: [SCRIPT],
      clearEnv: true,
      env: { PATH: "/usr/bin:/bin", ALLOW_FILE: allow, OUT_FILE: out, ...env },
    }).output()
    const stderr = new TextDecoder().decode(result.stderr)
    if (result.code !== 0) return { code: result.code, stderr }
    return { code: 0, stderr, config: JSON.parse(await Deno.readTextFile(out)) }
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

/** Runs the script, expects success and returns the parsed file it wrote. */
async function runScript(env: Record<string, string>): Promise<Record<string, unknown>> {
  const result = await run(env)
  expect(result.code).toBe(0)
  return result.config!
}

Deno.test("the allow list names no variable that looks like a secret", async () => {
  const entries = listed(await Deno.readTextFile(ALLOW))

  expect(entries.length).toBeGreaterThan(0)
  for (const { name, key } of entries) {
    expect(name).not.toMatch(SECRET_LOOKING)
    expect(key).not.toMatch(SECRET_LOOKING)
    expect(name.startsWith("SPA_")).toBe(true)
  }
})

Deno.test("a variable outside the allow list never reaches config.json", async () => {
  const config = await runScript({
    SPA_ENV: "prod",
    SPA_ERROR_REPORT_DSN: "https://k@tracker.example/1",
    SPA_SECRET: "leak-1",
    COOKIE_SECRET: "leak-2",
    DB_PASSWORD: "leak-3",
  })

  expect(config).toEqual({ env: "prod", errorReportDsn: "https://k@tracker.example/1" })
})

Deno.test("two environments give one image two different config files", async () => {
  const prod = await runScript({ SPA_ENV: "prod", SPA_ERROR_REPORT_DSN: "https://k@a.example/1" })
  const stag = await runScript({ SPA_ENV: "stag" })

  expect(prod).toEqual({ env: "prod", errorReportDsn: "https://k@a.example/1" })
  expect(stag).toEqual({ env: "stag" })
})

Deno.test("a value with quotes and backslashes still gives valid JSON", async () => {
  const config = await runScript({ SPA_ENV: `a"b\\c` })

  expect(config).toEqual({ env: `a"b\\c` })
})

Deno.test("no variables give an empty object", async () => {
  expect(await runScript({})).toEqual({})
})

for (
  const [label, value] of [
    ["a tab", "a\tb"],
    ["a trailing carriage return", "https://k@a.example/1\r"],
    ["a newline", `line1\n","errorReportDsn":"https://evil@x.example/1`],
    ["a bell character", "a\x07b"],
  ]
) {
  Deno.test(`a value with ${label} stops the script and names the variable, not the value`, async () => {
    const result = await run({ SPA_ERROR_REPORT_DSN: value, SPA_ENV: "prod" })

    expect(result.code).not.toBe(0)
    expect(result.config).toBeUndefined()
    expect(result.stderr).toContain("SPA_ERROR_REPORT_DSN")
    expect(result.stderr).not.toContain("evil")
    expect(result.stderr).not.toContain("a.example")
  })
}

Deno.test("the last allow list line counts without a trailing newline", async () => {
  const dir = await tempDir()
  try {
    const allow = `${dir}/allow`
    await Deno.writeTextFile(allow, "SPA_ENV env\nSPA_ERROR_REPORT_DSN errorReportDsn")

    const result = await run({ SPA_ENV: "p", SPA_ERROR_REPORT_DSN: "d" }, allow)

    expect(result.config).toEqual({ env: "p", errorReportDsn: "d" })
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

/**
 * `apps/spa/csp-connect.sh` writes, at container start, the one part of the content security
 * policy that differs per deployment: the nginx variable holding the origin the app may post error
 * reports to. Its value lands inside nginx configuration, so nothing but an origin may get there.
 */
const CSP_SCRIPT = fromFileUrl(new URL("../apps/spa/csp-connect.sh", import.meta.url))

/** Runs the script with exactly these variables; `conf` is the file it wrote, if any. */
async function runCspScript(
  env: Record<string, string>,
): Promise<{ code: number; stderr: string; conf?: string }> {
  const dir = await tempDir()
  try {
    const out = `${dir}/csp-connect.conf`
    const result = await new Deno.Command("sh", {
      args: [CSP_SCRIPT],
      clearEnv: true,
      env: { PATH: "/usr/bin:/bin", OUT_FILE: out, ...env },
    }).output()
    const stderr = new TextDecoder().decode(result.stderr)
    if (result.code !== 0) {
      // A refusal leaves no file behind, so nginx cannot start on a half-written one.
      await expect(Deno.stat(out)).rejects.toThrow(Deno.errors.NotFound)
      return { code: result.code, stderr }
    }
    return { code: 0, stderr, conf: await Deno.readTextFile(out) }
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

Deno.test("without a tracker the policy's variable is empty", async () => {
  const result = await runCspScript({})

  expect(result.conf).toBe(`set $csp_error_tracker "";\n`)
})

for (
  const [dsn, origin] of [
    ["https://0123abcd@errors.example.com/7", "https://errors.example.com"],
    ["https://errors.example.com/7", "https://errors.example.com"],
    ["http://key@tracker.test:8000/prefix/3", "http://tracker.test:8000"],
  ]
) {
  Deno.test(`the tracker ${dsn} is allowed as the origin ${origin}, without its key or path`, async () => {
    const result = await runCspScript({ SPA_ERROR_REPORT_DSN: dsn })

    expect(result.conf).toBe(`set $csp_error_tracker "${origin}";\n`)
  })
}

for (
  const [label, dsn] of [
    ["a quote that would end the nginx string", `https://k@a.example/1"; add_header x-evil "1`],
    ["a dollar sign that would name an nginx variable", "https://k@$host/1"],
    ["a second line", "https://k@a.example/1\nhttps://k@evil.example/2"],
    ["a space that would add a second source", "https://k@a.example/1 https://evil.example"],
    ["a wildcard host", "https://k@*.example/1"],
    ["a scheme other than http or https", "ftp://k@a.example/1"],
    ["no host", "https://k@/1"],
  ]
) {
  Deno.test(`a tracker address with ${label} stops the script and names the variable, not the value`, async () => {
    const result = await runCspScript({ SPA_ERROR_REPORT_DSN: dsn })

    expect(result.code).not.toBe(0)
    expect(result.conf).toBeUndefined()
    expect(result.stderr).toContain("SPA_ERROR_REPORT_DSN")
    // Every address above carries the key `k`.
    expect(result.stderr).not.toContain("k@")
  })
}
