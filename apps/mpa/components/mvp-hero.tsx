import type { JSX } from "preact"
import { WindowFrame } from "@spy4x/preact-ui/window-frame"
import { MvpCallActions } from "./mvp-call-band.tsx"
import { Shot } from "./shot.tsx"

/**
 * The top of the founders page: the outcome in the `h1`, who builds it, the call to book, and a
 * picture of what the founder's customers get on day one (the billing page, and the app on a
 * phone). No technical terms above the fold.
 */
export function MvpHero(): JSX.Element {
  return (
    <section aria-labelledby="mvp-title" class="site-glow border-b border-subtle">
      <div class="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pt-12 pb-12 sm:px-6 lg:grid-cols-2 lg:px-8 lg:pt-16 lg:pb-16">
        <div class="flex flex-col items-start gap-6">
          <p class="font-mono text-sm font-medium text-primary">For founders · by Anton Shubin</p>
          <h1
            id="mvp-title"
            class="text-3xl font-semibold tracking-tight text-balance lg:text-5xl"
          >
            Your product, live and taking payments, in weeks rather than months.
          </h1>
          <p class="text-lg text-muted text-pretty lg:text-xl">
            I'm Anton, a senior engineer who has worked directly with clients since 2013. I build
            your product from idea to a live website that people can sign up for and pay for. The
            parts every product needs are already built and tested in Seed, so your budget goes to
            what makes yours different.
          </p>
          <MvpCallActions place="hero" />
          <p class="text-sm text-muted text-pretty">
            No obligation. A paragraph about your idea gets you three concrete suggestions in
            writing, free.
          </p>
        </div>
        <div class="relative sm:pb-12 sm:pl-12">
          <WindowFrame variant="browser" title="your-product.com/billing">
            <Shot
              name="billing"
              alt="The billing page of a product built on Seed: the team's members with their roles, and the plan at 9 euros per member a month."
              sizes="(min-width: 1024px) 560px, 100vw"
              priority
            />
          </WindowFrame>
          <WindowFrame
            variant="phone"
            class="absolute bottom-0 left-0 hidden w-36 sm:flex lg:w-40"
          >
            <Shot
              name="notes"
              kind="mobile"
              alt="The same product on a phone: a list of the team's notes with their tags."
              sizes="160px"
            />
          </WindowFrame>
        </div>
      </div>
    </section>
  )
}
