# Work with an AI agent

> Also on the website: [seedsaas.com/docs/ai-agents](https://seedsaas.com/docs/ai-agents).

This page shows how to have an AI agent, such as Claude Code, Codex or OpenCode, create a product
from Seed, add features to it and check its own work.

## What the agent reads

| File                | What it holds                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`         | The rules for any agent on the product: where UI code goes, how to add a feature, what must change together. |
| `CLAUDE.md`         | `@AGENTS.md` for the same rules as every other agent, and `@AGENTS.seed.md`, which a product deletes.         |
| `docs/`             | The guides this site publishes. `docs/handoff.md` maps the repository and lists its traps.                    |
| `/llms.txt`         | The website's summary for AI assistants: what the product is and every public page.                           |
| `AGENTS.seed.md`    | Rules for Seed's own repository only. A product deletes it, as [Start a product](start-a-product.md) says.    |

Most agents load `AGENTS.md` by themselves. Point the agent at a guide in `docs/` when its task
has one.

## Create a product

Give the agent the prompt from the README:

```text
Create my new product "Acme" from https://github.com/spy4x/seed and run it locally
```

It creates the repository from the template, then runs `deno task init` and `deno task dev`. Then
have it follow [Building a product on Seed](products.md#start-a-product), which ends with the
[checklist](start-a-product.md) of what belongs to Seed's own website.

## Add a feature

Name the feature and the guide:

```text
Add tasks to Acme: a title, a due date and a done flag. Follow docs/aggregates.md.
```

A new feature copies the notes feature file by file, and [Adding an aggregate](aggregates.md) lists
every file in order. `AGENTS.md` also has the agent add the feature's admin page and update the
demo's data in the same change.

## Check its work

Have the agent run these before it calls the work done:

1. Lint, format, type check and unit tests in one command:

   ```sh
   deno task check
   ```

2. The unit tests alone, while it works:

   ```sh
   deno task test
   ```

3. The browser test of each screen it built or changed, against a stack of its own:

   ```sh
   deno task e2e:local e2e/tasks.e2e.ts
   ```

A new screen gets its own spec in `e2e/`, as `docs/aggregates.md` lists.

## What not to let it touch

- **Secrets.** The env files in `infra/envs/` and the key in `.age/` stay out of chat, commits and
  logs. Only `infra/envs/.env.example`, with placeholders, is committed as plain text.
- **`deno.lock`.** Never edited by hand. A task that needs a new dependency updates it.
- **Your server and its data.** The agent deploys and changes the database there only when you ask
  for it.

## Next

- [Adding an aggregate](aggregates.md)
- [Development](development.md)
- [Deploy and operate](deploy.md)
