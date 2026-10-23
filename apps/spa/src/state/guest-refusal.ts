import { signal } from "@preact/signals"
import type { GuestLimitedAction } from "@domain/identity"

/**
 * The action the API last refused a guest (#224), or `null`. The app's frame shows the refusal
 * with "Keep your account" wherever the action was, so no screen needs to know about guests.
 */
export const guestRefusal = signal<GuestLimitedAction | "other" | null>(null)

/** Which limited action a refused request to `path` was: its last matching part decides. */
export function refusedAction(path: string): GuestLimitedAction | null {
  const parts = new URL(path, "http://app.invalid").pathname.split("/")
  if (parts.includes("invitations")) return "invite"
  if (parts.includes("checkout")) return "billing"
  if (parts.includes("import")) return "upload"
  if (parts.includes("tokens")) return "api-token"
  if (parts.includes("push")) return "push"
  if (parts.includes("telegram")) return "telegram"
  return null
}
