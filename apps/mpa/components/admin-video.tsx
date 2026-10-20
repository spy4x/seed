import type { JSX } from "preact"
import { WindowFrame } from "@spy4x/preact-ui/window-frame"

/** The recording, made by `deno task video:admin`: the videos are in `media/video/` (served by
 * `routes/video/[file].ts`), the poster in `static/video/`. */
export const ADMIN_VIDEO = {
  webm: `/video/admin-panel.webm`,
  mp4: `/video/admin-panel.mp4`,
  poster: `/video/admin-panel-poster-1280.webp`,
  width: 1920,
  height: 1200,
} as const

/** What the video shows, one sentence per shot, for a reader who cannot watch it. */
const TRANSCRIPT = [
  `A title card: "Seed's admin panel, built for support work."`,
  `On Users, the operator types "novak" into the search. The list narrows to one person, Priya Novak, and the video zooms in on the field and the result.`,
  `Priya Novak's page opens. Its Sessions tab lists her two signed-in devices: Firefox on Windows and Safari on iPhone.`,
  `The operator chooses "End all". A dialog asks them to confirm; they confirm, and the list empties.`,
  `The audit log's newest row reads "Sessions ended", about Priya Novak, done by the operator.`,
  `Groups lists every group with its owner. The operator opens one, Product team, and sees its members.`,
  `Newsletter shows 40 subscribers, none pending and 20 who joined in the last 30 days, zoomed in on those numbers.`,
  `From the account menu, the operator switches the theme from dark to light.`,
  `An end card: "Free and MIT-licensed. The code is on GitHub."`,
] as const

/**
 * The admin panel video of `/features#admin`, in a browser frame. The native player only: it
 * loads nothing before a click, plays with the sound off (it has none) and works without
 * JavaScript. Its size is fixed, so nothing moves when the poster arrives. The transcript under it
 * says what each shot shows.
 */
export function AdminVideo(): JSX.Element {
  return (
    <div class="flex flex-col gap-3">
      <WindowFrame variant="browser" title="admin.seedsaas.com">
        <video
          controls
          preload="none"
          playsInline
          muted
          poster={ADMIN_VIDEO.poster}
          width={ADMIN_VIDEO.width}
          height={ADMIN_VIDEO.height}
          class="block h-auto w-full bg-canvas"
          aria-label="The admin panel, in a video of about 45 seconds with no sound"
          data-e2e="admin-video"
        >
          <source src={ADMIN_VIDEO.webm} type={`video/webm; codecs="av01.0.08M.08"`} />
          <source src={ADMIN_VIDEO.mp4} type="video/mp4" />
          <a href={ADMIN_VIDEO.mp4}>Download the admin panel video (MP4)</a>
        </video>
      </WindowFrame>
      <p class="text-sm text-muted text-pretty">
        Not part of the public demo, because operators there would see real sign-ups.
      </p>
      <details class="text-sm" data-e2e="admin-video-transcript">
        <summary class="cursor-pointer py-2 font-medium text-primary">
          Read what the video shows
        </summary>
        <ol class="flex list-decimal flex-col gap-2 pl-6 text-muted">
          {TRANSCRIPT.map((line) => <li key={line} class="text-pretty">{line}</li>)}
        </ol>
        <p class="mt-3 text-muted">The people and groups in the video are made-up sample data.</p>
      </details>
    </div>
  )
}
