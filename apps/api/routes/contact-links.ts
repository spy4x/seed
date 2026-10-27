import { Hono } from "hono"
import type postgres from "postgres"
import type { PublicContactLink, PublicContactLinksResponse } from "@domain/contact-links"
import { listPublicContactLinks } from "@server/contact-links/postgres-contact-links.ts"

/**
 * The public contact links (#465), mounted at `/api/contact-links` for the public website, whose
 * footer and structured data name them. No session: the links are on every page anyway.
 *
 * - `GET /` lists every link in the operator's order: its kind, value and label, no id.
 */
export function createPublicContactLinksRoute(list: () => Promise<PublicContactLink[]>): Hono {
  return new Hono().get(`/`, async (c) => {
    const answer: PublicContactLinksResponse = { links: await list() }
    return c.json(answer)
  })
}

/** The read over the app's database. */
export function createPublicContactLinksRead(
  sql: postgres.Sql,
): () => Promise<PublicContactLink[]> {
  return () => listPublicContactLinks(sql)
}
