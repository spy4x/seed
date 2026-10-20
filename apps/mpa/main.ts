import { App } from "fresh"
import { readMpaConfig } from "./config.ts"
import {
  newsletterPageMiddleware,
  securityHeadersMiddleware,
  staticFilesMiddleware,
} from "./middleware.ts"
import type { State } from "./utils.ts"

export const app = new App<State>()

const config = readMpaConfig(Deno.env)

app.use(await securityHeadersMiddleware(config))
app.use(staticFilesMiddleware())
app.use(await newsletterPageMiddleware(config))
app.fsRoutes()
