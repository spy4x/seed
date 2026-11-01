/**
 * The `app` catalog on the server, for what Telegram shows: the bot's answers and the
 * notifications it sends. The chat says what the inbox says, in the same words.
 *
 * @module
 */

import { type Catalog, createTranslator, type Translator } from "@spy4x/platform/universal/i18n"
import type { Language } from "@domain/identity"
import en from "@i18n/app/en.ts"
import ru from "@i18n/app/ru.ts"
import es from "@i18n/app/es.ts"
import de from "@i18n/app/de.ts"
import ptBR from "@i18n/app/pt-BR.ts"
import ar from "@i18n/app/ar.ts"
import fr from "@i18n/app/fr.ts"
import ja from "@i18n/app/ja.ts"
import zhCN from "@i18n/app/zh-CN.ts"

const CATALOGS: Record<Language, Catalog> = { en, ru, es, de, "pt-BR": ptBR, ar, fr, ja, "zh-CN": zhCN }
const translators = new Map<Language, Translator<string>>()

/** The `app` catalog in `language`, made on first use. */
export function translatorFor(language: Language): Translator<string> {
  let translator = translators.get(language)
  if (!translator) {
    translator = createTranslator({
      language,
      catalogs: [{ source: en, translation: language === `en` ? undefined : CATALOGS[language] }],
    })
    translators.set(language, translator)
  }
  return translator
}
