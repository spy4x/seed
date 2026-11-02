import type { JSX } from "preact"
import { DemoVideo } from "@spy4x/preact-ui/demo-video"
import { DARK_MEDIA, shotSrcset } from "../components/shot.tsx"

/** The words of the hero's demo, in the page's language: only these reach the browser. */
export interface HeroDemoProps {
  /** What the clip shows: names the play link and the video. */
  title: string
  playLabel: string
  errorLabel: string
  openFileLabel: string
}

/**
 * The README's one-minute demo (`media/demo/`), on the home page's first screen: the themed notes
 * screenshot until the visitor presses it, then the clip with its captions and music. It never
 * starts by itself. `/analytics.js` counts the press (`data-analytics-press`).
 */
export default function HeroDemo(
  { title, playLabel, errorLabel, openFileLabel }: HeroDemoProps,
): JSX.Element {
  const sizes = `(min-width: 1024px) 960px, 100vw`
  return (
    <DemoVideo
      poster={{
        src: `/shots/notes-light-1280.webp`,
        srcset: shotSrcset(`notes`, `light`, `desktop`),
        sizes,
        width: 1280,
        height: 800,
        dark: { srcset: shotSrcset(`notes`, `dark`, `desktop`), media: DARK_MEDIA },
      }}
      sources={[
        { src: `/video/demo.webm`, type: `video/webm; codecs="vp9, opus"` },
        { src: `/video/demo.mp4`, type: `video/mp4` },
      ]}
      title={title}
      playLabel={playLabel}
      errorLabel={errorLabel}
      openFileLabel={openFileLabel}
      eager
      data-e2e="hero-demo"
      data-analytics-press="demo-video-play"
    />
  )
}
