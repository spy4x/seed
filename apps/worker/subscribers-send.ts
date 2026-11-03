/**
 * Queues one issue for a mailing list: `deno task subscribers:send <list> <issue.json | ->`, run in
 * the worker container (`docker exec -i <worker> deno task subscribers:send news - < issue.json`).
 * The issue's shape is `subscriberIssueSchema` (libs/server/jobs/subscriber-issue.ts). The worker's
 * `subscribers.send-issue` job then mails it; running the same issue again mails only the
 * subscribers the earlier runs missed.
 */
import postgres from "postgres"
import { type } from "arktype"
import { createSqlFromEnv, PostgresEnvName } from "@spy4x/server/db"
import {
  exitProcess,
  processArgs,
  processEnv,
  processStdin,
  readEnvRecord,
} from "@spy4x/platform/server/process"
import { runtimeFileSystem } from "@spy4x/platform/server/runtime-fs"
import { isSubscriberList, SUBSCRIBER_LISTS } from "@domain/subscribers"
import {
  queueSubscriberIssue,
  renderSubscriberIssue,
  subscriberIssueSchema,
} from "@server/jobs/subscriber-issue.ts"

const [list, path] = processArgs()
if (!isSubscriberList(list) || !path) {
  console.error(
    `usage: deno task subscribers:send <${SUBSCRIBER_LISTS.join("|")}> <issue.json | ->`,
  )
  exitProcess(2)
}
const domain = processEnv.get("DOMAIN")
if (!domain) {
  console.error("❌ Missing environment variable: DOMAIN")
  exitProcess(1)
}

const raw = path === "-" ? await processStdin.text() : await runtimeFileSystem.readText(path)
if (raw === null) {
  console.error(`❌ No file at ${path}`)
  exitProcess(1)
}
let parsed: unknown
try {
  parsed = JSON.parse(raw)
} catch {
  console.error("❌ The issue is not valid JSON")
  exitProcess(1)
}
const issue = subscriberIssueSchema(parsed)
if (issue instanceof type.errors) {
  console.error(`❌ The issue is not valid: ${issue.summary}`)
  exitProcess(1)
}

const sql = createSqlFromEnv(readEnvRecord(Object.values(PostgresEnvName)), {
  transform: postgres.camel,
  applicationName: "subscribers-send",
  // sendIssue runs in the worker; this only writes two rows.
  max: 1,
})
if (!sql) {
  console.error("❌ Missing environment variable: DB_HOST")
  exitProcess(1)
}
try {
  const brand = { webAppUrl: `http${processEnv.get("ENV") === "dev" ? "" : "s"}://${domain}` }
  await queueSubscriberIssue(sql, list, renderSubscriberIssue(brand, issue))
  console.log(`Queued issue ${issue.id} for the ${list} list; the worker sends it`)
} finally {
  await sql.end()
}
