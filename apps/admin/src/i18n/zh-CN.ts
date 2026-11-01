/** The admin app's catalogs in zh-CN, in the order of `ENGLISH` in `../i18n.ts`: one chunk of the build. */
import ui from "@spy4x/preact-ui/i18n/zh-CN"
import system from "@spy4x/preact-system/i18n/zh-CN"
import signals from "@spy4x/preact-signals/i18n/zh-CN"
import charts from "@spy4x/preact-charts/i18n/zh-CN"
import app from "@i18n/app/zh-CN.ts"
import own from "@i18n/admin/zh-CN.ts"
import errors from "@i18n/errors/zh-CN.ts"
import type { CatalogList } from "@platform/i18n.ts"

const catalogs: CatalogList = [ui, system, signals, charts, app, own, errors]
export default catalogs
