/** The admin app's catalogs in fr, in the order of `ENGLISH` in `../i18n.ts`: one chunk of the build. */
import ui from "@spy4x/preact-ui/i18n/fr"
import system from "@spy4x/preact-system/i18n/fr"
import signals from "@spy4x/preact-signals/i18n/fr"
import charts from "@spy4x/preact-charts/i18n/fr"
import app from "@i18n/app/fr.ts"
import own from "@i18n/admin/fr.ts"
import errors from "@i18n/errors/fr.ts"
import type { CatalogList } from "@platform/i18n.ts"

const catalogs: CatalogList = [ui, system, signals, charts, app, own, errors]
export default catalogs
