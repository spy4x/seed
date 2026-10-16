import type { JSX } from "preact"

export interface ProofFact {
  /** The figure or word, set large. */
  value: string
  label: string
}

/** A row of facts a visitor can check, each a big value over a quiet label. A `<dl>`. */
export function ProofStrip({ facts }: { facts: readonly ProofFact[] }): JSX.Element {
  return (
    <div class="border-y border-subtle bg-surface dark:bg-white/[0.04]">
      <dl class="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 sm:grid-cols-3 sm:px-6 lg:px-8">
        {facts.map((fact) => (
          <div key={fact.label} class="flex flex-col gap-1">
            <dt class="order-2 text-sm text-muted">{fact.label}</dt>
            <dd class="order-1 font-mono text-2xl font-semibold tracking-tight">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
