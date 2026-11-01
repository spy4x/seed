import type { JSX } from "preact"
import { Button } from "@spy4x/preact-ui/button"
import { ErrorSummary } from "@spy4x/preact-ui/error-summary"
import { Rich } from "@spy4x/preact-ui/i18n"
import { Notice } from "@spy4x/preact-ui/notice"
import type { BlogProblem } from "@domain/blog"
import { useAdminText } from "./i18n.ts"

/**
 * The blog editor's figure problems (#620): the tags in a post's body that readers will not see,
 * in the Problems panel under the editor, in the preview where the figure would be, and in the
 * publish dialog. Each says why in the operator's language; the parser's or the schema's English
 * detail follows in mono.
 *
 * @module
 */

/** The Problems panel's id: the publish dialog's "Go to problems" focuses its first row. */
export const BLOG_PROBLEMS_ID = `blog-problems`

/** A key that stays the same across re-checks while the problem does, so a row keeps its focus. */
export function blogProblemKey(problem: BlogProblem): string {
  return `${problem.line}:${problem.code}:${problem.tag}:${problem.detail}`
}

/** The library's English detail, in mono, never machine-translated. */
function detail(text: string): JSX.Element {
  return <code class="font-mono text-xs wrap-anywhere" translate={false}>{text}</code>
}

/** Why one tag will not show, in a sentence. */
export function BlogProblemText({ problem }: { problem: BlogProblem }): JSX.Element {
  const t = useAdminText()
  const { tag } = problem
  switch (problem.code) {
    case `unknown`:
      return (
        <>
          {problem.suggestion
            ? t.t(`AdminBlogEditor.problemUnknown`, { tag, suggestion: problem.suggestion })
            : t.t(`AdminBlogEditor.problemUnknownNone`, {
              tag,
              names: new Intl.ListFormat(t.language, { type: `conjunction` })
                .format(problem.names ?? []),
            })}
        </>
      )
    case `nested`:
      return <>{t.t(`AdminBlogEditor.problemNested`, { tag })}</>
    case `props`:
    case `syntax`:
      return (
        <Rich
          parts={t.parts(
            problem.code === `props`
              ? `AdminBlogEditor.problemProps`
              : `AdminBlogEditor.problemSyntax`,
            { tag, detail: problem.detail },
          )}
          tags={{ detail }}
        />
      )
  }
}

/**
 * The Problems panel under the Write and Preview tabs: drawn only while a tag will not show, one
 * row per problem whose "Line N" button takes the reader to that line. The count is announced
 * politely when it changes.
 */
export function BlogProblemsPanel(
  { problems, onSelect }: {
    problems: readonly BlogProblem[]
    onSelect: (line: number) => void
  },
): JSX.Element {
  const t = useAdminText()
  return (
    <ErrorSummary
      id={BLOG_PROBLEMS_ID}
      data-e2e="admin-blog-problems"
      title={t.t(`AdminBlogEditor.problemsTitle`, { count: problems.length })}
      items={problems.map((problem) => ({
        key: blogProblemKey(problem),
        label: t.t(`AdminBlogEditor.problemLine`, { line: problem.line }),
        message: <BlogProblemText problem={problem} />,
      }))}
      onSelect={(_, index) => onSelect(problems[index].line)}
      countMessage={(count) => t.t(`AdminBlogEditor.problemsCount`, { count })}
      noneMessage={t.t(`AdminBlogEditor.problemsNone`)}
    >
      {t.t(`AdminBlogEditor.problemsLine`)}
    </ErrorSummary>
  )
}

/**
 * A figure that will not show, in the preview where it would be: a warning that is part of the
 * page, so it is not announced, with a button to its line.
 */
export function BlogProblemMarker(
  { line, problems, onGoTo }: {
    line: number
    problems: readonly BlogProblem[]
    onGoTo: (line: number) => void
  },
): JSX.Element {
  const t = useAdminText()
  return (
    <Notice
      tone="warning"
      live={false}
      title={t.t(`AdminBlogEditor.figureHidden`)}
      data-e2e="admin-blog-preview-problem"
      action={
        <Button type="button" variant="secondary" size="sm" onClick={() => onGoTo(line)}>
          {t.t(`AdminBlogEditor.goToLine`, { line })}
        </Button>
      }
    >
      {problems.filter((problem) => problem.line === line).map((problem) => (
        <p key={blogProblemKey(problem)}>
          <BlogProblemText problem={problem} />
        </p>
      ))}
    </Notice>
  )
}

/** The next problem's line after `caret` (or before it, `back`), wrapping round; `null` with none. */
export function nextProblemLine(
  problems: readonly BlogProblem[],
  caret: number,
  back: boolean,
): number | null {
  const lines = [...new Set(problems.map((problem) => problem.line))].sort((a, b) => a - b)
  if (lines.length === 0) return null
  return back
    ? lines.findLast((line) => line < caret) ?? lines[lines.length - 1]
    : lines.find((line) => line > caret) ?? lines[0]
}

/** The 1-based line a textarea's caret (the start of its selection) sits on. */
export function caretLine(textarea: HTMLTextAreaElement): number {
  return textarea.value.slice(0, textarea.selectionStart).split(`\n`).length
}
