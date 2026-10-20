import { signal } from "@preact/signals"

/**
 * Whether the public demo is on (docs/demo.md), from `/config.json`. `main.tsx` sets it before the
 * first render; the sign-in and sign-up pages then say so.
 */
export const demoMode = signal(false)
