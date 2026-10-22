import { type } from "arktype"
import { loadRuntimeConfig as loadConfigFile } from "@spy4x/platform/browser/runtime-config"

/**
 * What the SPA reads from `/config.json` before it renders. The container writes the file at
 * start-up from `apps/spa/public-env.allow`, so one built image serves any environment. Every key
 * is optional: a missing one means "the default". A key not named here is dropped.
 *
 * `realtime` and `offline` switch the WebSocket module and the local-data module off when they are
 * `false` (`apps/spa/src/modules.ts`, ADR 003); both run by default. `demo` is `true` only while
 * the public demo is on (docs/demo.md); any other value leaves it off. `guest` is `false` only
 * when guest accounts are off (docs/guests.md); "Try it now" shows otherwise. `site` is the public
 * website's host (`MPA_DOMAIN`), whose legal pages the line under "Try it now" links to.
 */
const RuntimeConfigSchema = type({
  "env?": "string",
  "errorReportDsn?": "string",
  "realtime?": moduleSwitch("realtime"),
  "offline?": moduleSwitch("offline"),
  "demo?": type("unknown").pipe((value): boolean => String(value) === "true"),
  "guest?": type("unknown").pipe((value): boolean => String(value).toLowerCase() !== "false"),
  "site?": "string",
}).onUndeclaredKey("delete")

/**
 * One module switch, read as a boolean. The container writes every value as text, so off is
 * `false` or `0` and on is `true` or `1`, as a JSON value or as text in any letter case. Any other
 * value is refused with a console warning and the module runs, as with no value. It never fails
 * the schema: a mistyped switch must not also drop the rest of the file, the error tracker's
 * address included.
 */
function moduleSwitch(key: string) {
  return type("unknown").pipe((value): boolean => {
    const text = String(value).toLowerCase()
    if (text === "false" || text === "0") return false
    if (text !== "true" && text !== "1") {
      console.warn(
        `Runtime config: "${key}" must be true, false, 1 or 0, so it is ignored and the module runs.`,
      )
    }
    return true
  })
}

export type RuntimeConfig = typeof RuntimeConfigSchema.infer

/** Used when the file is missing or invalid: no error tracker, no environment label. */
export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {}

/**
 * Fetches and validates `/config.json` with `loadRuntimeConfig` of `@spy4x/platform/browser/runtime-config`: the
 * request skips the browser's HTTP cache, and a missing, unreachable or invalid file gives the
 * defaults (and a console warning) rather than a blank page.
 */
export function loadRuntimeConfig(fetcher?: typeof fetch): Promise<RuntimeConfig> {
  return loadConfigFile(RuntimeConfigSchema, { defaults: DEFAULT_RUNTIME_CONFIG, fetcher })
}
