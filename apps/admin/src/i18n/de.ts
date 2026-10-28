/** The admin app's catalogs in de, in the order of `ENGLISH` in `../i18n.ts`: one chunk of the build. */
import ui from "@spy4x/preact-ui/i18n/de"
import system from "@spy4x/preact-system/i18n/de"
import signals from "@spy4x/preact-signals/i18n/de"
import charts from "@spy4x/preact-charts/i18n/de"
import app from "@i18n/app/de.json" with { type: "json" }
import own from "@i18n/admin/de.json" with { type: "json" }
import errors from "@i18n/errors/de.json" with { type: "json" }
import type { CatalogList } from "@platform/i18n.ts"

const catalogs: CatalogList = [ui, system, signals, charts, app, own, errors]
export default catalogs
