/// <reference lib="deno.ns" />
/**
 * Makes a product's administrator from the server, for a product with no mail or no sign-up
 * (`SPA=false`): `deno task operator:create <address>`, run where the database is reachable, such as
 * the worker container (docs/deploy.md, "The first operator"). It asks for the password at a
 * prompt that shows nothing typed, twice, or reads one line from a pipe. It never takes the password
 * as an argument, where the shell history and the process list would keep it, and never prints it.
 *
 * - Nobody signs in with the address: it creates the account with that password, its address
 *   proven, and makes it an administrator, who signs in to the admin app with the password.
 * - Somebody does: it makes them an administrator, or leaves them one, and asks for no password.
 *   Their password stays as it is.
 *
 * So a second run changes nothing. A role change writes an audit row on the person naming the
 * script ({@link OPERATOR_CREATE_ACTOR}), as `deno task user:role` does. Exit codes: 0 done, 1
 * refused or failed, 2 a usage error.
 *
 * @module
 */
import postgres from "postgres"
import { createSqlFromEnv } from "@spy4x/server/db"
import { normalizeEmail } from "@spy4x/server/auth"
import { HiddenLine, KeyResult } from "@spy4x/server/sign-in/password-hash"
import { authPasswordSchema, USER_ROLE_NAMES, UserRole } from "@domain/identity"
import { setUserRoleByAddress } from "@server/auth/admin-users.ts"
import { AppDbBase } from "../api/services/db-base.ts"
import { prove, SeedRefusedError, signUp } from "./demo/seed.ts"

/** Who the script's audit rows name. */
export const OPERATOR_CREATE_ACTOR = `cli:operator-create`

/** The usage line the script prints on a wrong argument. */
export const OPERATOR_CREATE_USAGE =
  `usage: deno task operator:create <address>  (the password is asked for, never an argument)`

/** The address of `<address>`, normalised as sign-up stores it, or `null` for anything else. */
export function parseOperatorCreateArgs(args: readonly string[]): string | null {
  return args.length === 1 ? normalizeEmail(args[0]) : null
}

/** What a run did. */
export enum OperatorCreateOutcome {
  Created = 1,
  Raised = 2,
  Unchanged = 3,
}

/** What {@link createOperator} needs from the database and the terminal. */
export interface OperatorCreatePorts {
  /** Makes whoever signs in with `address` an administrator; `null` when nobody does. */
  raise(address: string): Promise<{ id: number; previous: UserRole } | null>
  /** The new account's password, or `null` when none was given. */
  askPassword(): Promise<string | null>
  /** Creates the account of `address` with `password`, its address proven. */
  create(address: string, password: string): Promise<void>
}

/** The answer of {@link createOperator}: the person and what changed, or why nothing did. */
export type OperatorCreateResult =
  | { outcome: OperatorCreateOutcome; id: number }
  | { error: string }

/**
 * Makes `address` an administrator, creating the account when nobody signs in with it. The
 * password is asked for only then, and checked before anything is written.
 */
export async function createOperator(
  address: string,
  ports: OperatorCreatePorts,
): Promise<OperatorCreateResult> {
  const existing = await ports.raise(address)
  if (existing) {
    const outcome = existing.previous === UserRole.ADMIN
      ? OperatorCreateOutcome.Unchanged
      : OperatorCreateOutcome.Raised
    return { outcome, id: existing.id }
  }
  const password = await ports.askPassword()
  if (password === null) return { error: `No password was given, so nothing was created` }
  if (!authPasswordSchema.allows({ password })) {
    return { error: `The password must be 8 to 50 characters, so nothing was created` }
  }
  await ports.create(address, password)
  const created = await ports.raise(address)
  if (!created) throw new Error(`the account of ${address} was created but cannot be found`)
  return { outcome: OperatorCreateOutcome.Created, id: created.id }
}

/** The line a run prints. It names the address and the user, never the password. */
export function operatorCreateMessage(address: string, result: OperatorCreateResult): string {
  if (`error` in result) return `❌ ${result.error}`
  const role = USER_ROLE_NAMES[UserRole.ADMIN]
  switch (result.outcome) {
    case OperatorCreateOutcome.Created:
      return `✅ Created user ${result.id} for ${address}, an ${role}. Sign in to the admin app with this address and the password.`
    case OperatorCreateOutcome.Raised:
      return `✅ User ${result.id} (${address}) is now an ${role}. Their password is unchanged.`
    case OperatorCreateOutcome.Unchanged:
      return `User ${result.id} (${address}) is already an ${role}. Nothing changed.`
  }
}

