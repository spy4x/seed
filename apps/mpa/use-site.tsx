import type { ComponentChildren, JSX } from "preact"
import type { Language } from "@domain/identity"
import type { MessageValues, Translator } from "@spy4x/platform/universal/i18n"
import { I18nContext, Rich } from "@spy4x/preact-ui/i18n"
import { useSiteText } from "@ui/site-text.ts"
import { DEFAULT_LANGUAGE, isSiteLanguage, localePath, siteTranslator } from "./languages.ts"

/**
 * Puts the translator of `language` around a page, so every part of it speaks that language. Every
 * page under `routes/[[lang]]` gets it from the layout there; a page rendered elsewhere, such as the
 * error page, puts it around itself.
 */
export function SiteLanguage(
  { language, children }: { language: Language | undefined; children: ComponentChildren },
): JSX.Element {
  return (
    <I18nContext.Provider value={siteTranslator(language ?? DEFAULT_LANGUAGE)}>
      {children}
    </I18nContext.Provider>
  )
}

/** What a page or component of the website reads to speak the page's language. */
export interface Site {
  /** The translator of the page's language (`siteTranslator`). */
  t: Translator<string>
  language: Language
  /** The address of the website's page at `path` in the page's language: `/pricing` → `/de/pricing`. */
  href: (path: string) => string
  /** A message with spans, each tag drawn by `tags`, such as a link inside a sentence. */
  rich: (
    key: string,
    tags: Readonly<Record<string, (text: string) => ComponentChildren>>,
    values?: MessageValues,
  ) => JSX.Element
}

/** The page's language, its translator and its addresses, from the nearest `I18nContext`. */
export function useSite(): Site {
  const t = useSiteText()
  const language = isSiteLanguage(t.language) ? t.language : DEFAULT_LANGUAGE
  return {
    t,
    language,
    href: (path) => localePath(language, path),
    rich: (key, tags, values) => <Rich parts={t.parts(key, values)} tags={tags} />,
  }
}

/** Inline code in a message: `<code>init</code>`, in the site's mono face, left to right. */
export function code(text: string): JSX.Element {
  return <code dir="ltr" class="font-mono">{text}</code>
}

/**
 * A terminal's text, left to right and aligned left on a right-to-left page too: commands and
 * their output read the same in every language.
 */
export function TerminalText({ children }: { children: ComponentChildren }): JSX.Element {
  return <span dir="ltr" class="block text-left">{children}</span>
}

/** A message with spans as plain text, its tags dropped: for structured data and attributes. */
export function plainText(t: Translator<string>, key: string, values?: MessageValues): string {
  return t.parts(key, values).map((part) => typeof part === `string` ? part : part.text).join(``)
}
