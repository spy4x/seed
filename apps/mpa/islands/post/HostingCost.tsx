import type { JSX } from "preact"
import { useMemo, useState } from "preact/hooks"
import { formatMoney } from "@spy4x/platform/universal/money"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { MoneyDisplay } from "@spy4x/preact-ui/money-display"
import { RadioChips } from "@spy4x/preact-ui/radio-chips"
import { Slider } from "@spy4x/preact-ui/slider"
import { type FigureFrame, figureTranslator, PostFigure } from "../../components/post-figure.tsx"

/**
 * Hetzner Cloud's prices, in euro cents a month before VAT, read from its API
 * (`GET /v1/server_types`, `GET /v1/pricing`) on 2026-11-03: the x86 servers on sale in Germany
 * and Finland that day, the primary IPv4 address, and Object Storage's base price for the backups.
 */
export const HETZNER = {
  servers: [
    { id: `cx23`, name: `CX23`, cores: 2, memory: 4, amount: 549 },
    { id: `cpx32`, name: `CPX32`, cores: 4, memory: 8, amount: 3549 },
    { id: `cpx42`, name: `CPX42`, cores: 8, memory: 16, amount: 6949 },
  ],
  ipv4: 50,
  objectStorage: 649,
  currency: `EUR`,
} as const

/**
 * The managed stack's list prices, in US cents a month before tax, read on 2026-11-03: Vercel
 * Pro's developer seat (vercel.com/pricing) and Supabase Pro (supabase.com/pricing).
 */
export const MANAGED = { seat: 2000, database: 2500, currency: `USD` } as const

/** US dollars per euro: the ECB's reference rate of 2026-11-02. */
export const USD_PER_EUR = 1.1216

/** The most developers the slider offers. */
export const MAX_DEVELOPERS = 20

type ServerId = (typeof HETZNER.servers)[number][`id`]

/**
 * `<HostingCost server="cx23" developers={1} />`: the server and team size the figure starts at.
 * An arktype definition, not a type: the server compiles it, so arktype stays out of the island.
 */
export const props = {
  "server?": `'cx23' | 'cpx32' | 'cpx42'`,
  "developers?": `1 <= number.integer <= ${MAX_DEVELOPERS}`,
  "+": `reject`,
}

interface Props {
  server?: ServerId
  developers?: number
}

/** What one Seed server costs a month, in euro cents: the server, its IPv4 and the backup store. */
export function seedMonthly(server: ServerId): number {
  const { amount } = HETZNER.servers.find((entry) => entry.id === server)!
  return amount + HETZNER.ipv4 + HETZNER.objectStorage
}

/** What the managed stack costs a month, in US cents: a seat per developer and the database. */
export function managedMonthly(developers: number): number {
  return developers * MANAGED.seat + MANAGED.database
}

/** US cents in euro cents, at the dated ECB rate. */
export function toEuro(usdCents: number): number {
  return Math.round(usdCents / USD_PER_EUR)
}

/**
 * Which side is cheaper a month, and by how many euro cents (never negative): the managed stack
 * converted at the ECB rate, against Seed. A tie counts as Seed, saving nothing.
 */
export function savings(
  server: ServerId,
  developers: number,
): { cheaper: `seed` | `managed`; monthly: number } {
  const difference = toEuro(managedMonthly(developers)) - seedMonthly(server)
  return { cheaper: difference >= 0 ? `seed` : `managed`, monthly: Math.abs(difference) }
}

/** The RSS feed's sentence: both monthly totals for the post's server and team. */
export function fallback(
  { server = `cx23`, developers = 1 }: Props,
  t: Translator<string>,
): string {
  const euro = (amount: number) => formatMoney(amount, HETZNER.currency, t.language)
  const managed = managedMonthly(developers)
  const { cheaper, monthly } = savings(server, developers)
  const facts = t.t(`PostFigure.HostingCost.fallback`, {
    server: HETZNER.servers.find((entry) => entry.id === server)!.name,
    seed: euro(seedMonthly(server)),
    developers,
    managed: formatMoney(managed, MANAGED.currency, t.language),
    managedEuro: euro(toEuro(managed)),
  })
  const verdict = t.t(
    cheaper === `seed`
      ? `PostFigure.HostingCost.seedVerdict`
      : `PostFigure.HostingCost.managedVerdict`,
    {
      month: euro(monthly),
      year: euro(12 * monthly),
    },
  )
  return `${facts} ${verdict}`
}

