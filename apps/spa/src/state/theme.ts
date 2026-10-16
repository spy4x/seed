import { createThemeStore } from "@spy4x/preact-signals/theme"

/**
 * The light or dark theme, following the device until the person picks one in the account menu.
 * `main.tsx` attaches it before the first render; `index.html` paints the stored choice before that.
 */
export const themeStore = createThemeStore()
