import { errorCodeOf, type JobHandler, type OutboxAttemptFailure } from "@spy4x/server/outbox"

/**
 * How the worker retries a failing outbox row: the waits double from one second up to fifteen
 * minutes, and the twentieth attempt starts about two and a half hours after the first. A mail
 * server or a billing provider that is down for an hour or two therefore loses no job, and once it
 * is back the job runs within fifteen minutes.
 */
export const JOB_RETRY = {
  maxAttempts: 20,
  baseRetryDelayMs: 1_000,
  maxRetryDelayMs: 15 * 60_000,
} as const

/** The text of whatever a job threw, for a log line. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The worker's `onAttemptFailed`: one log line for every failed attempt of an outbox row, a job or
 * any other, and one for the attempt after which the processor gives the row up. A line names the
 * row's kind, its aggregate and id, the attempt, where it failed (`publish`, `markProcessed`, or
 * `lease` for a worker that died mid-run) and the error's name, as the outbox row stores it.
 *
 * Never the error's message: a mail or billing error can quote an address or a provider's answer,
 * and the log is no place for either. A job that wants more in the log writes it itself.
 */
export function logAttemptFailure(
  log: (line: string) => void,
): (failure: OutboxAttemptFailure) => void {
  return ({ event, error, attempt, maxAttempts, lastAttempt, stage, storedErrorCode }) => {
    const what = `outbox row ${event.eventKind} (${event.aggregateType} ${event.aggregateId})`
    const name = storedErrorCode ?? errorCodeOf(error)
    log(
      lastAttempt
        ? `error: ${what} abandoned at ${stage} after ${attempt} attempts: ${name}`
        : `warn: ${what} failed at ${stage}, attempt ${attempt} of ${maxAttempts}: ${name}`,
    )
  }
}

/** One part of the nightly cleanup: a name for the log and what it does. */
export type CleanupStep = readonly [name: string, run: () => Promise<void>]

/**
 * The nightly cleanup as a job: runs every step in order, each on its own, so a step that throws
 * stops no other. Each failure is logged with the step's name and the error's message, and the job
 * then fails, so the processor retries the whole list; every step only removes what is due, so a
 * rerun of one that succeeded finds nothing.
 *
 * A cleanup that fails its last attempt too is given up for that night only: the processor's
 * `repeatAfterGiveUp` still writes the next night's run.
 */
export function cleanupJob(
  steps: readonly CleanupStep[],
  log: (line: string) => void,
): JobHandler {
  return async () => {
    const failed: string[] = []
    for (const [name, run] of steps) {
      try {
        await run()
      } catch (error) {
        failed.push(name)
        log(`error: nightly cleanup step "${name}" failed: ${errorText(error)}`)
      }
    }
    if (failed.length === 0) return
    const names = failed.map((name) => `"${name}"`).join(", ")
    throw new Error(`nightly cleanup: ${failed.length} step(s) failed: ${names}`)
  }
}
