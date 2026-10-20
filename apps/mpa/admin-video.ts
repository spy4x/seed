/**
 * The admin panel video, as the website describes it: one source for the line under the player,
 * its `aria-label`, the JSON-LD and sitemap `duration`, the `/features` link and the transcript.
 * `deno task video:admin` (`docs/screenshots/admin-video.ts`) records the files and prints their
 * length and sizes; a new recording updates this module in the same change.
 *
 * The videos are in `media/video/` (served by `routes/video/[file].ts`), the posters in
 * `static/video/`.
 */
export const ADMIN_VIDEO = {
  webm: `/video/admin-panel.webm`,
  mp4: `/video/admin-panel.mp4`,
  /** The full frame the video's first Users shot opens on: the player's poster on `/admin`. */
  poster: `/video/admin-panel-poster-1920.webp`,
  /** A still of the Users list, cropped to its first five people: the picture on `/features`. */
  still: `/video/admin-panel-poster-1280.webp`,
  stillSize: { width: 1280, height: 800 },
  width: 1920,
  height: 1200,
  /** The length, rounded to whole seconds. */
  seconds: 45,
  /** The MP4's size, as the download link names it. */
  mp4Size: `3 MB`,
  /** When the recording was published, with its timezone, for the JSON-LD and the sitemap. */
  uploadDate: `2026-10-20T15:43:10+07:00`,
  /** What a viewer hears, in the line under the player, in its label and above the transcript. */
  sound: {
    line: `No sound`,
    label: `with no sound`,
    transcript: `The video has no sound.`,
  },
  /** What the video shows, one sentence per shot, for a reader who cannot watch it. */
  transcript: [
    `A title card: "Seed's admin panel, built for support work."`,
    `On Users, the operator types "novak" into the search. The list narrows to one person, Priya Novak, and the video zooms in on the field and the result.`,
    `Priya Novak's page opens. Its Sessions tab lists her two signed-in devices: Firefox on Windows and Safari on iPhone.`,
    `The operator chooses "End all". A dialog asks them to confirm; they confirm, and the list empties.`,
    `The audit log's newest row reads "Sessions ended", about Priya Novak, done by the operator.`,
    `Groups lists every group with its owner. The operator opens one, Product team, and sees its members.`,
    `Newsletter shows 40 subscribers, none pending and 20 who joined in the last 30 days, zoomed in on those numbers.`,
    `From the account menu, the operator switches the theme from dark to light.`,
    `An end card: "Free and MIT-licensed. The code is on GitHub."`,
  ],
} as const

/** The video's length as ISO 8601, such as `PT45S`, for its JSON-LD. */
export const ADMIN_VIDEO_DURATION = `PT${ADMIN_VIDEO.seconds}S`
