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

/**
 * The public website's origin, such as `https://www.example.com`, from `/config.json`'s `site`
 * (`MPA_DOMAIN`), or `null` without a website. The line under "Try it now" links to its terms and
 * privacy notice (#224).
 */
export const siteOrigin = signal<string | null>(null)

/**
 * The website's origin from its host and the environment: plain HTTP only in development, as the
 * API reads `MPA_DOMAIN` (`readSiteUrl`). An empty or unusable host gives `null`.
 */
export function siteOriginOf(site: string | undefined, env: string | undefined): string | null {
  const host = site?.trim() ?? ""
  if (host === "" || host.includes("://")) return null
  try {
    return new URL(`http${env === "dev" ? "" : "s"}://${host}`).origin
  } catch (_invalid) {
    return null
  }
}
