import type { ComponentType } from "preact"
import type { IconProps } from "@spy4x/preact-icons"
import { AdminComingSoon, ComingSoonPanel } from "@ui/admin-frame.tsx"
import type { AdminPersonTab, AdminRoute } from "./types.ts"

/**
 * The page of a module that is registered but not built yet: its title and a "coming soon" panel
 * at `path`. A module's lane replaces it with its real pages.
 */
export function comingSoonPage(
  { path, title, description, Icon }: {
    path: string
    title: string
    description: string
    Icon: ComponentType<IconProps>
  },
): AdminRoute {
  return {
    path,
    View: () => <AdminComingSoon title={title} description={description} Icon={Icon} />,
  }
}

/** A person tab that is registered but not built yet. */
export function comingSoonTab(
  { id, label, description }: { id: string; label: string; description: string },
): AdminPersonTab {
  return {
    id,
    label,
    render: () => <ComingSoonPanel title={`${label} is coming soon`} description={description} />,
  }
}
