/**
 * The environment of the API's direct Postgres connection: the one `LISTEN` runs on.
 *
 * In Compose, `DB_HOST` names PgBouncer, which pools in transaction mode: each transaction may run
 * on another server connection, so a `LISTEN` sent through it would hear nothing. `DB_DIRECT_HOST`
 * and `DB_DIRECT_PORT` name Postgres itself (docs/stack.md, "Database connections"). Unset, as in
 * the local browser run and CI, where the API talks to Postgres with no pooler between, the
 * direct connection is `DB_HOST` and `DB_PORT`.
 */
export function directDbEnv(
  environment: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const host = environment.DB_DIRECT_HOST
  if (!host) return environment
  return { ...environment, DB_HOST: host, DB_PORT: environment.DB_DIRECT_PORT || "5432" }
}
