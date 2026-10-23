# Website screenshots and social images

`capture.ts` makes the product pictures of the public website and its Open Graph images. Its output
is committed: the website serves the files, nothing builds them at deploy time.

| Output                                       | What it is                                     |
| -------------------------------------------- | ---------------------------------------------- |
| `static/shots/<name>-<light\|dark>-<w>.webp` | Product screenshots, in each theme and width   |
| `static/og/<page>.png`                       | 1200×630 social card per page, from `og.html`  |
| `screenshots/.out/masters/`                  | Full-resolution PNG masters (gitignored)       |
| `screenshots/.out/cache/`                    | The two Geist fonts the cards use (gitignored) |

## Run it

1. Start the development stack: run `deno task proxy:start` and `deno task dev` from the repository
   root. The script talks to `http://app.localhost`; `SHOTS_APP_URL` changes it.
2. Have `cwebp` (libwebp), `magick` (ImageMagick 7) and `tar` on the `PATH`.
3. From `apps/mpa`: `deno task screenshots`.
   `deno task screenshots --og-only` renders only the social cards, from the shots already there.
4. Look at every picture before you commit it.

A screen that fails is listed at the end and the run exits 1; the others are still written.

## What it does

- Signs up Ada Lovelace, Grace Hopper, Linus Torvalds and Margaret Hamilton (all `@example.com`),
  with a password made per run. It deletes the four accounts first and again at the end, even when
  the run fails, through the development route `/api/test/cleanup-user`.
- Builds the group "Acme Studio" on Pro, five tags and six notes, each note written by its author,
  the way the e2e tests do. Pro comes from a signed webhook of the development billing provider,
  so no Stripe account is needed. Every id it makes is a UUID version 7.
- Gives Ada three notifications from three other groups and two-factor sign-in.
- Photographs each screen in light and dark with reduced motion, a hidden caret, no transitions,
  and a clock fixed a few minutes after the data was made, so every time reads "3 minutes ago".
  The realtime and offline-conflict pictures save a note while they are open, so their clock is
  the real one.

| Screen             | Form                | Delivered widths     |
| ------------------ | ------------------- | -------------------- |
| `notes`            | desktop and mobile  | 1280, 640 / 780, 390 |
| `profile-security` | desktop             | 1280, 640            |
| `group-members`    | desktop             | 1280, 640            |
| `billing`          | desktop             | 1280, 640            |
| `billing-plan`     | mobile, plan only   | 780, 390             |
| `notifications`    | desktop             | 1280, 640            |
| `activity`         | desktop             | 1280, 640            |
| `sign-in`          | mobile              | 780, 390             |
| `realtime-a`, `-b` | desktop, half width | 640, 320             |
| `offline-conflict` | desktop             | 1280, 640            |

Desktop is a 1280×800 viewport at device scale 2, mobile a 390×844 viewport at device scale 3.
`billing-plan` keeps only the 390×208 part of the phone's billing tab that shows the plan, which is
all the home page's billing card draws.

## Size budgets

`cwebp` starts at quality 80 and steps down until a file fits: 90 KB for the notes hero at 1280,
70 KB for every other file. The whole `static/shots` folder stays under 2.5 MB. A social card is a
full-colour PNG when it fits 150 KB and a 256-colour one when it does not.

## Fonts

The cards use Geist Sans and Geist Mono from the `geist` npm package, pinned to 1.7.2 in
`capture.ts`. The script downloads that tarball from the npm registry once, checks it against the
registry's SHA-512 integrity, and unpacks the two variable fonts into `.out/cache`. Geist is under
the SIL Open Font License. `og.html` loads nothing from outside: capture.ts serves it, the fonts
and the screenshots from a made-up origin and blocks every other request.
