# Writing the docs

The reader is a developer who just made a product from Seed, or that developer's AI agent. Both
scan first, then copy a command. Every page under `docs/` that the website publishes follows this.

## The four sections

`apps/mpa/docs-site.ts` (`PUBLISHED_DOCS`) and `docs/README.md` list the guides in four groups:

| Group       | What goes there                                                        |
| ----------- | ---------------------------------------------------------------------- |
| Get started | The first hour: what Seed is, starting a product, working with agents. |
| Guides      | One task each, such as deploying, backups or turning on billing.       |
| Concepts    | How a part works and why.                                              |
| Reference   | Look-up tables: settings, API errors, security headers, the API.       |

A page split off another goes in the group of what it does, next to its parent.

## A page

- One job per page. The title names it: "Deploy to a server", "Take Seed's updates".
- About 150 lines at most. A longer page is split by task. The original file and slug stay as the
  first part, or as a short overview that links its parts, so every old link still works.
- First, one sentence on what the page gets the reader. Then a **You need** list, when there is
  anything to have first.
- Last, a **Next** section with one to three links.

## Text

- One idea per sentence, about 25 words at most. Paragraphs of four sentences at most.
- Steps are a numbered list, one action per step. A command gets its own code block.
- Settings (environment variables, options, flags) are a table: name, what it does, default or
  example. Never three settings in one sentence.
- The how comes first, the why after it, in one short paragraph. A file or function name appears
  only when the reader needs it to act. Other implementation detail is cut, or moved to a Reference
  page when someone would still look it up.
- Code blocks have a language (`sh`, `ts`, `text`). No `$` prompt. One command per line; a long one
  is broken with `\`.
- At most three code spans in a sentence. Plain words; a term is explained on first use.
- Accuracy over brevity: check every claim against the code. Cutting trivia is fine; dropping a
  fact a reader needs to act is not.

## Before and after

A paragraph that names nine settings, a Dockerfile and two deploy paths becomes steps and a table:

````md
## Deploy the website

1. In `infra/envs/.env`, add `mpa` to `COMPOSE_PROFILES`. Separate profiles with commas.
2. Set `MPA_DOMAIN` to the website's host, and point that host's DNS record at the server.
3. Deploy as usual:

   ```sh
   deno task deploy
   ```

Traefik gets the certificate for `MPA_DOMAIN` the same way as for `DOMAIN`.

| Variable        | What it does                                                         |
| --------------- | -------------------------------------------------------------------- |
| `MPA_DOMAIN`    | The website's host. Also points the newsletter's mailed links at it. |
| `API_URL`       | Where the website's server reaches the API. Compose sets it.         |
| `ENV`, `DOMAIN` | The same values as the API's.                                        |

The website refuses to start without any of them.
````

## Mechanics

- The pointer line under the heading stays: `> Also on the website: …` (`pointerLine` in
  `docs-site.ts`).
- A new published page needs its import and its `PUBLISHED_DOCS` entry in `docs-site.ts`, its line
  in `.dockerignore` and in `infra/deploy/include.txt`, and the pointer line.
  `apps/mpa/docs-site.test.ts` checks all four. List it in `docs/README.md` too.
- Moving a section breaks links to its anchor. Before you finish, run `git grep -n '<file>.md#'`
  for each file you changed and fix every hit: code comments, `AGENTS.md`, `i18n/`, other docs and
  the website's feature pages all link into the guides.
- `deno fmt` the files, then run the docs-site tests and `deno task mpa:check`.
