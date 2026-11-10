import type postgres from "postgres"
import {
  effectivePlanId,
  entitlementsOf,
  type LimitKey,
  type Plan,
  UNLIMITED,
} from "@domain/billing"
import {
  IMPORT_EVENTS,
  IMPORT_SAMPLE_ROWS,
  ImportError,
  type ImportMapping,
  ImportStatus,
} from "@domain/imports"
import type { JobHandler } from "@server/jobs/jobs.ts"
import { PostgresBillingRepository } from "../billing/postgres-billing-repository.ts"
import { assertMapping, checkRows, columnCount, type ImportKind } from "./import-kind.ts"
import {
  announceImport,
  assertMayAct,
  lockRole,
  refusalText,
} from "./postgres-import-repository.ts"

/** How long an import may wait unsaved before the nightly cleanup deletes it with its file. */
export const IMPORT_STALE_MS = 24 * 60 * 60 * 1000

/** The longest failure text kept, as `imports.failure` holds it. */
const FAILURE_MAX = 500

/** What the commit job needs to read the group's caps; billing off when `provider` is false. */
export interface ImportJobSetup {
  kinds: readonly ImportKind[]
  billingEnabled: boolean
  graceDays: number
  plans?: readonly Plan[]
}

/**
 * Reads the file of the import the job names with its kind's `read`, and stores the columns, a
 * sample, the row count and the guessed mapping (`READY`), or why it cannot be read (`FAILED`, the
 * file dropped). It runs only on a `READING` import, so a rerun finds the work done and stops.
 */
export function importReadJob(sql: postgres.Sql, kinds: readonly ImportKind[]): JobHandler {
  return async (event) => {
    await sql.begin(async (tx) => {
      const row = await lockImport(tx, event.aggregateId)
      if (!row || row.status !== ImportStatus.READING) return
      const kind = kinds.find((one) => one.id === row.kind)
      const read = !kind
        ? { ok: false as const, error: `Nothing can be imported as ${row.kind}.` }
        : !row.file
        ? { ok: false as const, error: `The file is gone.` }
        : row.file.byteLength > kind.maxBytes
        ? { ok: false as const, error: `The file is larger than ${kind.label} allow.` }
        : await kind.read(row.file)
      if (!read.ok) {
        await fail(tx, event.aggregateId, read.error)
        await announceImport(tx, row.groupId, row.userId, IMPORT_EVENTS.failed)
        return
      }
      const { columns, rows, mapping } = read.value
      await tx`
        UPDATE imports SET status = ${ImportStatus.READY},
          columns = ${columns === null ? null : tx.json(columns)},
          sample = ${tx.json(rows.slice(0, IMPORT_SAMPLE_ROWS) as string[][])},
          mapping = ${tx.json(mapping)}, row_count = ${rows.length}, read_at = CURRENT_TIMESTAMP
        WHERE id = ${event.aggregateId}
      `
      await announceImport(tx, row.groupId, row.userId, IMPORT_EVENTS.read)
    })
  }
}

/**
 * Saves a `COMMITTING` import: reads its file again, checks every row under the saved mapping and
 * writes every valid row through the kind's `commit`, its batch in `import_records`, in one
 * transaction, then drops the file. Rows with errors are left out and counted. A refusal (the
 * uploader lost the role, the plan is full, the file no longer reads) saves nothing and marks the
 * import `FAILED` with why; any other fault rolls back and the job is tried again. A rerun on a
 * saved import finds it `COMMITTED` and stops, so no row is written twice.
 */
