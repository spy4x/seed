import { startIntervalRunner } from "@spy4x/platform/server/interval-runner"
import type { TimerPort } from "@spy4x/platform/server/throttled-saver"
import { isoDateInTz } from "@spy4x/time/tz"

/** The demo is wiped when this zone's date changes: midnight on the US west coast. */
export const DEMO_TIME_ZONE = `America/Los_Angeles`

/** How often the worker checks whether the demo's day has changed. */
export const DEMO_CHECK_EVERY_MS = 60_000

/** The calendar date (`YYYY-MM-DD`) that `now` falls on in `timeZone`. */
export function demoDay(now: Date, timeZone = DEMO_TIME_ZONE): string {
  return isoDateInTz(now, timeZone)
}

/** The fake data's seed for the demo's date at `now`, so each day looks a little different. */
export function demoDataSeed(now: Date): number {
  return Number(demoDay(now).replaceAll(`-`, ``))
}

/** What {@link demoResetTask} needs. */
export interface DemoResetDeps {
  /** Whether the database holds the demo already (`isDemoSeeded`). */
  isSeeded: () => Promise<boolean>
  /** Wipes the database and seeds the demo again. */
  reset: () => Promise<void>
  now: () => Date
  timeZone?: string
}

/**
 * One check of the nightly reset. The first check after a start resets at once only when the
 * demo is missing (a fresh server), so a deploy in the middle of the day keeps what visitors did.
 * After that it resets once each time {@link DEMO_TIME_ZONE}'s date changes. A failed reset is
 * tried again on the next check; a restart that misses midnight resets at the next one.
 */
export function demoResetTask(deps: DemoResetDeps): () => Promise<void> {
  let lastDay: string | null = null
  return async () => {
    const day = demoDay(deps.now(), deps.timeZone)
    if (lastDay === null && await deps.isSeeded()) lastDay = day
    if (lastDay === day) return
    await deps.reset()
    lastDay = day
  }
}

/**
 * Runs {@link demoResetTask} now and every {@link DEMO_CHECK_EVERY_MS} until `signal` aborts. A
 * failure goes to `onError`, never up.
 */
export function startDemoReset(
  options: DemoResetDeps & {
    signal: AbortSignal
    onError: (error: unknown) => void
    timers?: TimerPort
  },
): void {
  if (options.signal.aborted) return
  const stop = startIntervalRunner({
    task: demoResetTask(options),
    intervalMs: DEMO_CHECK_EVERY_MS,
    onError: options.onError,
    timers: options.timers,
    runFirstTickNow: true,
  })
  options.signal.addEventListener(`abort`, stop, { once: true })
}
