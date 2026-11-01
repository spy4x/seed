import ShotLightbox, { LIGHTBOX_KEYS } from "../islands/shot-lightbox.tsx"
import { DEFAULT_LANGUAGE, siteTranslator } from "../languages.ts"
import { SiteLanguage } from "../use-site.tsx"
import { define } from "../utils.ts"

/**
 * Every page of the website speaks the language of its address (`State.language`), and opens its
 * screenshots in a lightbox, whose words are the only ones sent to the browser.
 */
export default define.layout(function Layout({ Component, state }) {
  const language = state.language ?? DEFAULT_LANGUAGE
  const t = siteTranslator(language)
  return (
    <SiteLanguage language={state.language}>
      <Component />
      <ShotLightbox
        language={language}
        messages={Object.fromEntries(LIGHTBOX_KEYS.map((key) => [key, t.t(key)]))}
      />
    </SiteLanguage>
  )
})
