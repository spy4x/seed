import type { JSX } from "preact"

/** Whether a screenshot was taken on the desktop viewport (1280×800) or the phone one (390×844). */
export type ShotKind = "desktop" | "mobile"

/** The two widths each screenshot is saved at, widest first, and the height at the widest. */
const SIZES: Record<ShotKind, { widths: readonly [number, number]; height: number }> = {
  desktop: { widths: [1280, 640], height: 800 },
  mobile: { widths: [780, 390], height: 1688 },
}

/** The `srcset` of one theme of a screenshot, from the naming scheme of `static/shots/`. */
export function shotSrcset(name: string, theme: "light" | "dark", kind: ShotKind): string {
  return SIZES[kind].widths.map((width) => `/shots/${name}-${theme}-${width}.webp ${width}w`)
    .join(", ")
}

export interface ShotProps {
  /** The screenshot's name in `static/shots/`, such as `notes`. */
  name: string
  kind?: ShotKind
  /** The height at the widest width, for a picture cropped from its kind's viewport. */
  height?: number
  /** What the screen shows, for a reader who cannot see it. */
  alt: string
  /** How wide the image is drawn, for the browser's choice of file. */
  sizes?: string
  /** The largest image of the first screen: loaded at once and first. */
  priority?: boolean
  class?: string
}

/**
 * A screenshot of the product, light or dark as the device asks, at the width the layout needs.
 * Sized by `width` and `height`, so nothing moves when it loads.
 */
export function Shot(
  {
    name,
    kind = "desktop",
    height = SIZES[kind].height,
    alt,
    sizes = "(min-width: 1024px) 1024px, 100vw",
    priority = false,
    class: className = "",
  }: ShotProps,
): JSX.Element {
  const [width] = SIZES[kind].widths
  return (
    <picture>
      <source
        media="(prefers-color-scheme: dark)"
        srcset={shotSrcset(name, "dark", kind)}
        sizes={sizes}
      />
      <img
        src={`/shots/${name}-light-${width}.webp`}
        srcset={shotSrcset(name, "light", kind)}
        sizes={sizes}
        width={width}
        height={height}
        alt={alt}
        class={`block h-auto w-full ${className}`}
        {...(priority
          ? { fetchpriority: "high" as const, loading: "eager" as const }
          : { loading: "lazy" as const, decoding: "async" as const })}
      />
    </picture>
  )
}
