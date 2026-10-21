# Seed's demo video

The recipe of `media/demo/`: "From an empty folder to the app and the admin panel", the clip the
README's poster links to and antonshubin.com/tools/seed plays. A run clones Seed from GitHub on
camera, starts its documented dev stack, fills it with the development seed's made-up people and
notes, records the app and the admin panel, and encodes the result.

## Remake it

```sh
deno task demo-video            # record and encode, about 15 to 30 minutes
deno task demo-video --encode   # encode the last take again, about 3 minutes
```

Run it from the repository root. Edit `media/demo/captions.vtt` or swap `media/demo/music.opus`,
then `--encode`: the last take stays in `media/demo/.take/` (gitignored) until the next recording.
A recording writes `captions.vtt` anew, with each caption timed from the moment its step started.

## What it needs

1. Docker with Compose, Deno, `git`, `ttyd`, and `ffmpeg` with libvpx-vp9, libx264, libopus,
   libwebp and drawtext.
2. Chromium of the pinned Playwright (`deno run -A npm:playwright@1.57.0 install chromium`).
3. Ports 80 and 443 free, or held by a container named `traefik` (Seed's own proxy, which
   `deno task dev` reuses). No container named `my-product-*`.
4. Passwordless `sudo -n`, to delete the stack's database files, which Postgres and Valkey write as
   their own users.

## What a run does

1. `terminal.ts` starts a bash in ttyd, in an empty folder with a staged home, and shows it in a
   browser page. `record.ts` types `git clone`, `cd`, `deno task init` (and answers its project
   name question) and `deno task dev`. A wait longer than 1.6 s plays in about 1.6 s, and its
   caption says how much faster.
2. Between `init` and `dev`, off camera, the env file gets the hosts `my-product.localhost` and
   `admin.my-product.localhost`, spare host ports and `COMPOSE_PROFILES=admin`, so the stack runs
   beside any other Seed stack on the machine. Nothing else changes.
3. After `dev`: `deno task db:seed`, then `stage.ts` gives the Product team's owner a random
   password through the reset flow and signs them and the seed's administrator in, in browser
   contexts that are not recorded. No password is ever on screen.
4. The app and the admin panel are recorded at 960×600 CSS pixels, a third larger than the clip,
   so their text stays readable where the clip plays about 528 px wide. `pointer.js`, `keys.js` and
   `human-mouse.ts` draw a pointer and key caps and move like a person.
5. `take.ts` records with Chrome's screencast: a frame each time the page paints, timed by the
   clock, so a loaded machine paints fewer frames but never shifts the timing. It turns the shots
   into one frame per 1/30 s and writes them as a lossless `take.mkv`. On a loaded machine a page
   can take seconds to answer a click, and key presses lag: a page's answer plays in at most
   0.5 s, and typing at 65 ms a key.
6. `encode.ts` adds the title and end cards, burns in the captions, lays the music under it at
   about -28 LUFS, and writes `demo.webm`, `demo.mp4`, `poster.webp` and `poster-640.webp`.
7. On exit, failed, stopped with Ctrl-C (SIGINT) or SIGTERM, or not, the stack's containers,
   volumes and images go, with its temporary folder (through `sudo -n`, since the containers write
   files there as their own users), and Traefik and the `proxy` network too when this run started
   them.

The poster is the team's notes list, the first screen of the app, without the pointer: the clip's
opening frame is an empty terminal, which tells a visitor nothing.

## Check the result

```sh
ffmpeg -i media/demo/demo.mp4 -vf "fps=1,scale=320:-1,tile=6x10" -frames:v 1 sheet.png
ffmpeg -i media/demo/demo.mp4 -af ebur128=peak=true -f null - 2>&1 | tail -12
```

Every caption readable and clear of what it describes, the cards there, and nothing on screen but
the seed's made-up data.
