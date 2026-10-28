import { signal } from "@preact/signals"
import type { ToastStore } from "@spy4x/preact-signals/toast"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  type AdminCatalogResponse,
  CATALOG_PHOTO_MAX_BYTES,
  CATALOG_PHOTO_TYPES,
  CATALOG_PHOTOS_MAX,
  type CatalogCategory,
  CatalogError,
  type CatalogItem,
  type CatalogPhoto,
  catalogPhotoContentType,
  type CatalogText,
  parseCatalogCategoryFields,
} from "@domain/catalog"
import {
  ADMIN_CATALOG_NO_FILTER,
  type AdminCatalogFilter,
  type CatalogCategoryDraft,
  type CatalogFormErrors,
} from "@ui/admin-catalog.tsx"
import {
  type CatalogItemDraft,
  catalogItemDraft,
  catalogItemFields,
  type CatalogPhotosState,
  sameCatalogItemDraft,
} from "@ui/admin-catalog-item.tsx"
import { type AdminFetch, post } from "../../state.ts"

const API = `/api/admin/catalog`

/** How many times an open item is read again while a photo is being prepared: a minute's worth. */
export const CATALOG_PREPARING_READS = 30

/** The item editor: which item it has open (`null` for a new one) and what its fields hold. */
export interface CatalogItemEditorState {
  id: string | null
  /** The item as saved, once read. */
  item: CatalogItem | null
  loading: boolean
  notFound: boolean
  value: CatalogItemDraft
  errors: CatalogFormErrors
  saving: boolean
  photos: CatalogPhotosState
}

/** The category editor. */
export interface CatalogCategoryEditorState {
  id: string | null
  value: CatalogCategoryDraft
  errors: CatalogFormErrors
  saving: boolean
}

const BLANK_CATEGORY: CatalogCategoryDraft = { name: {}, slug: ``, slugEdited: false }

function categoryDraft(category: CatalogCategory | null): CatalogCategoryDraft {
  return category
    ? { name: { ...category.name }, slug: category.slug, slugEdited: true }
    : BLANK_CATEGORY
}

const NO_PHOTO_WORK: CatalogPhotosState = { uploading: 0, busy: false, error: null }

/**
 * The catalog module's state (#466): the catalog's lists, the item editor with its photos, and the
 * category editor. Every call goes through the app's `request`, which signs the app out on a 401.
 * A save checks the fields with the API's own rules first, so a wrong value is named under its
 * field; a refusal of the API's own shows under the form, on its field when it names one. After
 * every write the lists are read again.
 */