/**
 * Seed on one Hetzner server against a managed stack (Vercel Pro and Supabase Pro), a month: a
 * choice of server, a slider for the developers who need a seat, and both totals. Drawn by the
 * server with the post's choices; the controls work once the page has hydrated.
 */
export default function HostingCost(
  { server = `cx23`, developers = 1, figure }: Props & { figure: FigureFrame },
): JSX.Element {
  const t = useMemo(() => figureTranslator(figure), [figure])
  const [size, setSize] = useState<ServerId>(server)
  const [team, setTeam] = useState(developers)
  const seed = seedMonthly(size)
  const managed = managedMonthly(team)
  const { cheaper, monthly } = savings(size, team)
  const money = (amount: number, currency: string) => (
    <MoneyDisplay amount={amount} currency={currency} locale={figure.language} />
  )
  const value = `text-2xl font-semibold tabular-nums text-foreground`
  return (
    <PostFigure
      frame={figure}
      t={t}
      title={t.t(`PostFigure.HostingCost.title`)}
      lead={t.t(`PostFigure.HostingCost.lead`)}
      caption={t.t(`PostFigure.HostingCost.caption`)}
      controls={
        <div class="flex flex-col gap-4">
          <RadioChips
            legend={t.t(`PostFigure.HostingCost.server`)}
            name={`${figure.id}-server`}
            value={size}
            onChange={(next) => setSize(next as ServerId)}
            options={HETZNER.servers.map((entry) => ({
              value: entry.id,
              label: t.t(`PostFigure.HostingCost.serverOption`, {
                name: entry.name,
                cores: entry.cores,
                memory: entry.memory,
              }),
            }))}
          />
          <Slider
            label={t.t(`PostFigure.HostingCost.developers`)}
            value={team}
            min={1}
            max={MAX_DEVELOPERS}
            step={1}
            onInput={setTeam}
            format={(count) => new Intl.NumberFormat(figure.language).format(count)}
          />
        </div>
      }
    >
      <dl class="grid gap-4 sm:grid-cols-3">
        <div class="flex flex-col gap-1">
          <dt class="text-sm text-muted">{t.t(`PostFigure.HostingCost.seed`)}</dt>
          <dd class={value}>{money(seed, HETZNER.currency)}</dd>
        </div>
        <div class="flex flex-col gap-1">
          <dt class="text-sm text-muted">{t.t(`PostFigure.HostingCost.managed`)}</dt>
          <dd class={value}>{money(managed, MANAGED.currency)}</dd>
          <dd class="text-sm text-muted tabular-nums">
            {t.t(`PostFigure.HostingCost.inEuro`, {
              amount: formatMoney(toEuro(managed), HETZNER.currency, figure.language),
            })}
          </dd>
        </div>
        <div class="flex flex-col gap-1">
          <dt class="text-sm text-muted">
            {t.t(
              cheaper === `seed`
                ? `PostFigure.HostingCost.seedSaves`
                : `PostFigure.HostingCost.managedSaves`,
            )}
          </dt>
          <dd class={value}>
            {t.t(`PostFigure.HostingCost.perMonth`, {
              amount: formatMoney(monthly, HETZNER.currency, figure.language),
            })}
          </dd>
          <dd class="text-sm text-muted tabular-nums">
            {t.t(`PostFigure.HostingCost.perYear`, {
              amount: formatMoney(12 * monthly, HETZNER.currency, figure.language),
            })}
          </dd>
        </div>
      </dl>
    </PostFigure>
  )
}
