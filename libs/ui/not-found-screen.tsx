import type { JSX } from "preact"
import { Button } from "@spy4x/preact-ui/button"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import { IconSearch } from "@spy4x/preact-icons"
import { ADMIN_PATHS } from "./admin-frame.tsx"
import { AuthCard } from "./auth-screen.tsx"
import { useAdminText, useAppText } from "./i18n.ts"
import { type Navigate, NOTE_PATHS, SCREEN_PATHS } from "./progressive.tsx"

/** Who meets the address: a signed-in person, a signed-out visitor of the SPA, or an operator. */
export type NotFoundAudience = "member" | "visitor" | "operator"

export interface NotFoundScreenProps {
  audience: NotFoundAudience
  /** Follows the link without a page load: the app's router. Left out, the link loads the page. */
  navigate?: Navigate
}

/**
 * What an address no page answers shows (#368), in the SPA and the admin app: the page's heading,
 * one sentence and one link back. The apps draw it from their router's last, pathless route. A
 * signed-out visitor gets it in the card of the sign-in pages, with a link to sign in.
 */
export function NotFoundScreen({ audience, navigate }: NotFoundScreenProps): JSX.Element {
  const app = useAppText()
  const admin = useAdminText()
  const { title, description, label, href } = audience === "operator"
    ? {
      title: admin.t(`AdminNotFound.title`),
      description: admin.t(`AdminNotFound.description`),
      label: admin.t(`AdminNotFound.toDashboard`),
      href: ADMIN_PATHS.dashboard,
    }
    : audience === "visitor"
    ? {
      title: app.t(`NotFound.title`),
      description: app.t(`NotFound.signedOut`),
      label: app.t(`NotFound.signIn`),
      href: SCREEN_PATHS.signIn,
    }
    : {
      title: app.t(`NotFound.title`),
      description: app.t(`NotFound.description`),
      label: app.t(`NotFound.toNotes`),
      href: NOTE_PATHS.list,
    }
  // 44 px tall on a phone, a touch target; the button's own 36 px from `sm`.
  const link = (width: string) => (
    <Button
      href={href}
      navigate={navigate}
      class={`min-h-11 sm:min-h-9 ${width}`}
      data-e2e="not-found-link"
    >
      {label}
    </Button>
  )
  if (audience === "visitor") {
    return (
      <AuthCard title={title} description={description} e2e="not-found">
        {link(`w-full`)}
      </AuthCard>
    )
  }
  // The 48 rem column of a form page, also in the admin app's wider one, with the box filling it
  // under the heading instead of floating in its middle.
  return (
    <div class="flex w-full max-w-3xl flex-col gap-8" data-e2e="not-found">
      <PageHeader title={title} />
      <EmptyState
        class="w-full max-w-none"
        icon={<IconSearch class="size-5" />}
        description={description}
        action={link(`w-full sm:w-auto`)}
      />
    </div>
  )
}
