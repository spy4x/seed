import { authPasswordSchema } from "@domain/identity"
import { isDemoMode } from "@server/auth/demo-accounts.ts"

/** What the seed reads from the environment. */
export interface SeedOptions {
  pepper: string
  password: string
}

/** Raised when an environment variable the seed needs is missing or invalid. Never has a value. */
export class SeedConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = `SeedConfigError`
  }
}

/**
 * Reads and checks `AUTH_PEPPER` and `SEED_PASSWORD` (the development administrator's password),
 * with the API's rules for each, for `db:seed` and `db:reset`. Seeding runs only on a development
 * database (`ENV=dev`) or on the public demo (`DEMO_MODE=true`), so no product's database gets
 * an account with a published password. `db:reset` calls it before it drops anything.
 *
 * @throws {SeedConfigError} When neither holds, or a variable is missing or breaks its rule.
 */
export function readSeedOptions(env: Record<string, string | undefined>): SeedOptions {
  if (env.ENV !== `dev` && !isDemoMode(env)) {
    throw new SeedConfigError(
      `ENV must be dev, or DEMO_MODE true: the demo accounts are for development and the public demo only`,
    )
  }
  const pepper = env.AUTH_PEPPER ?? ``
  if (pepper.length < 32) {
    throw new SeedConfigError(`AUTH_PEPPER must be set to the API's value (32 characters or more)`)
  }
  const password = env.SEED_PASSWORD ?? ``
  if (!authPasswordSchema.allows({ password })) {
    throw new SeedConfigError(`SEED_PASSWORD must be set, 8 to 50 characters`)
  }
  return { pepper, password }
}
