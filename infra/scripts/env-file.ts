/// <reference lib="deno.ns" />
/**
 * Reads `infra/envs/.env*` files the way Docker Compose's `--env-file` reads them, for the subset
 * of the format this template uses, so the scripts and Compose agree on every value they read.
 *
 * The parsing is `parseEnvValues` from `@spy4x/server/env-age64`: first `=`, whole-line `#`
 * comments and blank lines skipped, `export` prefix allowed, and Compose's value rules:
 *
 * - `KEY=value # note`: an unquoted value ends before ` #` (a space, then `#`). A `#` after
 *   anything else stays in the value: `KEY=abc#def` is `abc#def`, `KEY= # note` is `# note`.
 * - `KEY="value"` and `KEY='value'`, optionally followed by whitespace and a `# note`: the quotes
 *   are removed and the value is taken as written.
 *
 * Not supported, unlike Compose: escape sequences such as `\n` inside double quotes (kept as
 * written), `${VAR}` expansion (kept as written), and values spread over several lines. A quoted
 * value followed by anything but a comment, or a quote left open, fails with the file and line.
 *
 * @module
 */

import { MissingEnvError } from "@spy4x/server/config"
import { parseEnvValues } from "@spy4x/server/env-age64"

export { parseEnvValues }

/** Reads and parses the env file at `path`. */
export async function readEnvFile(path: string): Promise<Record<string, string>> {
  return parseEnvValues(await Deno.readTextFile(path), path)
}

/**
 * The line a script prints when it cannot plan its work. A missing variable also names the env
 * file to fix, because the library error does not know it.
 */
export function describeEnvFileError(error: unknown, envFilePath: string): string {
  if (error instanceof MissingEnvError) return `${error.message} in ${envFilePath}`
  return error instanceof Error ? error.message : String(error)
}
