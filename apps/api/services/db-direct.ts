import { PostgresEnvName } from "@spy4x/server/db"
import { type EnvReader, processEnv, readEnvRecord } from "@spy4x/platform/server/process"

/**
 * The Postgres variables `createSqlFromEnv` reads, from `env`. The one list every API and worker
 * connection takes, so a variable the library's parser starts reading reaches all of them.
 */
export function postgresEnv(env: EnvReader = processEnv): Record<string, string | undefined> {
  return readEnvRecord(Object.values(PostgresEnvName), env)
}

/**
 * The environment of the `LISTEN` connection: {@link postgresEnv} plus `DB_DIRECT_HOST` and
 * `DB_DIRECT_PORT`, passed through {@link directDbEnv}.
 */
export function listenPostgresEnv(env: EnvReader = processEnv): Record<string, string | undefined> {
  return directDbEnv({
    ...postgresEnv(env),
    ...readEnvRecord([`DB_DIRECT_HOST`, `DB_DIRECT_PORT`], env),
  })
}

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
