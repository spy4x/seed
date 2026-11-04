/**
 * Applies every pending migration under `libs/server/db/migrations` to Postgres.
 *
 * A thin entry point over `@spy4x/server/db`'s migration runner: connection settings
 * and the migrations folder are the only things this script decides, the mechanics
 * (locking, checksums, history table) live in the package. It runs on Deno, Node and Bun: the
 * Node and Bun images run it from a bundle (`apps/api/dockerfile.node`, `apps/api/dockerfile.bun`).
 */
import {
  createSqlFromEnv,
  type MigrationReader,
  PostgresMigrationDriver,
  runMigrations,
} from "@spy4x/server/db"
import { exitProcess } from "@spy4x/platform/server/process"
import { runtimeFileSystem } from "@spy4x/platform/server/runtime-fs"
import { join } from "@std/path"
import { postgresEnv } from "../../apps/api/services/db-direct.ts"

const migrationsFolder = "./libs/server/db/migrations"

/** The runner's default reader calls `Deno.readDir`; this one works on every runtime. */
const reader: MigrationReader = {
  list: async (folder) =>
    (await runtimeFileSystem.readDir(folder)).filter((entry) => entry.isFile).map((entry) =>
      entry.name
    ),
  readText: async (folder, fileName) => {
    const text = await runtimeFileSystem.readText(join(folder, fileName))
    if (text === null) throw new Error(`Migration ${fileName} disappeared while reading it`)
    return text
  },
}

const sql = createSqlFromEnv(postgresEnv())
if (!sql) {
  console.error("❌ Missing environment variable: DB_HOST")
  exitProcess(1)
}

try {
  const driver = new PostgresMigrationDriver({ sql })
  const report = await runMigrations(driver, { folder: migrationsFolder, reader })

  if (report.applied.length) {
    console.log(`Applied ${report.applied.length} migration(s):`)
    for (const name of report.applied) {
      console.log("- " + name)
    }
  } else {
    console.log("✅ No new migrations to apply.")
  }

  if (report.missing.length) {
    console.log(`⚠️  ${report.missing.length} recorded migration(s) have no file on disk:`)
    for (const name of report.missing) {
      console.log("- " + name)
    }
  }

  console.log("\n✅ Migrations successfully applied.")
} catch (err) {
  console.error("\n❌ Failed to apply migrations\n", err)
  exitProcess(1)
} finally {
  await sql.end({ timeout: 5 })
}
