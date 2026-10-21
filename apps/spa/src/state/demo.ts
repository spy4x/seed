import { signal } from "@preact/signals"

/**
 * Whether the public demo is on (docs/demo.md), from `/config.json`. `main.tsx` sets it before the
 * first render; the sign-in and sign-up pages then say so.
 */
export const demoMode = signal(false)

/**
 * Whether "Try it now" is offered (#224, docs/guests.md), from `/config.json`: on unless the
 * container sets `GUEST_MODE=false`. The API refuses a guest too when it is off.
 */
export const guestMode = signal(true)
