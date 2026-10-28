// Seed's own site: see docs/start-a-product.md
import type { JSX } from "preact"
import { Button } from "@spy4x/preact-ui/button"
import { IconExternalLink } from "@spy4x/preact-icons"
import { HIRE_PAGE_URL } from "../hire.ts"
import { useSite } from "../use-site.tsx"
import { Band } from "./band.tsx"

/**
 * The one band of a developer page that speaks to the other audience: founders who want their
 * product built on Seed, sent to antonshubin.com's MVP page.
 */
export function FoundersHandoff(): JSX.Element {
  const { t } = useSite()
  return (
    <Band tone="accent" labelledBy="founders-title">
      <div class="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div class="flex max-w-3xl flex-col gap-3">
          <h2 id="founders-title" class="text-2xl font-semibold tracking-tight text-balance">
            {t.t(`Founders.title`)}
          </h2>
          <p class="text-muted text-pretty">{t.t(`Founders.text`)}</p>
        </div>
        <Button
          href={HIRE_PAGE_URL}
          variant="secondary"
          size="lg"
          class="shrink-0"
          data-e2e="home-founders"
          data-umami-event="hire-me"
          data-umami-event-from="home"
        >
          {t.t(`Founders.cta`)} <IconExternalLink class="size-5" aria-hidden="true" />
          <span class="sr-only">{t.t(`SiteNav.hireHint`)}</span>
        </Button>
      </div>
    </Band>
  )
}
