/** The SPA's catalogs in ru, in the order of `ENGLISH` in `../i18n.ts`: one chunk of the build. */
import ui from "@spy4x/preact-ui/i18n/ru"
import system from "@spy4x/preact-system/i18n/ru"
import signals from "@spy4x/preact-signals/i18n/ru"
import charts from "@spy4x/preact-charts/i18n/ru"
import own from "@i18n/app/ru.json" with { type: "json" }
import errors from "@i18n/errors/ru.json" with { type: "json" }
import type { CatalogList } from "@platform/i18n.ts"

const catalogs: CatalogList = [ui, system, signals, charts, own, errors]
export default catalogs
