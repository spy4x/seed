import type { JSX } from "preact"
import { useMemo, useState } from "preact/hooks"
import { type } from "arktype"
import { formatMoney } from "@spy4x/platform/universal/money"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { MoneyDisplay } from "@spy4x/preact-ui/money-display"
import { Slider } from "@spy4x/preact-ui/slider"
import { type FigureFrame, figureTranslator, PostFigure } from "../../components/post-figure.tsx"

/** The demo's Pro plan (`libs/domain/billing`): its price per member a month, in cents. */
export const PRO_PRICE = { amount: 900, currency: `EUR` } as const
/** The most members a Pro group can have. */
export const PRO_MAX_MEMBERS = 50

/** `<CostCalculator members={4} />`: the team size the figure starts at, 1 to 50 (default 4). */
export const props = type({
  "members?": `1 <= number.integer <= ${PRO_MAX_MEMBERS}`,
  "+": `reject`,
})

type Props = typeof props.infer

/** What a team of `members` pays a month on Pro, in cents. */
export function monthlyCost(members: number): number {
  return members * PRO_PRICE.amount
}

/** The RSS feed's sentence: what the post's team size pays, at the plan's price. */
export function fallback({ members = 4 }: Props, t: Translator<string>): string {
  const money = (amount: number) => formatMoney(amount, PRO_PRICE.currency, t.language)
  return t.t(`PostFigure.CostCalculator.fallback`, {
    members,
    total: money(monthlyCost(members)),
    price: money(PRO_PRICE.amount),
  })
}

/**
 * What the demo's Pro plan costs a team: a slider for the team size and the monthly total. Drawn
 * by the server with the post's team size; the slider works once the page has hydrated.
 */
export default function CostCalculator(
  { members = 4, figure }: Props & { figure: FigureFrame },
): JSX.Element {
  const t = useMemo(() => figureTranslator(figure), [figure])
  const [team, setTeam] = useState(members)
  const money = (amount: number) => (
    <MoneyDisplay amount={amount} currency={PRO_PRICE.currency} locale={figure.language} />
  )
  return (
    <PostFigure
      frame={figure}
      t={t}
      title={t.t(`PostFigure.CostCalculator.title`)}
      lead={t.t(`PostFigure.CostCalculator.lead`)}
      caption={t.t(`PostFigure.CostCalculator.caption`)}
      controls={
        <Slider
          label={t.t(`PostFigure.CostCalculator.members`)}
          value={team}
          min={1}
          max={PRO_MAX_MEMBERS}
          step={1}
          onInput={setTeam}
          format={(value) => new Intl.NumberFormat(figure.language).format(value)}
        />
      }
    >
      <dl class="grid grid-cols-2 gap-4">
        <div class="flex flex-col gap-1">
          <dt class="text-sm text-muted">{t.t(`PostFigure.CostCalculator.total`)}</dt>
          <dd class="text-2xl font-semibold tabular-nums text-foreground">
            {money(monthlyCost(team))}
          </dd>
        </div>
        <div class="flex flex-col gap-1">
          <dt class="text-sm text-muted">{t.t(`PostFigure.CostCalculator.perMember`)}</dt>
          <dd class="text-2xl font-semibold tabular-nums text-foreground">
            {money(PRO_PRICE.amount)}
          </dd>
        </div>
      </dl>
    </PostFigure>
  )
}
