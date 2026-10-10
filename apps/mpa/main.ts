import { App, staticFiles } from "fresh"
import { readMpaConfig } from "./config.ts"
import { pageMiddleware, securityHeadersMiddleware } from "./middleware.ts"
import type { State } from "./utils.ts"

export const app = new App<State>()

const config = readMpaConfig(Deno.env)

app.use(await securityHeadersMiddleware(config))
app.use(staticFiles())
app.use(pageMiddleware(config))
app.fsRoutes()
