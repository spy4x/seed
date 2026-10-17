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
