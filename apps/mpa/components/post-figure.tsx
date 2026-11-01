import type { JSX } from "preact"
import { type Catalog, createTranslator, type Translator } from "@spy4x/platform/universal/i18n"
import { Explorable, type ExplorableProps } from "@spy4x/preact-ui/explorable"
import { I18nContext } from "@spy4x/preact-ui/i18n"

/**
 * What every figure island gets besides its own props (#620): its `id` on the page, and the words
 * it needs in the post's language. The server sends only those words, not the whole catalog.
 */
export interface FigureFrame {
  id: string
  language: string
  messages: Catalog
}

/** The translator of a figure's words, for its title, lead and caption. */
export function figureTranslator(frame: FigureFrame): Translator<string> {
  return createTranslator({ language: frame.language, catalogs: [{ source: frame.messages }] })
}

/**
 * The frame of every figure in a post: `Explorable` with the figure's id, a scroll margin under
 * the site header, and the note shown with JavaScript off. Its root is `figure[data-live]`, and
 * the components inside read their labels in the post's language.
 */
export function PostFigure(
  { frame, t, ...explorable }:
    & { frame: FigureFrame; t: Translator<string> }
    & Omit<ExplorableProps, `id` | `noScriptNote` | `interactiveLabel`>,
): JSX.Element {
  return (
    <I18nContext.Provider value={t}>
      <Explorable
        {...explorable}
        id={frame.id}
        noScriptNote={t.t(`PostFigure.noScript`)}
        class="scroll-mt-16"
      />
    </I18nContext.Provider>
  )
}
