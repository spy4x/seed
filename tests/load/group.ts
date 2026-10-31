/// <reference lib="deno.ns" />
/**
 * `deno task load:group`: builds, removes or explains the large load-test group of one tier
 * (spy4x/seed#440). docs/capacity.md, "One large group", says what a tier holds and how to run it
 * against the local stack or the public demo.
 *
 * - It reads the database's name, user and password from one env file, `infra/envs/.env` unless
 *   `--env-file` names another, and refuses one that describes neither a development stack nor the
 *   public demo (`connectionTarget`).
 * - It connects to 127.0.0.1 only, on the port the stack publishes or the one `--port` names (an
 *   SSH tunnel to the demo server). The task's network grant allows no other host.
 *
 * @module
 */
import postgres from "postgres"
import { readEnvFile } from "../../infra/scripts/env-file.ts"
import { buildGroup, removeGroup } from "./group-db.ts"
import { explainGroup } from "./group-explain.ts"
import { connectionTarget, parseGroupArgs, planTier } from "./group-plan.ts"

const command = (() => {
  try {
    return parseGroupArgs(Deno.args)
  } catch (error) {
    console.error((error as Error).message)
    Deno.exit(2)
  }
})()

const target = connectionTarget(await readEnvFile(command.envFile), command.port)
const sql = postgres({
  host: `127.0.0.1`,
  port: target.port,
  database: target.database,
  username: target.user,
  password: target.password,
  max: 1,
  transform: postgres.camel,
  onnotice: () => {},
})
const log = (line: string) => console.log(line)

try {
  if (command.action === `build`) {
    const result = await buildGroup(sql, planTier(command.tier), command.members, log)
    console.log(`Group ${result.groupId} "${result.name}"`)
  } else if (command.action === `remove`) {
    for (const tier of command.tiers) {
      const removed = await removeGroup(sql, planTier(tier))
      console.log(
        `${tier}: removed ${removed.groups} group, ${removed.people} generated people, ` +
          `${removed.notifications} notifications`,
      )
    }
  } else {
    console.log(await explainGroup(sql, planTier(command.tier)))
  }
} finally {
  await sql.end({ timeout: 5 })
}
