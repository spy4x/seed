// Seed's own site: see docs/start-a-product.md
import type { JSX } from "preact"
import { WindowFrame } from "@spy4x/preact-ui/window-frame"
import LoopClip from "../islands/loop-clip.tsx"
import type { LoopName } from "../loops.ts"
import { useSite } from "../use-site.tsx"

/** The catalog keys of each loop: its short name, the sentence that names the video, its caption. */
const LOOP_KEYS: Record<LoopName, { name: string; title: string; caption: string }> = {
  realtime: {
    name: `Loops.realtimeName`,
    title: `Loops.realtimeTitle`,
    caption: `Loops.realtimeCaption`,
  },
  offline: {
    name: `Loops.offlineName`,
    title: `Loops.offlineTitle`,
    caption: `Loops.offlineCaption`,
  },
  shortcuts: {
    name: `Loops.shortcutsName`,
    title: `Loops.shortcutsTitle`,
    caption: `Loops.shortcutsCaption`,
  },
}

/**
 * A feature loop in a plain frame, with its caption under it. `data-no-zoom` keeps its poster out
 * of the screenshot lightbox (`islands/shot-lightbox.tsx`).
 */
export function FeatureLoop(
  { loop, sizes = `(min-width: 1280px) 600px, (min-width: 768px) 672px, 100vw`, caption = true }: {
    loop: LoopName
    sizes?: string
    /** Show the caption under the frame; a card that says the same in its text leaves it out. */
    caption?: boolean
  },
): JSX.Element {
  const { t } = useSite()
  const keys = LOOP_KEYS[loop]
  return (
    <div data-no-zoom data-e2e={`loop-${loop}`}>
      <WindowFrame variant="plain" caption={caption ? t.t(keys.caption) : undefined}>
        <LoopClip
          loop={loop}
          name={t.t(keys.name)}
          title={t.t(keys.title)}
          pauseLabel={t.t(`LoopVideo.pauseLabel`)}
          playLabel={t.t(`LoopVideo.playLabel`)}
          sizes={sizes}
        />
      </WindowFrame>
    </div>
  )
}
