import type { JSX } from "preact"
import { IconPlaySolid } from "@spy4x/preact-icons"
import { WindowFrame } from "@spy4x/preact-ui/window-frame"
import { ADMIN_VIDEO } from "../admin-video.ts"
import { useSite } from "../use-site.tsx"

/** The address in the frame's bar: a made-up host, since the public demo has no admin panel. */
const FRAME_TITLE = `admin.example.com`

/**
 * The admin panel video in a browser frame: the native player only. It loads nothing but the
 * poster before a click, plays with its sound when it has one, never starts by itself and works
 * without JavaScript. Its size is fixed, so nothing moves when the poster arrives.
 */
export function AdminVideoPlayer(): JSX.Element {
  const { t } = useSite()
  return (
    <WindowFrame variant="browser" title={FRAME_TITLE}>
      <video
        controls
        preload="none"
        playsInline
        poster={ADMIN_VIDEO.poster}
        width={ADMIN_VIDEO.width}
        height={ADMIN_VIDEO.height}
        class="block h-auto w-full bg-canvas focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        aria-label={t.t(`AdminVideo.label`, {
          seconds: ADMIN_VIDEO.seconds,
          sound: t.t(`AdminVideo.soundLabel`),
        })}
        data-e2e="admin-video"
        data-analytics-video="admin-video"
      >
        <source src={ADMIN_VIDEO.webm} type={`video/webm; codecs="av01.0.08M.08, opus"`} />
        <source src={ADMIN_VIDEO.mp4} type="video/mp4" />
        <a
          href={ADMIN_VIDEO.mp4}
          data-umami-event="admin-video-download"
          data-umami-event-from="player"
        >
          {t.t(`AdminTour.download`, { size: ADMIN_VIDEO.mp4Size })}
        </a>
      </video>
    </WindowFrame>
  )
}

/**
 * A still of the admin panel in a browser frame, linked to `/admin`, where the video plays. It
 * loads only when it nears the screen.
 */
export function AdminVideoStill(): JSX.Element {
  const { t, href } = useSite()
  return (
    <a
      href={href(`/admin`)}
      class="group block rounded-card"
      data-e2e="admin-video-still"
      data-umami-event="features-admin-video"
      data-umami-event-from="still"
    >
      <WindowFrame variant="browser" title={FRAME_TITLE}>
        <span class="relative block">
          <img
            src={ADMIN_VIDEO.still}
            width={ADMIN_VIDEO.stillSize.width}
            height={ADMIN_VIDEO.stillSize.height}
            alt={t.t(`AdminVideo.stillAlt`)}
            loading="lazy"
            decoding="async"
            class="block h-auto w-full"
          />
          <span class="absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <IconPlaySolid class="size-16 rounded-full bg-scrim p-4 text-scrim-foreground shadow-lg motion-safe:transition-transform motion-safe:group-hover:scale-110" />
          </span>
        </span>
      </WindowFrame>
    </a>
  )
}
