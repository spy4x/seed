---
name: recapture-shots
description: Re-capture the public website's product screenshots (apps/mpa/static/shots) and social cards with apps/mpa/screenshots/capture.ts. Use after a change that alters how a photographed screen looks in a significant way, and ask the owner when unsure.
---

# Re-capture the website's product screenshots

The public website (`apps/mpa`) shows pictures of the product, made by
`apps/mpa/screenshots/capture.ts` and committed under `apps/mpa/static/shots/` and
`apps/mpa/static/og/`. `AGENTS.md`, "Website screenshots", says when to run this. This skill says
how.

## 1. Decide whether to run

`AGENTS.md`, "Website screenshots", says when. The photographed screens are listed in
`apps/mpa/screenshots/README.md`, "What it does".

## 2. Prepare

1. Work in a worktree on `main` with the change merged (Git Flow in the global rules), branch
   `docs/recapture-shots`.
2. Check the tools: `command -v cwebp magick tar`.
3. Add `admin` to `COMPOSE_PROFILES` in `infra/envs/.env`, then from the worktree root run
   `deno task proxy:start` and `deno task dev`. Both start detached Docker containers. Wait until
   `http://app.localhost` and `http://admin.localhost` answer.

## 3. Capture

From `apps/mpa`, through the harness's background runner (a foreground call stops at ten minutes):

```bash
systemd-run --user --scope --quiet -p TasksMax=4000 -p MemoryMax=8G timeout 900 deno task screenshots
```

A failing screen is listed at the end and the run exits 1; fix the cause and run again, at most
three times. The script deletes its four demo accounts at the end, also when it fails.

## 4. Look, then ship

1. Open every changed `.webp` and `og/*.png` with the Read tool. Check each against the screen it
   shows: right data, nothing cut off, both themes, no spinner or toast caught mid-flight.
2. Check the budgets the README names: 90 KB for the notes hero at 1280, 70 KB for the rest, under
   2.5 MB for the folder (`du -sb apps/mpa/static/shots`).
3. Stop what you started: `deno task compose down` and `deno task proxy:stop`, unless the stack was
   already running before you began. Then run the orphan sweep.
4. Open a PR with the before and after of the main pictures. A design reviewer checks it, as for
   any visible change; merge and deploy as `AGENTS.md` says.
