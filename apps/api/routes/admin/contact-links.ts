import { type Context, Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import { type } from "arktype"
import type postgres from "postgres"
import { isUuid } from "@spy4x/platform/universal/uuid"
import { JSON_BODY_WRONG_TYPE, readJsonBody } from "@spy4x/server/http/bounded-body"
import {
  contactLinkCreateSchema,
  ContactLinkError,
  type ContactLinkFields,
  contactLinkOrderSchema,
  type ContactLinkRecord,
  contactLinkUpdateSchema,
  ContactLinkVersionConflictError,
  contactLinkVersionSchema,
  parseContactLinkFields,
} from "@domain/contact-links"
import {
  type ContactLinkActor,
  PostgresContactLinks,
} from "@server/contact-links/postgres-contact-links.ts"
import type { APIContext } from "../../_types.ts"
import type { AdminApiModule } from "./module.ts"
import { codeForStatus, errorResponse } from "../../services/error-response.ts"

/** The largest body a contact-link route takes: a few short fields, or twenty ids. */
export const CONTACT_LINKS_BODY_MAX_BYTES = 16 * 1024

/** What the contact-link routes call. Who may call it is the route's business. */
export interface AdminContactLinksService {
  list(): Promise<ContactLinkRecord[]>
  create(id: string, fields: ContactLinkFields, actor: ContactLinkActor): Promise<ContactLinkRecord>
  update(
    id: string,
    version: number,
    fields: ContactLinkFields,
    actor: ContactLinkActor,
  ): Promise<ContactLinkRecord>
  delete(id: string, version: number, actor: ContactLinkActor): Promise<void>
  reorder(ids: readonly string[], actor: ContactLinkActor): Promise<ContactLinkRecord[]>
}

/** What the contact-link routes need. */
export interface AdminContactLinksRouteDependencies {
  /** The normal per-user budget the session routes spend too. */
  limit: MiddlewareHandler<APIContext>
  links: AdminContactLinksService
}

function invalid(message: string): ContactLinkError {
  return new ContactLinkError(`INVALID_REQUEST`, message)
}

/** Reads and checks the request's JSON body against `schema`; throws `INVALID_REQUEST`. */
async function readBody<T>(
  c: Context<APIContext>,
  schema: (input: unknown) => T | type.errors,
): Promise<T> {
  let refused: ContactLinkError | undefined
  let body: unknown
  try {
    body = await readJsonBody(c, {
      maxBytes: CONTACT_LINKS_BODY_MAX_BYTES,
      requireJsonContentType: true,
      toError: ({ status }) =>
        refused = invalid(status === 415 ? JSON_BODY_WRONG_TYPE : `Request body must be JSON`),
    })
  } catch (_error) {
    throw refused ?? invalid(`Request body must be JSON`)
  }
  const checked = schema(body)
  if (checked instanceof type.errors) throw invalid(checked.summary)
  return checked
}

/** The status a refusal answers with. */
function statusOf(error: ContactLinkError): 400 | 404 | 409 {
  if (error.code === `LINK_NOT_FOUND`) return 404
  if (error.code === `INVALID_REQUEST`) return 400
  return 409
}

/** The operator behind the request, for the audit row. */
function actorOf(c: Context<APIContext>): ContactLinkActor {
  return { userId: c.get(`auth`)!.user.id, requestId: c.get(`requestId`) ?? null }
}

/**
 * The contact-link routes of the operator area (#465), mounted at `/api/admin` behind the gate in
 * `+routes.ts`: only an operator with a full session reaches them, and every `POST` passed the
 * same-origin guard. Every change writes an audit row on the operator.
 *
 * - `GET /contact-links` lists every link, in order.
 * - `POST /contact-links` adds one after the others: `{ id, kind, value, label? }` with a
 *   client-made UUID v7 id. 201. The value is normalised (`@t_me` → `t_me`) before it is checked.
 * - `POST /contact-links/order` takes `{ ids }`, every link's id in the new order, and answers
 *   the links in it; a list that is not the current set of links is refused with 409.
 * - `POST /contact-links/:id` saves `{ version, kind, value, label? }`.
 * - `POST /contact-links/:id/delete` takes `{ version }`.
 *
 * A refusal answers the API's error shape, with `field` when it is about one field and
 * `currentVersion` on a version conflict.
 */
export function createAdminContactLinksRoutes(
  { limit, links }: AdminContactLinksRouteDependencies,
): Hono<APIContext> {
  /** The link id in the path, or a refusal: an id that is no UUID is no link. */
  const idOf = (c: Context<APIContext>): string => {
    const id = c.req.param(`id`) ?? ``
    if (!isUuid(id)) throw new ContactLinkError(`LINK_NOT_FOUND`, `This link does not exist.`)
    return id.toLowerCase()
  }

  const route = new Hono<APIContext>()
  route.onError((error, c) => {
    if (error instanceof ContactLinkVersionConflictError) {
      return errorResponse(c, `conflict`, {
        message: error.message,
        reason: error.code,
        details: { currentVersion: error.currentVersion },
      })
    }
    if (error instanceof ContactLinkError) {
      const status = statusOf(error)
      return errorResponse(c, codeForStatus(status), {
        message: error.message,
        reason: error.code,
        status,
        ...(error.field && { details: { field: error.field } }),
      })
    }
    throw error
  })

  return route
    .get(`/contact-links`, limit, async (c) => c.json({ links: await links.list() }))
    .post(`/contact-links`, limit, async (c) => {
      const { id, ...input } = await readBody(c, contactLinkCreateSchema)
      const link = await links.create(id.toLowerCase(), parseContactLinkFields(input), actorOf(c))
      return c.json({ link }, 201)
    })
    .post(`/contact-links/order`, limit, async (c) => {
      const { ids } = await readBody(c, contactLinkOrderSchema)
      const ordered = ids.map((id) => id.toLowerCase())
      return c.json({ links: await links.reorder(ordered, actorOf(c)) })
    })
    .post(`/contact-links/:id`, limit, async (c) => {
      const id = idOf(c)
      const { version, ...input } = await readBody(c, contactLinkUpdateSchema)
      const fields = parseContactLinkFields(input)
      return c.json({ link: await links.update(id, version, fields, actorOf(c)) })
    })
    .post(`/contact-links/:id/delete`, limit, async (c) => {
      const id = idOf(c)
      const { version } = await readBody(c, contactLinkVersionSchema)
      await links.delete(id, version, actorOf(c))
      return c.json({ deleted: true })
    })
}

/** The service over the app's database. */
export function createAdminContactLinks(sql: postgres.Sql): AdminContactLinksService {
  const repository = new PostgresContactLinks(sql)
  return {
    list: () => repository.list(),
    create: (id, fields, actor) => repository.create(id, fields, actor),
    update: (id, version, fields, actor) => repository.update(id, version, fields, actor),
    delete: (id, version, actor) => repository.delete(id, version, actor),
    reorder: (ids, actor) => repository.reorder(ids, actor),
  }
}

/** The contact-links module: where people reach the product, as the website shows it (#465). */
export const contactLinksAdminModule: AdminApiModule = {
  id: `contact-links`,
  routes: ({ sql, limit }) =>
    createAdminContactLinksRoutes({ limit, links: createAdminContactLinks(sql) }),
}
