/**
 * Where the changelog (`/changelog`) starts: the full hash of a commit, or `null` for the whole
 * history. The changelog lists only the commits after it. A product copied from Seed sets the
 * commit that copied Seed in, so its changelog never shows Seed's history.
 *
 * `deno task changelog` reads it, so a change here needs a new run.
 */
export const CHANGELOG_START: string | null = null

/**
 * Better words for the changelog (`/changelog`), by pull request number. A commit subject is
 * written for developers; when it reads badly to a visitor, map its number to one plain sentence
 * here. Map it to `null` to leave the change out, such as a fix to something never released.
 *
 * The page applies these when it renders, so a change here needs no new `deno task changelog`.
 */
export const CHANGELOG_OVERRIDES: Readonly<Record<number, string | null>> = {
  581: `A benchmark page measures how one large group performs on the device it runs on.`,
  627: `Seed's own blog posts load from Markdown files in the demo.`,
}
