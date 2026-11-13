import { App, fsRoutes } from "@spy4x/preact-server"
import { processEnv } from "@spy4x/platform/server/process"
import { blogLinkMiddleware } from "./blog.ts"
import { readMpaConfig } from "./config.ts"
import { contactLinksMiddleware } from "./contact-links.ts"
import {
  indexNowKeyMiddleware,
  newsletterPageMiddleware,
  securityHeadersMiddleware,
  staticFilesMiddleware,
} from "./middleware.ts"
import type { State } from "./utils.ts"

// @ts-ignore: Vite sets `import.meta.env`; Deno's types do not know it.
const dev: boolean = import.meta.env?.DEV ?? false

export const app = new App<State>({ mode: dev ? `development` : `production` })

const config = readMpaConfig(processEnv)

app.use(await securityHeadersMiddleware(config))
app.use(staticFilesMiddleware())
app.use(indexNowKeyMiddleware(config))
app.use(await newsletterPageMiddleware(config))
app.use(await blogLinkMiddleware(config))
app.use(await contactLinksMiddleware(config))
// @ts-ignore: Vite replaces `import.meta.glob`; Deno's types do not know it.
await fsRoutes(app, import.meta.glob([`./routes/**/*.{ts,tsx}`, `!**/*.test.*`]))
