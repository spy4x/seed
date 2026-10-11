import type postgres from "postgres"
import { type } from "arktype"
import { announceJson, listenJson } from "@spy4x/server/db/notify"
import type { OutboxEvent, OutboxPublisher } from "@spy4x/server/outbox"
import { GROUP_AGGREGATE } from "@domain/groups"

/** The Postgres channel the worker announces group changes on and the API listens to. */
export const GROUP_CHANGE_CHANNEL = "group_change"

/** A group moved to `sequence`. Carries no data: a client that is behind pulls it. */
export interface GroupChange {
  groupId: string
  sequence: number
}

/** What a payload on {@link GROUP_CHANGE_CHANNEL} must look like; anything else is dropped. */
export const groupChangeSchema = type({
  groupId: "string.uuid",
  sequence: "number.integer & number.safe >= 1",
})

/**
 * Turns one committed outbox row into a Postgres notification, which is how a change reaches the
 * API process that holds the sockets (the worker holds none).
 *
 * The notification is a wake-up, not a delivery guarantee: one sent while the API is down is lost.
 * That is by design (ADR 002, "Push with sequence, pull as the authority"): a client that missed a
 * hint pulls when it reconnects or sees a gap, so a lost notification costs a pull, never
 * divergence. A row of another aggregate is not a group change and is left alone.
 */
export class GroupChangeNotifier implements OutboxPublisher {
  constructor(private readonly sql: postgres.Sql) {}

  async publish(event: OutboxEvent): Promise<void> {
    if (event.aggregateType !== GROUP_AGGREGATE) return
    const sequence = Number(event.aggregateVersion)
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new RangeError(`outbox row ${event.id} has no usable sequence`)
    }
    const change: GroupChange = { groupId: event.aggregateId, sequence }
    await announceJson(this.sql, GROUP_CHANGE_CHANNEL, change)
  }
}

/**
 * Calls `onChange` for every group change announced on {@link GROUP_CHANGE_CHANNEL}. Postgres.js
 * re-listens after a dropped connection. Returns a function that stops listening.
 */
export async function listenForGroupChanges(
  sql: postgres.Sql,
  onChange: (change: GroupChange) => void,
): Promise<() => Promise<void>> {
  return await listenJson(sql, GROUP_CHANGE_CHANNEL, {
    schema: groupChangeSchema,
    onMessage: ({ groupId, sequence }) => onChange({ groupId, sequence }),
  })
}

/**
 * The Postgres channel on which a change that takes people's access to a group away names them. It
 * is sent from inside that change's transaction (`recordAccessChange` in `group-change-log.ts`), so
 * Postgres delivers it only once the change has committed, and never for one that rolled back.
 */
export const GROUP_ACCESS_LOST_CHANNEL = "group_access_lost"

/** The change at `sequence` took these users' access to the group away. */
export interface GroupAccessLoss {
  groupId: string
  sequence: number
  userIds: number[]
}

/** What a payload on {@link GROUP_ACCESS_LOST_CHANNEL} must look like; anything else is dropped. */
export const groupAccessLossSchema = type({
  groupId: "string.uuid",
  sequence: "number.integer & number.safe >= 1",
  userIds: "(number.integer & number.safe >= 1)[] > 0",
})

/**
 * Calls `onLoss` for every access loss announced on {@link GROUP_ACCESS_LOST_CHANNEL}. Returns a
 * function that stops listening.
 */
export async function listenForGroupAccessLoss(
  sql: postgres.Sql,
  onLoss: (loss: GroupAccessLoss) => void,
): Promise<() => Promise<void>> {
  return await listenJson(sql, GROUP_ACCESS_LOST_CHANNEL, {
    schema: groupAccessLossSchema,
    onMessage: ({ groupId, sequence, userIds }) => onLoss({ groupId, sequence, userIds }),
  })
}
