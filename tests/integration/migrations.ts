/// <reference lib="deno.ns" />
import type postgres from "postgres"

/**
 * The migrations as production applies them: every `.sql` file in the folder, in file-name order.
 * A test that builds its schema from here gets a new migration without anyone editing the test.
 */

export const MIGRATIONS_DIR = "libs/server/db/migrations"

/** Every migration file name in the folder, sorted, which is the order the runner applies them. */
export function migrationNames(): string[] {
  return [...Deno.readDirSync(MIGRATIONS_DIR)]
    .filter((entry) => entry.isFile && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort()
}

/** Runs the named migration files on `sql`, in the order given (every migration by default). */
export async function applyMigrations(
  sql: postgres.Sql,
  names: readonly string[] = migrationNames(),
): Promise<void> {
  for (const name of names) {
    await sql.unsafe(await Deno.readTextFile(`${MIGRATIONS_DIR}/${name}`))
  }
}
