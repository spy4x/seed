import type postgres from "postgres"
import type { AuditDetails, AuditEntityType } from "@domain/groups"

/** One audit event, as the activity log will later read it. */
export interface AuditEventInput {
  eventKind: string
  actorId: number
  groupId: string
  requestId?: string
  /** The member the event is about: a role change, a removal, a transfer. */
  targetUserId?: number
  entityType?: AuditEntityType
  entityId?: string
  /** Short facts the log's sentence needs: names, roles, a count. */
  details?: AuditDetails
}

/**
 * Writes one audit row in the caller's transaction, so the row exists exactly when the change it
 * records does. Every group event goes through here, which is what keeps the log's columns in one
 * shape.
 *
 * With `ignoreRepeat`, a row a unique index refuses is skipped instead of failing: the operator's
 * file reads use it, whose index makes a repeated request write one row.
 */
export async function writeAuditEvent(
  sql: postgres.Sql,
  event: AuditEventInput,
  options: { ignoreRepeat?: boolean } = {},
): Promise<void> {
  await sql`
    INSERT INTO audit_events (
      event_kind, actor_user_id, group_id, request_id,
      target_user_id, entity_type, entity_id, details
    ) VALUES (
      ${event.eventKind}, ${event.actorId}, ${event.groupId}, ${event.requestId || null},
      ${event.targetUserId ?? null}, ${event.entityType ?? null}, ${event.entityId ?? null},
      ${sql.json(event.details ?? {})}
    )
    ${options.ignoreRepeat ? sql`ON CONFLICT DO NOTHING` : sql``}
  `
}
