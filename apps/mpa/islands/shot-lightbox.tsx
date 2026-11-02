import type { JSX } from "preact"
import { useEffect } from "preact/hooks"
import { type Catalog, createTranslator } from "@spy4x/platform/universal/i18n"
import { I18nContext } from "@spy4x/preact-ui/i18n"
import { ZoomableImages } from "@spy4x/preact-ui/zoomable-images"
import { DARK_MEDIA } from "../components/shot.tsx"

/** The keys of the components' catalog the lightbox reads, sent to the browser and nothing more. */
export const LIGHTBOX_KEYS = [
  `Lightbox.counterLabel`,
  `Lightbox.nextLabel`,
  `Lightbox.previousLabel`,
  `ZoomableImages.closeLabel`,
  `ZoomableImages.fallbackAlt`,
  `ZoomableImages.label`,
  `ZoomableImages.zoomLabel`,
] as const

/**
 * The screenshots the lightbox opens: every `<picture>`'s image on the page, except a video's
 * poster, which sits inside `data-no-zoom` (`components/feature-loop.tsx`, the home page's demo).
 */
export const SHOTS = `picture img:not([data-no-zoom] *)`

/**
 * The widest file of the theme the page shows now: the first entry of the `srcset` the browser
 * picks from, the dark `<source>` when `dark` (`DARK_MEDIA`), else the image's own.
 */
export function widestSrc(image: HTMLImageElement, dark: boolean): string | undefined {
  const source = dark ? image.parentElement?.querySelector(`source`) : null
  const srcset = source?.srcset || image.srcset
  return srcset.split(`,`)[0]?.trim().split(` `)[0] || undefined
}

/**
 * Opens every screenshot on the page in the components' `Lightbox`, at its widest file and in the
 * theme the page shows. Without JavaScript the screenshots stay plain pictures.
 */
export default function ShotLightbox(
  { language, messages }: { language: string; messages: Catalog },
): JSX.Element {
  useEffect(() => {
    const media = matchMedia(DARK_MEDIA)
    const point = () => {
      for (const image of document.querySelectorAll<HTMLImageElement>(SHOTS)) {
        const src = widestSrc(image, media.matches)
        if (src) image.dataset.lightboxSrc = src
      }
    }
    point()
    media.addEventListener(`change`, point)
    return () => media.removeEventListener(`change`, point)
  }, [])

  return (
    <I18nContext.Provider value={createTranslator({ language, catalogs: [{ source: messages }] })}>
      <ZoomableImages containerSelector="body" imageSelector={SHOTS} />
    </I18nContext.Provider>
  )
}
