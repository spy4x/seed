/// <reference lib="deno.ns" />
/**
 * Where Postgres keeps its data on the host, and the check that stops `deno task compose` from
 * starting Postgres 18 empty beside a Postgres 16 data directory that was never moved over, or on
 * a copy that a rollback has made stale.
 *
 * Postgres 18 cannot open a version 16 data directory, so the Compose file gives it a directory
 * of its own. Without this check a deploy on a server that still has the old directory would
 * start an empty database, run the migrations on it and serve it. The only way from the old
 * directory to the new one is `deno task db:upgrade-18` (docs/postgres-18-upgrade.md), which
 * writes {@link UPGRADE_MARKER} into the new directory once the row counts match.
 *
 * @module
 */

/** Host directory of the Postgres 16 container, as the Compose file named it before the move. */
export const OLD_DATA_DIR = `./.volumes/postgres`
/** Host directory of the Postgres 18 container: `infra/compose/compose.shared.yml` mounts it. */
export const NEW_DATA_DIR = `./.volumes/postgres18`
/** File name, inside the new directory, that says its data came from the old one. */
export const UPGRADE_MARKER = `upgraded-from-16`

/** What is on the host's disk; read by {@link readPostgresDataFacts}. */
export interface PostgresDataFacts {
  /** The Postgres 16 directory is still there. */
  oldDataExists: boolean
  /** The Postgres 18 directory is there, filled or not. */
  newDataExists: boolean
  /** The upgrade finished: the marker is in the Postgres 18 directory. */
  upgradeMarked: boolean
  /**
   * The Postgres 16 directory changed after the marker was written, so Postgres 16 ran again: the
   * server was rolled back, and the Postgres 18 directory misses everything written since.
   */
  oldDataChangedSinceUpgrade: boolean
}

/**
 * Compose commands that can start the database, or create its container. `start` and `restart`
 * are here too: after a failed upgrade the stopped container is a half-filled Postgres 18.
 */
const STARTING_COMMANDS = [`up`, `start`, `restart`, `run`, `create`, `scale`, `watch`]

/**
 * The reason `deno task compose <args>` must not run, or `undefined` when it may. It refuses a
 * command that can start the database in two cases: the old directory exists and no upgrade has
 * finished (Postgres 18 would start empty), or the upgrade finished and Postgres 16 ran again
 * afterwards (Postgres 18 would serve the copy from before the rollback). A machine with no old
 * directory (a fresh install) and one whose owner removed it after the upgrade are never refused,
 * and neither is a command that starts nothing (`ps`, `logs`, `stop`, `down`, `build`).
 */
export function postgresUpgradeRefusal(
  args: string[],
  facts: PostgresDataFacts,
): string | undefined {
  if (!facts.oldDataExists) return undefined
  if (facts.upgradeMarked && !facts.oldDataChangedSinceUpgrade) return undefined
  if (!args.some((arg) => STARTING_COMMANDS.includes(arg))) return undefined
  if (facts.upgradeMarked) {
    return [
      `Refusing to start: ${OLD_DATA_DIR} changed after the upgrade to Postgres 18 finished, so`,
      `Postgres 16 ran again (a rollback) and ${NEW_DATA_DIR} misses everything written since.`,
      `Starting now would serve that older copy. Nothing was changed.`,
      `- To upgrade again: move ${NEW_DATA_DIR} away, then deno task db:upgrade-18`,
      `  (docs/postgres-18-upgrade.md, "Rolling back").`,
    ].join(`\n`)
  }
  return [
    `Refusing to start: ${OLD_DATA_DIR} holds a Postgres 16 database, and Postgres 18 keeps its`,
    `data in ${NEW_DATA_DIR}. Starting now would serve an empty database. Nothing was changed.`,
    `- To move the data: deno task db:upgrade-18 (docs/postgres-18-upgrade.md).`,
    `- On a development machine whose data you do not need: move or delete ${OLD_DATA_DIR}.`,
  ].join(`\n`)
}

/** The part of `Deno.stat` the facts need; replaceable in tests. */
export type StatModified = (path: string) => Promise<{ mtime: Date | null }>

/** When `path` was last modified, or `undefined` when it is missing or cannot be read. */
async function modified(stat: StatModified, path: string): Promise<Date | undefined> {
  try {
    // A file system without modification times gives no proof either way: the epoch makes the
    // path count as present and as older than everything.
    return (await stat(path)).mtime ?? new Date(0)
  } catch (error) {
    // The container's user owns the directories, so a file inside may be unreadable to the person
    // who deploys. An unreadable marker counts as missing: the check refuses instead of guessing.
    if (error instanceof Deno.errors.NotFound || error instanceof Deno.errors.PermissionDenied) {
      return undefined
    }
    throw error
  }
}

/**
 * Reads the facts from the working directory, which every script takes to be the app's root.
 *
 * Postgres 16 creates `postmaster.pid` in its data directory when it starts and removes it when
 * it stops, and each moves the directory's own modification time. The upgrade writes the marker
 * after Postgres 16 has stopped, so an old directory newer than the marker means Postgres 16
 * started again. Reading both times needs no access to the directories themselves.
 */
export async function readPostgresDataFacts(
  stat: StatModified = Deno.stat,
): Promise<PostgresDataFacts> {
  const oldData = await modified(stat, OLD_DATA_DIR)
  const marker = await modified(stat, `${NEW_DATA_DIR}/${UPGRADE_MARKER}`)
  return {
    oldDataExists: oldData !== undefined,
    newDataExists: (await modified(stat, NEW_DATA_DIR)) !== undefined,
    upgradeMarked: marker !== undefined,
    oldDataChangedSinceUpgrade: oldData !== undefined && marker !== undefined && oldData > marker,
  }
}
