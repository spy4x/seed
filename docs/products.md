# Building a product on Seed

A product starts as a copy of Seed and keeps taking Seed's later changes: fixes, security updates
and new features. A GitHub template copy shares no git history with Seed, so those changes arrive
as a patch, from the Seed commit the product last took to Seed's current `main`.
[Financy](https://github.com/spy4x/financy) is being built this way.

## Start a product

Create the repository from the template, as the [README](../README.md#quick-start) shows. Then,
in the product's first pull request:

1. Record the Seed commit the copy came from, in `.seed/commit`. Right after creating the
   repository, that is Seed's current `main`:

   ```sh
   mkdir -p .seed && git ls-remote https://github.com/spy4x/seed refs/heads/main | cut -f1 > .seed/commit
   ```

2. Create an empty `.seed/skip`. It lists Seed's paths, one per line, that the product never takes
   changes for: the files it deleted and the files that are entirely its own, such as its README.
3. Replace `AGENTS.md` with the product's own. It says that Seed's `AGENTS.md` applies, except the
   sections "The live demo is not production" and "Financy", and adds what is specific to the
   product. A sync never touches it.
4. Remove or replace what belongs to Seed's own website and its author:
   [the checklist](start-a-product.md).

## Take Seed's changes

Each sync is one pull request in the product, on its own branch:

```sh
git fetch https://github.com/spy4x/seed main
git diff --binary "$(cat .seed/commit)" FETCH_HEAD -- . ':!AGENTS.md' $(sed '/^$/d; s/^/:!/' .seed/skip) \
  | git apply --3way && git rev-parse FETCH_HEAD > .seed/commit
```

When the patch applies with conflicts, keep the product's version of a file the product changed
on purpose (its aggregates, screens, brand, website copy) and Seed's version of anything else.
Then record the synced commit yourself, since the `&&` above skipped it:
`git rev-parse FETCH_HEAD > .seed/commit`. Run `deno task check` before opening the pull request.

A patch refused with "does not exist in index" touches a file the product deleted without listing
it in `.seed/skip`: list it and run the sync again.

When the product deletes one of Seed's files, or takes it over completely, the same pull request
adds its path to `.seed/skip`, so later patches leave it out.

## Give back to Seed

Code that any product built on Seed would need belongs in Seed, and code that any project could
use belongs in the shared libraries (`spy4x/ts-libs`, `spy4x/preact-components`). A product that
needs such a change makes it there first, merges it, and then takes it with a sync. It never ships
a local version to move later.
