/**
 * The public demo (docs/demo.md): a database full of fake data, sample data for every new account
 * and a nightly wipe. Off unless `DEMO_MODE` is `true`, so a product started from the template
 * never runs it by accident.
 */

/**
 * An administrator for the admin app, seeded in development (`deno task db:seed`). The public
 * demo seeds it only when `DEMO_ADMIN_PASSWORD` is set, for the owner alone. The address is on a
 * domain reserved for examples (RFC 2606).
 */
export const DEV_ADMIN_EMAIL = `admin@example.com`

/**
 * The public demo's administrator for visitors (docs/demo.md): its address and password are
 * published on the admin app's sign-in page and the website. It signs in on the admin app's host
 * only, and the API refuses it the actions that reach past the demo's own data
 * (`apps/api/routes/admin/demo-guard.ts`).
 */
export const PUBLIC_DEMO_ADMIN = {
  email: `demo-admin@example.com`,
  password: `try-the-admin-panel`,
  firstName: `Demo`,
  lastName: `Admin`,
} as const

/** Whether `login`, as typed on a sign-in form, names {@link PUBLIC_DEMO_ADMIN}. */
export function isPublicDemoAdminLogin(login: string): boolean {
  return login.trim().toLowerCase() === PUBLIC_DEMO_ADMIN.email
}

/** Whether the public demo is on: `DEMO_MODE=true`, and nothing else. */
export function isDemoMode(env: Record<string, string | undefined>): boolean {
  return env.DEMO_MODE === `true`
}
