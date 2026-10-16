import type { JSX } from "preact"

/**
 * The Seed logo: a two-leaf sprout in a rounded square, in the accent colour, and the word "Seed".
 * Inline SVG, so it needs no request and follows the theme. The mark is decoration; the word names
 * the link it sits in.
 */
export function SeedMark({ class: className = "" }: { class?: string }): JSX.Element {
  return (
    <span class={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <svg viewBox="0 0 24 24" class="size-7 text-primary" aria-hidden="true" focusable="false">
        <rect width="24" height="24" rx="6" fill="currentColor" />
        <path
          d="M12 19v-7m0 0c0-3 2-5 5.5-5 0 3.5-2 5-5.5 5Zm0 0C12 9.5 10.5 8 7 8c0 3 1.5 4 5 4Z"
          fill="none"
          stroke="var(--color-primary-foreground)"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span>Seed</span>
    </span>
  )
}
