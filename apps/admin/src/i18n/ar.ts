/** The admin app's catalogs in ar, in the order of `ENGLISH` in `../i18n.ts`: one chunk of the build. */
import ui from "@spy4x/preact-ui/i18n/ar"
import system from "@spy4x/preact-system/i18n/ar"
import signals from "@spy4x/preact-signals/i18n/ar"
import charts from "@spy4x/preact-charts/i18n/ar"
import app from "@i18n/app/ar.json" with { type: "json" }
import own from "@i18n/admin/ar.json" with { type: "json" }
import errors from "@i18n/errors/ar.json" with { type: "json" }
import type { CatalogList } from "@platform/i18n.ts"

const catalogs: CatalogList = [ui, system, signals, charts, app, own, errors]
export default catalogs
