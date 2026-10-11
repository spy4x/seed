/// <reference lib="deno.ns" />
import { expect } from "@std/expect"

// Runs infra/scripts/db-reset.ts itself, as `deno task db:reset` does, against fixture env files.
// The database port is closed, so a run that passes every guard fails at the first database step
// with a connection error: that is how these tests tell "refused" from "went ahead".

const SCRIPT = new URL("../infra/scripts/db-reset.ts", import.meta.url).pathname
const ROOT = new URL("..", import.meta.url).pathname

interface Run {
  code: number
  out: string
}

async function run(
  args: string[],
  env: Record<string, string>,
  stdin = "",
): Promise<Run> {
  const child = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--no-prompt",
      "--allow-read",
      "--allow-env",
      "--allow-net",
      "--allow-run=deno",
      SCRIPT,
      ...args,
    ],
    cwd: ROOT,
    env: {
      ENV: "dev",
      DB_HOST: "127.0.0.1",
      DB_PORT: "1",
      DB_USER: "u",
      DB_PASS: "p",
      DB_NAME: "fixture_dev_db",
      AUTH_PEPPER: "fixture-pepper-0123456789-0123456789",
      SEED_PASSWORD: "fixture-password",
      ...env,
    },
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn()
  const writer = child.stdin.getWriter()
  await writer.write(new TextEncoder().encode(stdin))
  await writer.close()
  const { code, stdout, stderr } = await child.output()
  const dec = new TextDecoder()
  return { code, out: dec.decode(stdout) + dec.decode(stderr) }
}

async function withProdFile(
  content: string | null,
  body: (flag: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir()
  try {
    const path = `${dir}/.env.prod`
    if (content !== null) await Deno.writeTextFile(path, content)
    await body(`--prod-env-file=${path}`)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

const PROD = "DB_NAME=fixture_prod_db\n"
const WENT_AHEAD = /ECONNREFUSED|Connection|connect/i

Deno.test("db:reset refuses --yes when the production file is missing", async () => {
  await withProdFile(null, async (flag) => {
    const r = await run([flag, "--yes"], {})
    expect(r.code).toBe(1)
    expect(r.out).toContain("no production file to compare against")
    expect(r.out).not.toMatch(WENT_AHEAD)
  })
})

Deno.test("db:reset goes ahead without the production file only with --no-prod-check", async () => {
  await withProdFile(null, async (flag) => {
    const r = await run([flag, "--yes", "--no-prod-check"], {})
    expect(r.code).toBe(1)
    expect(r.out).toContain("(no production file to compare against)")
    expect(r.out).toMatch(WENT_AHEAD)
  })
})

Deno.test("db:reset refuses before it touches the database when a seed variable is missing", async () => {
  await withProdFile(PROD, async (flag) => {
    for (const name of ["AUTH_PEPPER", "SEED_PASSWORD"]) {
      const r = await run([flag, "--yes"], { [name]: "" })
      expect(r.code).toBe(1)
      expect(r.out).toContain(`${name} must be set`)
      expect(r.out).not.toMatch(WENT_AHEAD)
    }
  })
})

Deno.test("db:reset refuses before it touches the database when DB_PORT, DB_USER or DB_PASS is missing", async () => {
  await withProdFile(PROD, async (flag) => {
    for (const name of ["DB_PORT", "DB_USER", "DB_PASS"]) {
      const r = await run([flag, "--yes"], { [name]: "" })
      expect(r.code).toBe(1)
      expect(r.out).toContain(name)
      expect(r.out).not.toContain("Target:")
      expect(r.out).not.toMatch(WENT_AHEAD)
    }
  })
})

Deno.test("db:reset --yes skips the question and goes ahead", async () => {
  await withProdFile(PROD, async (flag) => {
    const r = await run([flag, "--yes"], {}, "n\n")
    expect(r.out).not.toContain("Cancelled")
    expect(r.out).toMatch(WENT_AHEAD)
  })
})

Deno.test("db:reset cancels without touching the database when it must ask and no terminal answers", async () => {
  await withProdFile(PROD, async (flag) => {
    const r = await run([flag], {}, "n\n")
    expect(r.code).toBe(0)
    expect(r.out).toContain("Cancelled. Nothing changed.")
    expect(r.out).not.toMatch(WENT_AHEAD)
  })
})

Deno.test("db:reset reads a CRLF production file and refuses its database name", async () => {
  await withProdFile("DB_NAME=fixture_prod_db\r\nDB_HOST=db\r\n", async (flag) => {
    const r = await run([flag, "--yes"], { DB_NAME: "fixture_prod_db" })
    expect(r.code).toBe(1)
    expect(r.out).toContain("the database name matches production")
    expect(r.out).not.toContain("fixture_prod_db")
  })
})

Deno.test("db:reset refuses a production DB_NAME with $ and never prints it", async () => {
  await withProdFile("DB_NAME=${DB_X:-fixture_victim}\n", async (flag) => {
    const r = await run([flag, "--yes"], { DB_NAME: "fixture_victim" })
    expect(r.code).toBe(1)
    expect(r.out).toContain("variable expansion")
    expect(r.out).not.toContain("fixture_victim")
  })
})

Deno.test("db:reset refuses an IPv6 host with the host message, not a permission error", async () => {
  await withProdFile(PROD, async (flag) => {
    const r = await run([flag, "--yes"], { DB_HOST: "::1" })
    expect(r.code).toBe(1)
    expect(r.out).toContain("the database host is not local")
    expect(r.out).not.toMatch(/permission|PermissionDenied/i)
  })
})
