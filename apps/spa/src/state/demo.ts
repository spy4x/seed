import { apiFetch } from "./api.ts"
import { type DemoInfo, parseDemoInfo } from "@domain/identity"

/**
 * The public demo's shared accounts (docs/demo.md), or `null` while the demo is off (the route
 * answers 404) or the API cannot be reached: the sign-in page then shows no demo notice.
 */
export async function readDemo(): Promise<DemoInfo | null> {
  try {
    const result = await apiFetch<DemoInfo>("/api/demo")
    return result.ok ? parseDemoInfo(result.data) : null
  } catch (_unreachable) {
    return null
  }
}
