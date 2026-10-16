/// <reference lib="deno.ns" />
/**
 * Gives a person a role: `deno task user:role <address> <viewer|operator|supervisor|administrator>`,
 * run where the database is reachable, such as the worker container
 * (`docker exec <worker> deno task user:role ops@example.com operator`). The role decides who opens
 * the admin app (#146): operator and above. In the admin app an administrator may change a role
 * below their own (#425); an administrator is made here.
 *
 * The address is the one the person signs in with, matched as sign-up stores it (trimmed, lower
 * case). The script exits 1 when no live person signs in with it, and 2 on a usage error. A change
 * writes an audit row on the person naming the script ({@link USER_ROLE_ACTOR}), in the same
 * transaction.
 */
import postgres from "postgres"
import { createSqlFromEnv } from "@spy4x/server/db"
import { USER_ROLE_NAMES, type UserRole, userRoleNamed } from "@domain/identity"
import { setUserRoleByAddress } from "@server/auth/admin-users.ts"

/** Who the script's audit rows name (#425). */
export const USER_ROLE_ACTOR = "cli:user-role"

/** The usage line the script prints on a wrong argument. */
export const USER_ROLE_USAGE = `usage: deno task user:role <address> <${
  Object.values(USER_ROLE_NAMES).join("|")
}>`

/** Reads `<address> <role>`, or `null` when either is missing or names no role. */
export function parseUserRoleArgs(
  args: readonly string[],
): { address: string; role: UserRole } | null {
  const [address, roleName] = args
  if (args.length !== 2 || !address?.trim() || !roleName) return null
  const role = userRoleNamed(roleName)
  return role === null ? null : { address: address.trim(), role }
}

if (import.meta.main) {
  const parsed = parseUserRoleArgs(Deno.args)
  if (!parsed) {
    console.error(USER_ROLE_USAGE)
    Deno.exit(2)
  }
  const sql = createSqlFromEnv(Deno.env.toObject(), {
    transform: postgres.camel,
    applicationName: "user-role",
    max: 1,
  })
  if (!sql) {
    console.error("❌ Missing environment variable: DB_HOST")
    Deno.exit(1)
  }
  let changed: Awaited<ReturnType<typeof setUserRoleByAddress>>
  try {
    changed = await setUserRoleByAddress(sql, parsed.address, parsed.role, USER_ROLE_ACTOR)
  } finally {
    await sql.end()
  }
  if (changed === null) {
    console.error(`❌ Nobody signs in with ${parsed.address}`)
    Deno.exit(1)
  }
  console.log(
    changed.previous === parsed.role
      ? `User ${changed.id} is already ${USER_ROLE_NAMES[parsed.role]}`
      : `User ${changed.id} is now ${USER_ROLE_NAMES[parsed.role]}`,
  )
}
