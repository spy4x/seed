/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { isUuid } from "@spy4x/platform/universal/uuid"

/**
 * Fails unless `rows` holds at least one row and every row's id is a UUID version 7. For ids the
 * server makes itself (jobs, outbox rows, tokens, invitations, copies), which no request names.
 */
export function expectVersion7Ids(rows: readonly { id: string }[]): void {
  expect(rows.length).toBeGreaterThan(0)
  expect(rows.map((row) => row.id).filter((id) => !isUuid(id, 7))).toEqual([])
}