export function createCatalogState(
  request: AdminFetch,
  toasts: ToastStore,
  newId: () => string = uuidV7,
) {
  const catalog = signal<AdminCatalogResponse | null>(null)
  const error = signal<string | null>(null)
  const busy = signal(false)
  /** The list's search and chips, kept while the operator opens an item and comes back. */
  const listFilter = signal<AdminCatalogFilter>(ADMIN_CATALOG_NO_FILTER)
  const itemEditor = signal<CatalogItemEditorState>(blankItem(null))
  const categoryEditor = signal<CatalogCategoryEditorState>({
    id: null,
    value: BLANK_CATEGORY,
    errors: {},
    saving: false,
  })
  let preparingReads = 0

  function blankItem(id: string | null): CatalogItemEditorState {
    return {
      id,
      item: null,
      loading: id !== null,
      notFound: false,
      value: catalogItemDraft(null),
      errors: {},
      saving: false,
      photos: NO_PHOTO_WORK,
    }
  }

  const languages = () => catalog.value?.settings.languages ?? []
  const toast = (body: string) => toasts.success({ body, dataE2E: `catalog-toast` })
  /** The errors of a refusal: on its field when it names one, else under the form. */
  const refusalErrors = (result: { error: { message: string; details?: unknown } }) => {
    const field = (result.error.details as { field?: string } | undefined)?.field
    return { [field ?? `form`]: result.error.message }
  }
  /** Applies `patch` to the item editor when it still has `id` open. */
  const patchItem = (id: string | null, patch: Partial<CatalogItemEditorState>) => {
    if (itemEditor.value.id === id) itemEditor.value = { ...itemEditor.value, ...patch }
  }

  const state = {
    catalog,
    listFilter,
    error,
    busy,
    itemEditor,
    categoryEditor,

    async load(): Promise<void> {
      const result = await request<AdminCatalogResponse>(API)
      if (result.ok) {
        catalog.value = result.data
        error.value = null
      } else error.value = result.error.message
    },

    // #region Items

    /** Opens the editor on item `id`, or on a new item when it is `null`, and reads the item. */
    async openItem(id: string | null): Promise<void> {
      preparingReads = 0
      itemEditor.value = blankItem(id)
      if (catalog.value === null) await state.load()
      if (id !== null) await state.readItem(id)
    },

    /** Reads the open item again; the fields follow it unless they hold unsaved changes. */
    async readItem(id: string): Promise<void> {
      const result = await request<{ item: CatalogItem }>(`${API}/items/${id}`)
      const open = itemEditor.value
      if (open.id !== id) return
      if (!result.ok) {
        patchItem(id, { loading: false, notFound: result.status === 404 })
        if (result.status !== 404) patchItem(id, { errors: { form: result.error.message } })
        return
      }
      const unsaved = open.item !== null && state.itemUnsaved()
      patchItem(id, {
        item: result.data.item,
        loading: false,
        notFound: false,
        value: unsaved ? open.value : catalogItemDraft(result.data.item),
      })
    },

    /**
     * Reads the open item again while one of its photos is being prepared, at most
     * {@link CATALOG_PREPARING_READS} times. Answers whether it read.
     */
    async readWhilePreparing(): Promise<boolean> {
      const { id, item } = itemEditor.value
      const preparing = item?.photos.some((photo) => photo.state === `preparing`)
      if (id === null || !preparing || preparingReads >= CATALOG_PREPARING_READS) return false
      preparingReads++
      await state.readItem(id)
      return true
    },

    editItem(value: CatalogItemDraft): void {
      itemEditor.value = { ...itemEditor.value, value }
    },

    /** Whether the fields hold something not saved, for the guard that asks before leaving. */
    itemUnsaved(): boolean {
      const { value, item, saving } = itemEditor.value
      return !saving && !sameCatalogItemDraft(value, catalogItemDraft(item))
    },

    /** Adds or saves the item. Answers its id once saved, else `null`. */
    async saveItem(): Promise<string | null> {
      const open = itemEditor.value
      if (open.saving) return null
      const checked = catalogItemFields(open.value, languages())
      if (!checked.ok) {
        itemEditor.value = { ...open, errors: { [checked.field]: checked.message } }
        return null
      }
      itemEditor.value = { ...open, errors: {}, saving: true }
      const id = open.item?.id ?? newId()
      const result = open.item
        ? await request<{ item: CatalogItem }>(
          `${API}/items/${id}`,
          post({ ...checked.fields, version: open.item.version }),
        )
        : await request<{ item: CatalogItem }>(`${API}/items`, post({ id, ...checked.fields }))
      if (!result.ok) {
        patchItem(open.id, { saving: false, errors: refusalErrors(result) })
        return null
      }
      itemEditor.value = {
        ...itemEditor.value,
        id,
        item: result.data.item,
        value: catalogItemDraft(result.data.item),
        saving: false,
      }
      void state.load()
      toast(open.item ? `Item saved.` : `Draft saved. Add its photos, then publish it.`)
      return id
    },

    /** Saves unsaved changes, then publishes the item. Answers whether it went through. */
    async publish(): Promise<boolean> {
      if (state.itemUnsaved() && await state.saveItem() === null) return false
      return await state.setStatus(`published`, `Published. The website shows it within a minute.`)
    },

    hide(): Promise<boolean> {
      return state.setStatus(`hidden`, `Hidden. The website stops showing it within a minute.`)
    },

    async setStatus(status: `published` | `hidden`, done: string): Promise<boolean> {
      const open = itemEditor.value
      if (!open.item || open.saving) return false
      patchItem(open.id, { saving: true, errors: {} })
      const result = await request<{ item: CatalogItem }>(
        `${API}/items/${open.item.id}/status`,
        post({ version: open.item.version, status }),
      )
      if (!result.ok) {
        patchItem(open.id, { saving: false, errors: refusalErrors(result) })
        return false
      }
      patchItem(open.id, {
        saving: false,
        item: result.data.item,
        value: catalogItemDraft(result.data.item),
      })
      void state.load()
      toast(done)
      return true
    },

    /** Deletes the open item. Answers whether it went through. */
    async deleteItem(): Promise<boolean> {
      const open = itemEditor.value
      if (!open.item || open.saving) return false
      patchItem(open.id, { saving: true, errors: {} })
      const result = await request(
        `${API}/items/${open.item.id}/delete`,
        post({ version: open.item.version }),
      )
      if (!result.ok) {
        patchItem(open.id, { saving: false, errors: refusalErrors(result) })
        return false
      }
      itemEditor.value = blankItem(null)
      await state.load()
      toast(`Item deleted.`)
      return true
    },

    // #endregion

    // #region Photos

    /**
     * Uploads `files` to the open item one after another, in the order chosen. A file of a type,
     * size or count the catalog does not take is refused in words before any upload.
     */
    async upload(files: readonly File[]): Promise<void> {
      const { item } = itemEditor.value
      if (!item) return
      const room = Math.max(
        0,
        CATALOG_PHOTOS_MAX - item.photos.length - itemEditor.value.photos.uploading,
      )
      const problems: string[] = []
      const take: File[] = []
      for (const file of files) {
        const type = catalogPhotoContentType(file)
        if (!(CATALOG_PHOTO_TYPES as readonly string[]).includes(type)) {
          problems.push(`${file.name} is not a JPEG, PNG, WebP or HEIC photo.`)
        } else if (file.size > CATALOG_PHOTO_MAX_BYTES) {
          problems.push(`${file.name} is larger than ${CATALOG_PHOTO_MAX_BYTES / 1024 / 1024} MB.`)
        } else if (take.length >= room) {
          problems.push(
            `${file.name} was left out: an item keeps ${CATALOG_PHOTOS_MAX} photos at most.`,
          )
        } else take.push(file)
      }
      const setPhotos = (patch: Partial<CatalogPhotosState>) =>
        patchItem(item.id, { photos: { ...itemEditor.value.photos, ...patch } })
      setPhotos({ uploading: itemEditor.value.photos.uploading + take.length, error: null })
      for (const file of take) {
        const result = await request<{ photo: CatalogPhoto }>(
          `${API}/items/${item.id}/photos?id=${newId()}`,
          {
            method: `POST`,
            headers: { "content-type": catalogPhotoContentType(file) },
            body: file,
          },
        )
        if (!result.ok) problems.push(`${file.name}: ${result.error.message}`)
        setPhotos({ uploading: Math.max(0, itemEditor.value.photos.uploading - 1) })
      }
      setPhotos({ error: problems.length > 0 ? problems.join(` `) : null })
      preparingReads = 0
      await state.readItem(item.id)
      void state.load()
      if (take.length > problems.length) {
        toast(take.length === 1 ? `Photo added.` : `Photos added.`)
      }
    },

    /** One photo write, then the item again; a refusal shows above the photos. */
    async photoWrite(path: string, body: unknown, done?: string): Promise<boolean> {
      const { item, photos } = itemEditor.value
      if (!item || photos.busy) return false
      patchItem(item.id, { photos: { ...photos, busy: true, error: null } })
      const result = await request(`${API}/items/${item.id}/photos${path}`, post(body))
      await state.readItem(item.id)
      patchItem(item.id, {
        photos: {
          ...itemEditor.value.photos,
          busy: false,
          error: result.ok ? null : result.error.message,
        },
      })
      if (result.ok && done) toast(done)
      void state.load()
      return result.ok
    },

    /** Moves the photo at `from` to `to`; the first is the cover. */
    movePhoto(from: number, to: number): Promise<boolean> {
      const ids = itemEditor.value.item?.photos.map((photo) => photo.id) ?? []
      if (from === to || !ids[from] || to < 0 || to >= ids.length) return Promise.resolve(false)
      const [moved] = ids.splice(from, 1)
      ids.splice(to, 0, moved)
      return state.photoWrite(`/order`, { ids }, to === 0 ? `Cover changed.` : undefined)
    },

    savePhoto(photoId: string, change: { alt: CatalogText; colourId: string | null }) {
      return state.photoWrite(`/${photoId}`, change, `Photo saved.`)
    },

    removePhoto(photoId: string): Promise<boolean> {
      return state.photoWrite(`/${photoId}/delete`, undefined, `Photo removed.`)
    },

    // #endregion

    // #region Categories

    /** The category with `id`, once the catalog is read. */
    findCategory(id: string): CatalogCategory | null {
      return catalog.value?.categories.find((category) => category.id === id) ?? null
    },

    /** Opens the category editor on `id`, or on a new category when it is `null`. */
    openCategory(id: string | null): void {
      categoryEditor.value = {
        id,
        value: categoryDraft(id === null ? null : state.findCategory(id)),
        errors: {},
        saving: false,
      }
    },

    editCategory(value: CatalogCategoryDraft): void {
      categoryEditor.value = { ...categoryEditor.value, value }
    },

    categoryUnsaved(): boolean {
      const { id, value, saving } = categoryEditor.value
      if (saving) return false
      const saved = categoryDraft(id === null ? null : state.findCategory(id))
      return JSON.stringify([value.name, value.slug]) !== JSON.stringify([saved.name, saved.slug])
    },

    /** Adds or saves the category. Answers whether it went through. */
    async saveCategory(): Promise<boolean> {
      const open = categoryEditor.value
      if (open.saving) return false
      const body = { name: open.value.name, slug: open.value.slug }
      try {
        parseCatalogCategoryFields(body, languages())
      } catch (refusal) {
        if (!(refusal instanceof CatalogError)) throw refusal
        categoryEditor.value = { ...open, errors: { [refusal.field ?? `form`]: refusal.message } }
        return false
      }
      categoryEditor.value = { ...open, errors: {}, saving: true }
      const category = open.id === null ? null : state.findCategory(open.id)
      const id = category?.id ?? newId()
      const result = category
        ? await request(`${API}/categories/${id}`, post({ ...body, version: category.version }))
        : await request(`${API}/categories`, post({ id, ...body }))
      if (!result.ok) {
        categoryEditor.value = {
          ...categoryEditor.value,
          saving: false,
          errors: refusalErrors(result),
        }
        return false
      }
      await state.load()
      state.openCategory(id)
      toast(category ? `Category saved.` : `Category added.`)
      return true
    },

    /** Moves the category one place up or down. */
    async moveCategory(id: string, by: -1 | 1): Promise<void> {
      const list = catalog.value?.categories
      const from = list?.findIndex((category) => category.id === id) ?? -1
      if (!list || from < 0 || busy.value) return
      const to = from + by
      if (to < 0 || to >= list.length) return
      const ids = list.map((category) => category.id)
      ;[ids[from], ids[to]] = [ids[to], ids[from]]
      await state.write(`${API}/categories/order`, { ids })
    },

    deleteCategory(category: CatalogCategory): Promise<boolean> {
      return state.write(
        `${API}/categories/${category.id}/delete`,
        { version: category.version },
        `Category deleted.`,
      )
    },

    /** One move or deletion, then the lists again; a refusal shows above the list. */
    async write(path: string, body: unknown, done?: string): Promise<boolean> {
      if (busy.value) return false
      busy.value = true
      const result = await request(path, post(body))
      if (result.ok && done) toast(done)
      await state.load()
      if (!result.ok) error.value = result.error.message
      busy.value = false
      return result.ok
    },
    // #endregion
  }
  return state
}

export type CatalogState = ReturnType<typeof createCatalogState>
