/**
 * The public demo (docs/demo.md): a database full of fake data, sample data for every new account
 * and a nightly wipe. Off unless `DEMO_MODE` is `true`, so a product started from the template
 * never runs it by accident.
 */

/**
 * An administrator for the admin app, seeded in development only (`deno task db:seed`). The
 * public demo has none: the admin panel is not part of it. The address is on a domain reserved
 * for examples (RFC 2606).
 */
export const DEV_ADMIN_EMAIL = `admin@example.com`

/** Whether the public demo is on: `DEMO_MODE=true`, and nothing else. */
export function isDemoMode(env: Record<string, string | undefined>): boolean {
  return env.DEMO_MODE === `true`
}