export function importCommitJob(sql: postgres.Sql, setup: ImportJobSetup): JobHandler {
  const billing = new PostgresBillingRepository(sql)
  return async (event) => {
    const id = event.aggregateId
    let refused = null as { text: string; groupId: string; userId: number } | null
    await sql.begin(async (tx) => {
      const row = await lockImport(tx, id)
      if (!row || row.status !== ImportStatus.COMMITTING) return
      const kind = setup.kinds.find((one) => one.id === row.kind)
      try {
        if (!kind) {
          throw new ImportError("INVALID_REQUEST", `Nothing can be imported as ${row.kind}.`)
        }
        // The uploader's role now: one removed or demoted since the upload saves nothing.
        const role = assertMayAct(
          await lockRole(tx, row.groupId, row.userId),
          kind,
          row.userId,
          row.userId,
        )
        if (!row.file) throw new ImportError("IMPORT_REFUSED", `The file is gone.`)
        const read = await kind.read(row.file)
        if (!read.ok) throw new ImportError("IMPORT_REFUSED", read.error)
        const mapping = JSON.parse(row.mappingJson ?? `{}`) as ImportMapping
        assertMapping(kind, mapping, columnCount(read.value))
        const { values, result } = checkRows(kind, read.value.rows, mapping)
        const sequence = await announceImport(tx, row.groupId, row.userId, IMPORT_EVENTS.committed)
        if (sequence === null) throw new ImportError("GROUP_NOT_FOUND", `The group was deleted.`)
        const ids = values.length === 0 ? [] : await kind.commit(tx, values, {
          importId: id,
          groupId: row.groupId,
          actorId: row.userId,
          role,
          changeSequence: sequence,
          allowances: await allowancesOf(billing, row.groupId, setup),
        })
        if (ids.length > 0) {
          await tx`
            INSERT INTO import_records ${tx(ids.map((recordId) => ({ importId: id, recordId })))}
            ON CONFLICT DO NOTHING
          `
        }
        await tx`
          UPDATE imports SET status = ${ImportStatus.COMMITTED}, file = NULL,
            saved_count = ${ids.length}, error_count = ${result.withErrors},
            committed_at = CURRENT_TIMESTAMP
          WHERE id = ${id}
        `
      } catch (error) {
        const text = refusalText(error, kind?.label ?? row.kind)
        if (text === null) throw error
        refused = { text, groupId: row.groupId, userId: row.userId }
        // Rolls back every row the kind wrote; the failure is stored below, on its own.
        throw new Refused()
      }
    }).catch((error) => {
      if (!(error instanceof Refused)) throw error
    })
    if (!refused) return
    const { text, groupId, userId } = refused
    await sql.begin(async (tx) => {
      const row = await lockImport(tx, id)
      if (row?.status !== ImportStatus.COMMITTING) return
      await fail(tx, id, text)
      await announceImport(tx, groupId, userId, IMPORT_EVENTS.failed)
    })
  }
}

/** An import's row as the jobs read it, with its file and its mapping as text. */
interface LockedImport {
  status: ImportStatus
  kind: string
  groupId: string
  userId: number
  file: Uint8Array | null
  mappingJson: string | null
}

/**
 * Locks import `id` for a job's write, or answers `null` when it is gone. The group row is locked
 * first, in the order the API's writes take (group, then import), so a job and a request wait for
 * each other instead of deadlocking.
 */
async function lockImport(tx: postgres.TransactionSql, id: string): Promise<LockedImport | null> {
  const [peek] = await tx<{ groupId: string }[]>`
    SELECT group_id AS "groupId" FROM imports WHERE id = ${id}
  `
  if (!peek) return null
  await tx`SELECT 1 FROM groups WHERE id = ${peek.groupId} FOR NO KEY UPDATE`
  const [row] = await tx<LockedImport[]>`
    SELECT status, kind, group_id AS "groupId", user_id AS "userId", file,
      mapping::text AS "mappingJson"
    FROM imports WHERE id = ${id}
    FOR UPDATE
  `
  return row ?? null
}

/** Thrown inside the commit's transaction to roll it back on a refusal. */
class Refused extends Error {}

/**
 * Deletes every import not saved a day after its upload, with its file: one still being read, one
 * read and never saved, one that failed, and one whose save never finished. Saved and undone
 * imports stay, with their batch, until their group or their uploader goes. Answers how many.
 */
export async function deleteStaleImports(sql: postgres.Sql, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - IMPORT_STALE_MS)
  const deleted = await sql`
    DELETE FROM imports
    WHERE committed_at IS NULL AND undone_at IS NULL AND created_at < ${before}
    RETURNING id
  `
  return deleted.length
}

/** Marks an import `FAILED` with `text` and drops its file. */
async function fail(tx: postgres.TransactionSql, id: string, text: string): Promise<void> {
  await tx`
    UPDATE imports SET status = ${ImportStatus.FAILED}, file = NULL,
      failure = ${Array.from(text).slice(0, FAILURE_MAX).join(``)}, failed_at = CURRENT_TIMESTAMP
    WHERE id = ${id}
  `
}

/** The group plan's caps, as the API's gate reads them: none while billing is off. */
async function allowancesOf(
  billing: PostgresBillingRepository,
  groupId: string,
  setup: ImportJobSetup,
): Promise<Readonly<Record<LimitKey, number | null>>> {
  if (!setup.billingEnabled) return UNLIMITED.limits
  const plan = effectivePlanId(await billing.get(groupId), new Date(), setup.graceDays, setup.plans)
  return entitlementsOf(plan, true, setup.plans).limits
}
