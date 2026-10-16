import { themeBootstrapScript } from "@spy4x/preact-signals/theme"
import { define } from "../utils.ts"

/**
 * The script that paints the dark palette before the first paint when the device asks for dark,
 * and follows the device after that. The library writes it; it is served as a file because the
 * content security policy allows scripts from this origin only, never inline. Without JavaScript
 * the site stays light.
 */
export const THEME_SCRIPT = themeBootstrapScript({ followSystem: true })

export const handler = define.handlers({
  GET() {
    return new Response(THEME_SCRIPT, {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "public, max-age=3600",
      },
    })
  },
})