/** The ports of {@link createOperator} on a real database, with the API's `pepper`. */
export function databasePorts(
  sql: postgres.Sql,
  pepper: string,
  askPassword: () => Promise<string | null>,
): OperatorCreatePorts {
  const db = new AppDbBase({ sql })
  return {
    raise: (address) => setUserRoleByAddress(sql, address, UserRole.ADMIN, OPERATOR_CREATE_ACTOR),
    askPassword,
    create: async (address, password) => {
      await signUp(db, pepper, address, password)
      await prove(db, address)
    },
  }
}

/** Standard input as {@link readSecret} reads it. */
export interface SecretInput {
  isTerminal(): boolean
  setRaw(raw: boolean): void
  read(buffer: Uint8Array): Promise<number | null>
}

/**
 * Reads one line after writing `prompt`, then a line break. On a terminal it turns echo off first and
 * on again after, so nothing typed shows, and the library's hidden prompt (`HiddenLine`) takes the
 * keys: Backspace erases, arrow and other escape sequences are dropped, Ctrl+C or Ctrl+D answers
 * `null`. From a pipe it reads the first line.
 */
export async function readSecret(
  input: SecretInput,
  write: (text: string) => void,
  prompt: string,
): Promise<string | null> {
  write(prompt)
  try {
    return input.isTerminal() ? await readHiddenLine(input) : await readFirstLine(input)
  } finally {
    // The Enter typed is not shown, and a pipe's line is not either.
    write(`\n`)
  }
}

/** One line typed with echo off, as `HiddenLine` reads it; the buffers are zeroed after. */
async function readHiddenLine(input: SecretInput): Promise<string | null> {
  input.setRaw(true)
  const line = new HiddenLine()
  const buffer = new Uint8Array(64)
  try {
    while (true) {
      const read = await input.read(buffer)
      if (read === null) return null
      for (const byte of buffer.subarray(0, read)) {
        const result = line.type(byte)
        if (result === KeyResult.Cancel) return null
        if (result === KeyResult.Submit) return new TextDecoder().decode(new Uint8Array(line.bytes))
      }
    }
  } finally {
    buffer.fill(0)
    line.bytes.fill(0)
    input.setRaw(false)
  }
}

/** The first line of piped input, without its line break; `null` for no input at all. */
async function readFirstLine(input: SecretInput): Promise<string | null> {
  const decoder = new TextDecoder()
  const buffer = new Uint8Array(1024)
  let text = ``
  while (true) {
    const read = await input.read(buffer)
    if (read === null) return text === `` ? null : text
    text += decoder.decode(buffer.subarray(0, read), { stream: true })
    const end = text.search(/\r?\n/)
    if (end >= 0) return text.slice(0, end)
  }
}

/**
 * Asks for a new password: twice on a terminal, so a typo cannot lock the operator out, and once
 * from a pipe. `null` when none was given or the two differ.
 */
export async function askNewPassword(
  input: SecretInput,
  write: (text: string) => void,
): Promise<string | null> {
  const password = await readSecret(input, write, `Password for the new account: `)
  if (password === null || !input.isTerminal()) return password
  const again = await readSecret(input, write, `The same password again: `)
  if (again === password) return password
  write(`The two passwords differ.\n`)
  return null
}

if (import.meta.main) {
  const address = parseOperatorCreateArgs(Deno.args)
  if (!address) {
    console.error(OPERATOR_CREATE_USAGE)
    Deno.exit(2)
  }
  const pepper = Deno.env.get(`AUTH_PEPPER`) ?? ``
  if (pepper.length < 32) {
    console.error(`❌ AUTH_PEPPER must be set to the API's value (32 characters or more)`)
    Deno.exit(1)
  }
  const sql = createSqlFromEnv(Deno.env.toObject(), {
    transform: postgres.camel,
    applicationName: `operator-create`,
    max: 1,
  })
  if (!sql) {
    console.error(`❌ Missing environment variable: DB_HOST`)
    Deno.exit(1)
  }
  const encoder = new TextEncoder()
  const write = (text: string) => void Deno.stderr.writeSync(encoder.encode(text))
  const stdin: SecretInput = {
    isTerminal: () => Deno.stdin.isTerminal(),
    setRaw: (raw) => Deno.stdin.setRaw(raw),
    read: (buffer) => Deno.stdin.read(buffer),
  }
  let result: OperatorCreateResult
  try {
    result = await createOperator(
      address,
      databasePorts(sql, pepper, () => askNewPassword(stdin, write)),
    )
  } catch (error) {
    if (!(error instanceof SeedRefusedError)) throw error
    result = {
      error: `Sign-up refused ${address}: an account holds it already, a deleted one perhaps`,
    }
  } finally {
    await sql.end()
  }
  const message = operatorCreateMessage(address, result)
  if (`error` in result) {
    console.error(message)
    Deno.exit(1)
  }
  console.log(message)
}
