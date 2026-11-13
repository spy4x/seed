/**
 * What the IndexNow jobs share (docs/blog.md#indexnow, docs/catalog.md#indexnow): the setup, the
 * deduplicated queueing in the write's transaction, and one fail-open ping.
 *
 * @module
 */
import type postgres from "postgres"
import { submitIndexNow } from "@spy4x/integrations/indexnow"
import { readIndexNowKey } from "@domain/blog"
import { readSiteUrl } from "../subscribers/subscribers.ts"
import { enqueueJob, JOB_AGGREGATE } from "./jobs.ts"

/** What IndexNow needs: the site's key and the public website's origin, such as `https://www.example.com`. */
export interface IndexNowSetup {
  key: string
  siteUrl: string
}

/**
 * IndexNow's setup from `INDEXNOW_KEY` and `MPA_DOMAIN`, or `null` when either is unset: then the
 * IndexNow jobs send nothing. Plain HTTP only in development, as for the website itself.
 *
 * @throws Error when `INDEXNOW_KEY` is not a key IndexNow takes, or `MPA_DOMAIN` carries a scheme.
 */
export function readIndexNowSetup(
  env: { get(name: string): string | undefined },
  mode: `dev` | `prod`,
): IndexNowSetup | null {
  const key = readIndexNowKey(env)
  const siteUrl = readSiteUrl(env, mode)
  return key === null || siteUrl === null ? null : { key, siteUrl }
}

/**
 * Queues the IndexNow job `kind` about `aboutId` in the write's transaction, unless one waits that
 * no worker has taken yet: that one reads its row when it runs, so it sends this change too.
 */
export async function queueIndexNow(
  sql: postgres.Sql,
  kind: string,
  aboutId: string,
): Promise<void> {
  const [waiting] = await sql`
    SELECT 1 FROM outbox_events
    WHERE aggregate_type = ${JOB_AGGREGATE} AND aggregate_id = ${aboutId}
      AND event_kind = ${kind} AND processed_at IS NULL AND claimed_at IS NULL
  `
  if (!waiting) await enqueueJob(sql, kind, aboutId, { inMs: 0 })
}

/**
 * Sends `urls` to IndexNow. A failure is logged once as a warning about `about` (such as
 * `blog post <id>`), with the key redacted, and never thrown: the job succeeds and is not retried.
 */
export async function pingIndexNow(
  setup: IndexNowSetup,
  urls: string[],
  about: string,
  deps: { log: (line: string) => void; fetch?: typeof fetch },
): Promise<void> {
  const { key, siteUrl } = setup
  const result = await submitIndexNow({
    host: new URL(siteUrl).hostname,
    key,
    urls,
    fetch: deps.fetch,
  })
  if (!result.success) {
    deps.log(
      `warning: IndexNow was not told about ${about}: ` +
        result.error.replaceAll(key, `<REDACTED:KEY>`),
    )
  }
}
