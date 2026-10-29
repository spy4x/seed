/**
 * The `app` catalog on the server, for what Telegram shows: the bot's answers and the
 * notifications it sends. The chat says what the inbox says, in the same words.
 *
 * @module
 */

import { type Catalog, createTranslator, type Translator } from "@spy4x/platform/universal/i18n"
import type { Language } from "@domain/identity"
import en from "@i18n/app/en.json" with { type: "json" }
import ru from "@i18n/app/ru.json" with { type: "json" }
import es from "@i18n/app/es.json" with { type: "json" }
import de from "@i18n/app/de.json" with { type: "json" }
import ptBR from "@i18n/app/pt-BR.json" with { type: "json" }
import ar from "@i18n/app/ar.json" with { type: "json" }

const CATALOGS: Record<Language, Catalog> = { en, ru, es, de, "pt-BR": ptBR, ar }
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
