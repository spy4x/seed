import type { JSX } from "preact"
import { LoopVideo } from "@spy4x/preact-ui/loop-video"
import { DARK_MEDIA } from "../components/shot.tsx"
import { LOOP_SIZE, type LoopName, loopPosterSrcset, loopSources } from "../loops.ts"

/** The words of one loop, in the page's language: only these reach the browser. */
export interface LoopClipProps {
  loop: LoopName
  /** The short name the button ends with, such as "Realtime sync". */
  name: string
  /** What the clip shows, in a sentence: the video's accessible name. */
  title: string
  pauseLabel: string
  playLabel: string
  /** How wide the clip is drawn, for the browser's choice of poster file. */
  sizes: string
}

/**
 * One feature loop, light or dark as the page is (`DARK_MEDIA`): the poster without JavaScript, the
 * clip playing while it is in view with it.
 */
export default function LoopClip(
  { loop, name, title, pauseLabel, playLabel, sizes }: LoopClipProps,
): JSX.Element {
  return (
    <LoopVideo
      poster={{
        src: `/video/${loop}-loop-light-${LOOP_SIZE.width}.webp`,
        srcset: loopPosterSrcset(loop, `light`),
        sizes,
        width: LOOP_SIZE.width,
        height: LOOP_SIZE.height,
        dark: { srcset: loopPosterSrcset(loop, `dark`), media: DARK_MEDIA },
      }}
      sources={loopSources(loop, `light`)}
      darkSources={loopSources(loop, `dark`)}
      title={title}
      name={name}
      pauseLabel={pauseLabel}
      playLabel={playLabel}
    />
  )
}
