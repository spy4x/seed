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
