/** The admin app's catalogs in ja, in the order of `ENGLISH` in `../i18n.ts`: one chunk of the build. */
import ui from "@spy4x/preact-ui/i18n/ja"
import system from "@spy4x/preact-system/i18n/ja"
import signals from "@spy4x/preact-signals/i18n/ja"
import charts from "@spy4x/preact-charts/i18n/ja"
import app from "@i18n/app/ja.ts"
import own from "@i18n/admin/ja.ts"
import errors from "@i18n/errors/ja.ts"
import type { CatalogList } from "@platform/i18n.ts"

const catalogs: CatalogList = [ui, system, signals, charts, app, own, errors]
export default catalogs
