// Seed's own site: see docs/start-a-product.md
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
  /** The Dashboard, without the pointer: the player's poster on `/admin`. */
  poster: `/video/admin-panel-poster-1920.webp`,
  /** A still of the Users list, cropped to its first five people: the picture on `/features`. */
  still: `/video/admin-panel-poster-1280.webp`,
  stillSize: { width: 1280, height: 800 },
  width: 1920,
  height: 1200,
  /** The length, rounded to whole seconds. */
  seconds: 59,
  /** The MP4's size, as the download link names it. */
  mp4Size: `5 MB`,
  /** When the recording was published, with its timezone, for the JSON-LD and the sitemap. */
  uploadDate: `2026-10-23T23:46:43+07:00`,
  /** What a viewer hears, in the line under the player, in its label and above the transcript. */
  sound: {
    line: `Music, no speech`,
    label: `with music and no speech`,
    transcript: `Music plays under the video. There is no speech.`,
  },
  /** What the video shows, one sentence per shot, for a reader who cannot watch it. */
  transcript: [
    `A title card: "Seed's admin panel, built for support work."`,
    `The Dashboard shows the last 30 days: people, new sign-ups, who is active, groups, notes and guest accounts, then zooms in on the chart of active people per day.`,
    `On Users, the operator types "hartley" into the search. The list narrows to three people, Claire Hartley among them.`,
    `Claire Hartley's page opens. Its Sessions tab lists her two signed-in devices: Firefox on Windows and Safari on iPhone.`,
    `The operator chooses "End all". A dialog asks them to confirm; they confirm, and the list empties.`,
    `The audit log's newest row reads "Sessions ended", about Claire Hartley, done by the operator.`,
    `Groups lists every group with its owner, the largest first. The operator opens Product team and sees its members.`,
    `Billing shows €369.00 a month from seven paying groups, one of them past due. The operator opens Design studio, whose history shows a refunded payment with the operator's note.`,
    `Newsletter shows 90 subscribers, 50 who joined in the last 30 days, 3 issues sent and a chart of the list growing.`,
    `System says everything is working: the database, the cache, the file store, the job queue, the backups and the migrations are all OK.`,
    `From the account menu, the operator switches the theme from dark to light.`,
    `An end card: "Free and MIT-licensed. The code is on GitHub."`,
  ],
} as const

/** The video's length as ISO 8601, such as `PT45S`, for its JSON-LD. */
export const ADMIN_VIDEO_DURATION = `PT${ADMIN_VIDEO.seconds}S`
