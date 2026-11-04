# AGENTS.seed.md — Seed's own repository

Read `AGENTS.md` first. This file adds the rules that hold only in Seed's own repository: its
website, its screenshots and videos, its blog, its live demo server and Financy. A product
deletes this file and the line in `AGENTS.md` that names it.

## Product screenshots

The public website (`apps/mpa/static/shots/`) and the README (`docs/screenshots/`) show pictures of
the product. When a change alters a photographed screen significantly (the shell, a screen's
layout, its primary action, the palette), re-capture both sets in a PR of their own with the
`recapture-shots` skill (`.claude/skills/recapture-shots/SKILL.md`), once the change is merged. A
small change (a wording, a spacing nudge) does not need it. When unsure, ask the owner.

The admin panel video on the website's `/admin` page (`apps/mpa/media/video/`) shows the admin
app's screens too. When a change alters a screen the video shows significantly, re-record the
video with `deno task video:admin` in the same follow-up PR as the screenshots, and update
`apps/mpa/admin-video.ts` (its length, size, upload date and transcript) to match. The skill says
how.

The website's three feature loops (realtime, offline, shortcuts; `apps/mpa/media/video/*-loop-*`)
film the SPA's screens. When a change alters a screen a loop shows significantly, re-record that
loop with `deno task loops <name>` in `apps/mpa`, in the same follow-up PR.

## Blog

Seed's own posts (seedsaas.com) are Markdown files in `libs/server/blog/seed-posts/`, whose
`README.md` shows the format; they load only in demo mode ([docs/demo.md](docs/demo.md#seeds-own-blog-posts)).

- **Changelog.** A monthly "What's new in Seed" post, and a post of its own for a major change: a
  new module, or something products must act on when they sync.
- **A cover on every post.** Each post gets one AI-made illustration in Seed's violet and the one
  house style of `seed-posts/covers/README.md`, never a meme, made with `deno task blog:cover` into
  `seed-posts/covers/`; a translation shares its original's. Then run `deno task og:blog` in
  `apps/mpa` for its link-preview card.
- **Ideas go to the owner first.** Propose a post in chat (title, reader, the search question it
  answers, outline, interactive part) and file its issue only after the owner says yes.

## The live demo is not production

The template's own server, which runs the live demo the README links to, is not in production
yet: nobody depends on it and nothing of this project on it has to be kept. An agent may change
that server without asking: deploy to it, edit its env file (`infra/envs/.env.prod`, which
`deno task deploy` copies there), change or reset its database, and delete this project's data
under `.volumes/`. Other projects run on the same server and are not ours to touch.

This holds for the template only. A product started from the template deletes this section: its
server holds real people's data.

## Financy

Financy is being rebuilt on Seed, as the first product built on it. Seed decides how Financy's
code looks; Financy says which features it needs. A feature any product would need is built here
first and Financy takes it with a sync. Do not port Financy's old structure into Seed.
