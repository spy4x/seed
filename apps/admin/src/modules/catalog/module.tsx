import type { JSX } from "preact"
import { useEffect } from "preact/hooks"
import { useLocation } from "wouter-preact"
import { IconPackage } from "@spy4x/preact-icons"
import { UnsavedGuard } from "@spy4x/preact-ui/unsaved-guard"
import {
  ADMIN_CATALOG_PATHS,
  AdminCatalogCategoriesScreen,
  AdminCatalogCategoryEditorScreen,
  AdminCatalogScreen,
} from "@ui/admin-catalog.tsx"
import { AdminCatalogItemScreen } from "@ui/admin-catalog-item.tsx"
import type { AdminContext, AdminModule } from "../types.ts"
import { type CatalogState, createCatalogState } from "./state.ts"

/** One state per signed-in session: a new session starts with nothing read. */
const states = new WeakMap<AdminContext, CatalogState>()

function catalogState(context: AdminContext): CatalogState {
  let state = states.get(context)
  if (!state) {
    state = createCatalogState(context.request, context.toasts)
    states.set(context, state)
  }
  return state
}

/** How long the item page waits before reading a photo that is being prepared again. */
const PREPARING_POLL_MS = 2000

function CatalogView({ context }: { context: AdminContext }): JSX.Element {
  const state = catalogState(context)
  useEffect(() => {
    void state.load()
  }, [context])
  return (
    <AdminCatalogScreen
      catalog={state.catalog.value}
      error={state.error.value}
      onRetry={() => void state.load()}
      filter={state.listFilter.value}
      onFilter={(filter) => (state.listFilter.value = filter)}
      navigate={context.navigate}
    />
  )
}

/** Asks before leaving a page with unsaved changes, in the page's own words. */
function Guard(
  { context, when, message }: { context: AdminContext; when: boolean; message: string },
): JSX.Element {
  const [, go] = useLocation()
  return (
    <UnsavedGuard
      when={when}
      owns={(url) => url.origin === globalThis.location?.origin}
      navigate={go}
      leaveGuard={context.leaveGuard}
      labels={{
        title: `Leave without saving?`,
        message,
        leave: `Leave`,
        stay: `Keep editing`,
      }}
    />
  )
}

/** The item editor, on `/catalog/new` and `/catalog/:id`. The first save moves to the item's page. */
function ItemView(
  { context, params }: { context: AdminContext; params: Record<string, string> },
): JSX.Element {
  const state = catalogState(context)
  const id = params.id === `new` ? null : params.id
  // The router's own navigate: after a save or deletion nothing unsaved is left to ask about.
  const [, go] = useLocation()
  const editor = state.itemEditor.value
  useEffect(() => {
    // The first save of a new item opens its own address, with the editor already on it.
    if (id !== null && editor.id === id && editor.item) return
    void state.openItem(id)
  }, [id, context])
  // A photo being prepared shows once the worker is done: the item is read again until then.
  useEffect(() => {
    if (!editor.item?.photos.some((photo) => photo.state === `preparing`)) return
    const timer = setTimeout(() => void state.readWhilePreparing(), PREPARING_POLL_MS)
    return () => clearTimeout(timer)
  }, [editor.item])
  const catalog = state.catalog.value
  return (
    <>
      <AdminCatalogItemScreen
        item={editor.item}
        settings={catalog?.settings ?? { currency: `USD`, languages: [`en`] }}
        categories={catalog?.categories ?? []}
        loading={editor.loading || catalog === null}
        notFound={editor.notFound}
        value={editor.value}
        onChange={state.editItem}
        errors={editor.errors}
        saving={editor.saving}
        onSave={async () => {
          const saved = await state.saveItem()
          if (saved && id === null) go(ADMIN_CATALOG_PATHS.item(saved), { replace: true })
        }}
        onPublish={() => void state.publish()}
        onHide={() => void state.hide()}
        onDelete={async () => {
          if (await state.deleteItem()) go(ADMIN_CATALOG_PATHS.list)
        }}
        photos={editor.photos}
        onUpload={(files) => void state.upload(files)}
        onPhotoMove={(from, to) => void state.movePhoto(from, to)}
        onPhotoSave={(photoId, change) => void state.savePhoto(photoId, change)}
        onPhotoRemove={(photoId) => void state.removePhoto(photoId)}
        navigate={context.navigate}
      />
      <Guard
        context={context}
        when={state.itemUnsaved()}
        message="Your changes to this item are lost."
      />
    </>
  )
}

function CategoriesView({ context }: { context: AdminContext }): JSX.Element {
  const state = catalogState(context)
  useEffect(() => {
    void state.load()
  }, [context])
  const catalog = state.catalog.value
  return (
    <AdminCatalogCategoriesScreen
      categories={catalog?.categories ?? null}
      languages={catalog?.settings.languages ?? []}
      error={state.error.value}
      busy={state.busy.value}
      onRetry={() => void state.load()}
      onMove={(categoryId, by) => void state.moveCategory(categoryId, by)}
      onDelete={(category) => void state.deleteCategory(category)}
      navigate={context.navigate}
    />
  )
}

/** The category editor, on `/catalog/categories/new` and `/catalog/categories/:id`. */
function CategoryView(
  { context, params }: { context: AdminContext; params: Record<string, string> },
): JSX.Element {
  const state = catalogState(context)
  const id = params.id === `new` ? null : params.id
  const [, go] = useLocation()
  useEffect(() => {
    state.openCategory(id)
    if (id !== null && !state.findCategory(id)) void state.load().then(() => state.openCategory(id))
    else if (state.catalog.value === null) void state.load()
  }, [id, context])
  const editor = state.categoryEditor.value
  const catalog = state.catalog.value
  const category = id === null ? null : state.findCategory(id)
  return (
    <>
      <AdminCatalogCategoryEditorScreen
        category={category}
        languages={catalog?.settings.languages ?? [`en`]}
        loading={catalog === null}
        notFound={id !== null && catalog !== null && category === null}
        value={editor.value}
        onChange={state.editCategory}
        errors={editor.errors}
        saving={editor.saving}
        onSave={async () => {
          if (await state.saveCategory()) go(ADMIN_CATALOG_PATHS.categories)
        }}
        navigate={context.navigate}
      />
      <Guard
        context={context}
        when={state.categoryUnsaved()}
        message="Your changes to this category are lost."
      />
    </>
  )
}

/**
 * The shop's catalog (#466): items with photos, colours and sizes, and their categories. Shown
 * only while the API has it on (`CATALOG=true`).
 */
export const catalogModule: AdminModule = {
  id: `catalog`,
  optional: true,
  nav: { name: `Catalog`, href: ADMIN_CATALOG_PATHS.list, Icon: IconPackage },
  routes: [
    { path: ADMIN_CATALOG_PATHS.list, View: CatalogView },
    { path: ADMIN_CATALOG_PATHS.categories, View: CategoriesView },
    { path: `/catalog/categories/:id`, View: CategoryView },
    { path: `/catalog/:id`, View: ItemView },
  ],
}
