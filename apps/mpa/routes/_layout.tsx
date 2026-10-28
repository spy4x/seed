import { SiteLanguage } from "../use-site.tsx"
import { define } from "../utils.ts"

/** Every page of the website speaks the language of its address (`State.language`). */
export default define.layout(function Layout({ Component, state }) {
  return (
    <SiteLanguage language={state.language}>
      <Component />
    </SiteLanguage>
  )
})
