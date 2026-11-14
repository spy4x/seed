-- The `errors` profile's database (docs/stack.md, "Error tracking"): GlitchTip's own user and
-- database in this project's Postgres. The one-shot `errors-db` service runs it with psql before
-- GlitchTip starts, on every `up`. A second run finds both and only sets the password again, so a
-- changed GLITCHTIP_DB_PASS takes effect.
--
-- The password reaches the server only through set_config, a query pg_stat_statements stores with
-- its values replaced by placeholders. A CREATE ROLE with the password written in would be stored
-- as written.
\set ON_ERROR_STOP on
\getenv glitchtip_password GLITCHTIP_DB_PASS

SELECT set_config('seed.glitchtip_password', :'glitchtip_password', false) IS NULL AS unused \gset

DO $$
DECLARE
  password text := current_setting('seed.glitchtip_password');
BEGIN
  IF password = '' THEN
    RAISE EXCEPTION 'GLITCHTIP_DB_PASS is empty: run deno task init, or set it in the env file';
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'glitchtip') THEN
    EXECUTE format('ALTER ROLE glitchtip WITH LOGIN PASSWORD %L', password);
  ELSE
    EXECUTE format('CREATE ROLE glitchtip WITH LOGIN PASSWORD %L', password);
  END IF;
END
$$;

SELECT 'CREATE DATABASE glitchtip OWNER glitchtip'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'glitchtip') \gexec
