import { startIntervalRunner } from "@spy4x/platform/server/interval-runner"
import type { TimerPort } from "@spy4x/platform/server/throttled-saver"

/** What {@link startIdempotencySweep} needs. */
export interface IdempotencySweepOptions {
  /** Shutdown: once aborted, nothing starts and the timer is cleared. */
  signal: AbortSignal
  /** One sweep. A rejection goes to `onError`. */
  sweep: () => Promise<void>
  onError: (error: unknown) => void
  intervalMs: number
  /** Scheduling; defaults to real timers. A test passes a fake one. */
  timers?: TimerPort
}

/**
 * Sweeps once now, then every `intervalMs` until `signal` aborts. The first sweep runs at once
 * (`runFirstTickNow`), because a worker restarted more often than `intervalMs` would otherwise
 * never sweep. A failure is reported, never thrown. A signal that is already aborted starts
 * nothing.
 */
export function startIdempotencySweep(options: IdempotencySweepOptions): void {
  const { signal, sweep, onError, intervalMs, timers } = options
  if (signal.aborted) return
  const stop = startIntervalRunner({
    task: sweep,
    intervalMs,
    onError,
    timers,
    runFirstTickNow: true,
  })
  signal.addEventListener("abort", stop, { once: true })
}
