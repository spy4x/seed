/** The SPA's catalogs in es, in the order of `ENGLISH` in `../i18n.ts`: one chunk of the build. */
import ui from "@spy4x/preact-ui/i18n/es"
import system from "@spy4x/preact-system/i18n/es"
import signals from "@spy4x/preact-signals/i18n/es"
import charts from "@spy4x/preact-charts/i18n/es"
import own from "@i18n/app/es.json" with { type: "json" }
import errors from "@i18n/errors/es.json" with { type: "json" }
import type { CatalogList } from "@platform/i18n.ts"

const catalogs: CatalogList = [ui, system, signals, charts, own, errors]
export default catalogs
