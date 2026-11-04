# Building a product on Seed

> Also on the website: [seedsaas.com/docs/products](https://seedsaas.com/docs/products).

This page starts a product as a copy of Seed and keeps it taking Seed's later changes: fixes,
security updates and new features.

You need:

- A GitHub account, to create the repository from the template.
- Git and Deno, as the [README](../README.md#quick-start) lists.

A GitHub template copy shares no git history with Seed. So Seed's changes arrive as a patch, from
the Seed commit the product last took to Seed's current `main`.
[Financy](https://github.com/spy4x/financy) is built this way.

## Start a product

Create the repository from the template, as [Get started](get-started.md) shows. Then, in the
product's first pull request:

1. Record the Seed commit the copy came from, in `.seed/commit`. That is the Seed commit whose
   files are exactly those of the product's first commit. Seed's newest commit is not always it: a
   commit that lands in Seed between the copy and this step would be skipped by every later sync,
   without an error. `deno task init` writes Seed's current `main` when the file is missing, so
   check it, and write the right one yourself:

   ```sh
   git fetch --quiet https://github.com/spy4x/seed main
   COPY=$(git rev-list --max-parents=0 HEAD)  # the product's first commit
   mkdir -p .seed && git log --format='%H %T' FETCH_HEAD \
     | awk -v t="$(git rev-parse "$COPY^{tree}")" '$2 == t { print $1; exit }' > .seed/commit
   cat .seed/commit
   ```

   `%T` is a commit's tree: two commits with the same tree hold the same files. If the product
   brought Seed in with a commit of its own rather than the template, set `COPY` to that commit.

   When nothing is printed, no Seed commit matches: the product changed files before its first
   commit. Then take the newest Seed commit older than the copy, and take Seed's changes once
   right away (below), so whatever Seed changed after it arrives now:

   ```sh
   git log -1 --first-parent --format=%H --before="$(git log -1 --format=%cI "$COPY")" FETCH_HEAD \
     > .seed/commit
   ```

   Financy is that case: its first commit on Seed ([financy#83](https://github.com/spy4x/financy/pull/83)) copied Seed's files at
   `fc379655` and changed some of them in the same commit.

2. Create an empty `.seed/skip`. It lists Seed's paths, one per line, that the product never takes
   changes for. Those are the files it deleted and the files that are entirely its own, such as its
   README.
3. Delete `AGENTS.seed.md`, which holds the rules of Seed's own repository, and the lines in
   `AGENTS.md` and `CLAUDE.md` that name it. List `AGENTS.seed.md` in `.seed/skip`. Then add what
   is specific to the product to `AGENTS.md`. A sync never touches `AGENTS.md`.
4. Remove or replace what belongs to Seed's own website and its author:
   [the checklist](start-a-product.md).

## Take Seed's changes

Each sync is one pull request in the product, on its own branch.

1. Fetch Seed's `main`:

   ```sh
   git fetch https://github.com/spy4x/seed main
   ```

2. Apply the patch, leaving out the paths in `.seed/skip`, and record the new commit:

   ```sh
   git diff --binary "$(cat .seed/commit)" FETCH_HEAD -- . ':!AGENTS.md' $(sed '/^$/d; s/^/:!/' .seed/skip) | git apply --3way && git rev-parse FETCH_HEAD > .seed/commit
   ```

3. Run every check before opening the pull request:

   ```sh
   deno task check
   ```

## When the patch does not apply

| What you see                     | What to do                                                       |
| -------------------------------- | ---------------------------------------------------------------- |
| Conflicts                        | Resolve them (below), then record the commit yourself            |
| "does not exist in index"        | The product deleted that file: add it to `.seed/skip` and rerun  |

On a conflict, keep the product's version of a file it changed on purpose: its aggregates, screens,
brand and website copy. Keep Seed's version of anything else.

The `&&` in step 2 skipped the record, so write it yourself:

```sh
git rev-parse FETCH_HEAD > .seed/commit
```

When the product deletes one of Seed's files, or takes it over completely, the same pull request
adds its path to `.seed/skip`.

## Give back to Seed

Code that any product built on Seed would need belongs in Seed. Code that any project could use
belongs in the shared libraries, `spy4x/ts-libs` and `spy4x/preact-components`.

A product that needs such a change makes it there first, merges it, and then takes it with a sync.
It never ships a local version to move later.

## Next

- [Start a product: what belongs to Seed's own website](start-a-product.md)
- [Deploy](deploy.md)
