import { type } from "arktype"
import { loadRuntimeConfig as loadConfigFile } from "@spy4x/platform/browser/runtime-config"

/**
 * What the SPA reads from `/config.json` before it renders. The container writes the file at
 * start-up from `apps/spa/public-env.allow`, so one built image serves any environment. Every key
 * is optional: a missing one means "the default". A key not named here is dropped.
 *
 * `realtime` and `offline` switch the WebSocket module and the local-data module off when they are
 * `false` (`apps/spa/src/modules.ts`, ADR 003); both run by default.
 */
const RuntimeConfigSchema = type({
  "env?": "string",
  "errorReportDsn?": "string",
  // The container writes every value as text, so a switch is read as `false` or `"false"`.
  "realtime?": "boolean | 'true' | 'false'",
  "offline?": "boolean | 'true' | 'false'",
}).onUndeclaredKey("delete")

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
