import type { JSX } from "preact"
import { DemoVideo, type DemoVideoProps } from "@spy4x/preact-ui/demo-video"
import { LoopVideo, type LoopVideoProps } from "@spy4x/preact-ui/loop-video"

// Both videos live in one island file on purpose: Fresh ships one script per island file, and on
// the home page, which draws both, a second script delays the first paint on a slow phone
// (Lighthouse budget, `lighthouse/lighthouserc.json`). The pages build every prop on the server,
// so this file imports nothing of the site's own.

/**
 * The README's one-minute demo (`media/demo/`) in the home page's hero: its poster until the
 * visitor presses it, then the clip with its captions and music. It never starts by itself.
 */
export function HeroDemo(props: DemoVideoProps): JSX.Element {
  return <DemoVideo {...props} />
}

/** One feature loop: the poster without JavaScript, the clip playing while it is in view with it. */
export function LoopClip(props: LoopVideoProps): JSX.Element {
  return <LoopVideo {...props} />
}
