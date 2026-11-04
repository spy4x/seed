// The client entry: the site's styles, and the code that wakes a page's islands. A page loads the
// script only when it has an island (`@spy4x/preact-server`); every page works without it.
import "./styles.css"
import { hydrateIslands } from "@spy4x/preact-server/client"

// @ts-ignore: Vite replaces `import.meta.glob`; Deno's types do not know it.
hydrateIslands(import.meta.glob([`./islands/**/*.tsx`, `!**/*.test.*`]))
