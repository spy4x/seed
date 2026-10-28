import type postgres from "postgres"
import { type } from "arktype"
import { announceJson, listenJson } from "@spy4x/server/db/notify"

/**
 * The Postgres channel the worker announces a person's picture on once it is ready or refused
 * (#464). Sent inside the job's transaction, so it arrives only after that commits. The API
 * listens and sends the person's open pages the hint to read their profile again.
 */
export const PICTURE_STATE_CHANNEL = `user_picture`

/** Announces that `userId`'s picture changed state. Call it in the transaction of the change. */
export async function announcePictureState(sql: postgres.Sql, userId: number): Promise<void> {
  await announceJson(sql, PICTURE_STATE_CHANNEL, { userId })
}

/** Calls `onChange` for every announcement on {@link PICTURE_STATE_CHANNEL}; answers the stop. */
export async function listenForPictureStates(
  sql: postgres.Sql,
  onChange: (userId: number) => void,
): Promise<() => Promise<void>> {
  return await listenJson(sql, PICTURE_STATE_CHANNEL, {
    schema: type({ userId: `number.integer & number.safe >= 1` }),
    onMessage: ({ userId }) => onChange(userId),
  })
}
