/** The admin app's catalogs in pt-BR, in the order of `ENGLISH` in `../i18n.ts`: one chunk of the build. */
import ui from "@spy4x/preact-ui/i18n/pt-BR"
import system from "@spy4x/preact-system/i18n/pt-BR"
import signals from "@spy4x/preact-signals/i18n/pt-BR"
import charts from "@spy4x/preact-charts/i18n/pt-BR"
import own from "@i18n/admin/pt-BR.json" with { type: "json" }
import errors from "@i18n/errors/pt-BR.json" with { type: "json" }
import type { CatalogList } from "@platform/i18n.ts"

const catalogs: CatalogList = [ui, system, signals, charts, own, errors]
export default catalogs
