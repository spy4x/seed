/**
 * Facts about the repository that the home page states, counted from the files when Vite builds
 * the site (`vite.config.ts`), so a number never falls behind the code. Without a Vite build, as
 * under `deno test`, nothing was counted and the page leaves the fact out.
 *
 * Only the folders the image's build context holds are counted (`.dockerignore`): the image builds
 * the site, and a number counted elsewhere would differ from the one a visitor is shown.
 */

/** Replaced with a number by Vite's `define` (`vite.config.ts`). */
declare const __SEED_TEST_FILES__: number | undefined

/** The folders, relative to the repository root, whose test files are counted. */
export const COUNTED_FOLDERS = [`apps`, `libs`] as const

/** Whether `path`, relative to the repository root with `/` between folders, is a counted test. */
export function isCountedTestFile(path: string): boolean {
  const parts = path.split(`/`)
  return COUNTED_FOLDERS.some((folder) => parts[0] === folder) &&
    /\.test\.tsx?$/.test(path) &&
    !parts.some((part) => part === `node_modules` || part === `_fresh`)
}

/** How many of `paths` are counted test files. */
export function countTestFiles(paths: Iterable<string>): number {
  let count = 0
  for (const path of paths) if (isCountedTestFile(path)) count++
  return count
}

/** The test files in the apps and libraries when the site was built; `undefined` without a build. */
export const TEST_FILE_COUNT: number | undefined = typeof __SEED_TEST_FILES__ === `number`
  ? __SEED_TEST_FILES__
  : undefined
