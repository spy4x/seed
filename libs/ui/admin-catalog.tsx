import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { formatMoney } from "@spy4x/platform/universal/money"
import { slugify } from "@spy4x/platform/universal/text"
import { IconEllipsisVertical, IconImage, IconPlus } from "@spy4x/preact-icons"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { Dropdown, DropdownItem } from "@spy4x/preact-ui/dropdown"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Link } from "@spy4x/preact-ui/link"
import { Stack } from "@spy4x/preact-ui/layout"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { PageAction, PageHeader } from "@spy4x/preact-ui/page-header"
import {
  type AdminCatalogResponse,
  CATALOG_NAME_MAX_LENGTH,
  CATALOG_SLUG_MAX_LENGTH,
  type CatalogCategory,
  type CatalogItemRow,
  type CatalogItemStatus,
  catalogLanguageName,
  type CatalogSettings,
  type CatalogStock,
  type CatalogText,
  catalogText,
} from "@domain/catalog"
import { ListCard, ListEmpty, MENU_TRIGGER_CLASSES } from "./notes-screen.tsx"
import { type Navigate, ScreenForm } from "./progressive.tsx"

/** The catalog module's pages in the admin app, and the one file address its pages load. */
export const ADMIN_CATALOG_PATHS = {
  list: `/catalog`,
  create: `/catalog/new`,
  item: (id: string) => `/catalog/${encodeURIComponent(id)}`,
  categories: `/catalog/categories`,
  categoryCreate: `/catalog/categories/new`,
  category: (id: string) => `/catalog/categories/${encodeURIComponent(id)}`,
  /** A photo's narrowest width, served by the API on this host (`img-src 'self'`). */
  thumbnail: (photoId: string) =>
    `/api/admin/catalog/photos/${encodeURIComponent(photoId)}/thumbnail`,
} as const

/** The list's message when it could not be read, whatever the cause. */
export const ADMIN_CATALOG_ERROR = `The catalog could not be loaded. Try again in a moment.`

const STATUS_BADGES: Record<CatalogItemStatus, { text: string; color: `green` | `gray` }> = {
  draft: { text: `Draft`, color: `gray` },
  published: { text: `On the website`, color: `green` },
  hidden: { text: `Hidden`, color: `gray` },
}

/** An item's status as a pill: draft, on the website or hidden. */
export function CatalogStatusBadge({ status }: { status: CatalogItemStatus }): JSX.Element {
  const badge = STATUS_BADGES[status]
  return <Badge text={badge.text} color={badge.color} type="outline" />
}

const STOCK_WORDS: Record<CatalogStock, string | null> = {
  "in-stock": null,
  "some-sold-out": `Some sold out`,
  "sold-out": `Sold out`,
}

/** The catalog's settings in one line: `Prices in VND · Texts in Tiếng Việt and English`. */
export function catalogSettingsLine(settings: CatalogSettings): string {
  const names = settings.languages.map(catalogLanguageName)
  const languages = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(`, `)} and ${names.at(-1)}`
  return `Prices in ${settings.currency} · Texts in ${languages}`
}

/** A photo's thumbnail, or a placeholder for an item without one. */
export function CatalogThumbnail(
  { photoId, alt = ``, size = `size-12` }: { photoId: string | null; alt?: string; size?: string },
): JSX.Element {
  return photoId
    ? (
      <img
        src={ADMIN_CATALOG_PATHS.thumbnail(photoId)}
        alt={alt}
        loading="lazy"
        class={`${size} shrink-0 rounded-md border border-subtle bg-track object-cover`}
      />
    )
    : (
      <span
        class={`${size} inline-flex shrink-0 items-center justify-center rounded-md border border-subtle bg-track text-muted`}
        aria-hidden="true"
      >
        <IconImage class="size-5" />
      </span>
    )
}

export interface AdminCatalogScreenProps {
  /** The catalog, or `null` while it loads or when it failed. */
  catalog: AdminCatalogResponse | null
  error: string | null
  onRetry: () => void
  navigate?: Navigate
}

/**
 * The catalog (#466): every item, newest change first, with its cover, category, price, stock and
 * status. "Add item" is the page's one action; an item's name opens its editor. The categories
 * are a page of their own, reached from the menu, and the empty state sends a new catalog there
 * first, since an item goes live only in a category.
 */
export function AdminCatalogScreen(props: AdminCatalogScreenProps): JSX.Element {
  const { catalog, navigate } = props
  const categories = new Map(catalog?.categories.map((category) => [category.id, category]))
  const languages = catalog?.settings.languages ?? []
  return (
    <div class="flex flex-col gap-8">
      <PageHeader
        title="Catalog"
        subtitle={catalog
          ? catalogSettingsLine(catalog.settings)
          : `What the website's shop shows.`}
        titleDataE2E="catalog-title"
        action={
          <PageAction
            label="Add item"
            Icon={IconPlus}
            href={ADMIN_CATALOG_PATHS.create}
            navigate={navigate}
            dataE2E="catalog-new"
          />
        }
        menu={
          <DropdownItem
            href={ADMIN_CATALOG_PATHS.categories}
            navigate={navigate}
            dataE2E="catalog-categories"
          >
            Categories
          </DropdownItem>
        }
        menuDataE2E="catalog-menu"
      />
      <Stack>
        {props.error && (
          <div class="flex flex-col items-center gap-3" data-e2e="catalog-error">
            <ErrorState message={catalog ? props.error : ADMIN_CATALOG_ERROR} />
            {!catalog && <Button variant="secondary" onClick={props.onRetry}>Try again</Button>}
          </div>
        )}
        {catalog === null
          ? !props.error && (
            <div role="status" aria-label="Loading the catalog">
              <LoadingSkeleton rows={4} />
            </div>
          )
          : catalog.items.length === 0
          ? catalog.categories.length === 0
            ? (
              <ListEmpty
                title="Start with a category"
                description="Every item on the website sits in a category, such as T-shirts or Hoodies. Add one, then add items to it."
                action={
                  <Button
                    href={ADMIN_CATALOG_PATHS.categoryCreate}
                    navigate={navigate}
                    variant="outline"
                  >
                    Add category
                  </Button>
                }
              />
            )
            : (
              <ListEmpty
                title="No items yet"
                description="Add an item with its photos, colours and sizes. It stays a draft until you publish it."
                action={
                  <Button href={ADMIN_CATALOG_PATHS.create} navigate={navigate} variant="outline">
                    Add item
                  </Button>
                }
              />
            )
          : (
            <ListCard dataE2E="catalog-list">
              {catalog.items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  category={item.categoryId ? categories.get(item.categoryId) ?? null : null}
                  currency={catalog.settings.currency}
                  languages={languages}
                  navigate={navigate}
                />
              ))}
            </ListCard>
          )}
      </Stack>
    </div>
  )
}

function ItemRow(
  { item, category, currency, languages, navigate }: {
    item: CatalogItemRow
    category: CatalogCategory | null
    currency: string
    languages: readonly string[]
    navigate?: Navigate
  },
): JSX.Element {
  const name = catalogText(item.name, languages)
  const stock = STOCK_WORDS[item.stock]
  return (
    <li class="flex min-h-16 items-center gap-3 px-4 py-3 sm:px-6" data-e2e="catalog-row">
      <CatalogThumbnail photoId={item.coverId} />
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <Link
          href={ADMIN_CATALOG_PATHS.item(item.id)}
          navigate={navigate}
          class="pc-link line-clamp-2 font-medium wrap-anywhere"
          data-e2e="catalog-edit"
        >
          {name}
        </Link>
        <span class="text-sm text-muted wrap-anywhere">
          {[
            category ? catalogText(category.name, languages) : `No category`,
            formatMoney(item.price, currency),
            item.photoCount === 1 ? `1 photo` : `${item.photoCount} photos`,
          ].join(` · `)}
          {stock && <span class="text-danger">{` · ${stock}`}</span>}
        </span>
      </div>
      <div class="shrink-0">
        <CatalogStatusBadge status={item.status} />
      </div>
    </li>
  )
}

// #region Categories

export interface AdminCatalogCategoriesScreenProps {
  /** The categories in order, or `null` while they load or when they failed. */
  categories: readonly CatalogCategory[] | null
  languages: readonly string[]
  error: string | null
  /** A move or deletion is on its way; the menus wait for it. */
  busy: boolean
  onRetry: () => void
  onMove: (id: string, by: -1 | 1) => void
  onDelete: (category: CatalogCategory) => void
  navigate?: Navigate
}

const CATEGORIES_BACK = { href: ADMIN_CATALOG_PATHS.list, label: `Back to the catalog` }

/**
 * The catalog's categories, in the order the website shows them. "Add category" is the page's one
 * action; a category's name opens its editor, and its menu moves it or deletes it behind a
 * confirmation. A category that still holds items says so instead of offering to delete it.
 */
export function AdminCatalogCategoriesScreen(
  props: AdminCatalogCategoriesScreenProps,
): JSX.Element {
  const { categories, languages, navigate } = props
  const [deleting, setDeleting] = useState<CatalogCategory | null>(null)
  const [focusOn, setFocusOn] = useState<{ id: string; index: number } | null>(null)
  const page = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focusOn || props.busy || !categories) return
    const menus = page.current?.querySelectorAll<HTMLElement>(`[data-e2e=catalog-category-menu]`)
    const at = categories.findIndex((category) => category.id === focusOn.id)
    const target = at >= 0 ? menus?.[at] : menus?.[focusOn.index] ?? menus?.[focusOn.index - 1] ??
      page.current?.querySelector<HTMLElement>(`[data-e2e=catalog-category-new]`)
    target?.focus()
    setFocusOn(null)
  }, [focusOn, categories, props.busy])
  const nameOf = (category: CatalogCategory) => catalogText(category.name, languages)

  return (
    <div ref={page} class="flex flex-col gap-8">
      <PageHeader
        back={CATEGORIES_BACK}
        navigate={navigate}
        title="Categories"
        subtitle="The website shows its items in these groups, in this order."
        titleDataE2E="catalog-categories-title"
        action={
          <PageAction
            label="Add category"
            Icon={IconPlus}
            href={ADMIN_CATALOG_PATHS.categoryCreate}
            navigate={navigate}
            dataE2E="catalog-category-new"
          />
        }
      />
      <Stack>
        {props.error && (
          <div class="flex flex-col items-center gap-3" data-e2e="catalog-categories-error">
            <ErrorState message={categories ? props.error : ADMIN_CATALOG_ERROR} />
            {!categories && <Button variant="secondary" onClick={props.onRetry}>Try again</Button>}
          </div>
        )}
        {categories === null
          ? !props.error && (
            <div role="status" aria-label="Loading the categories">
              <LoadingSkeleton rows={3} />
            </div>
          )
          : categories.length === 0
          ? (
            <ListEmpty
              title="No categories yet"
              description="Add the groups your items go in, such as T-shirts, Hoodies or Accessories."
              action={
                <Button
                  href={ADMIN_CATALOG_PATHS.categoryCreate}
                  navigate={navigate}
                  variant="outline"
                >
                  Add category
                </Button>
              }
            />
          )
          : (
            <ListCard dataE2E="catalog-category-list">
              {categories.map((category, index) => (
                <li
                  key={category.id}
                  class="flex min-h-14 items-center gap-3 px-4 py-3 sm:px-6"
                  data-e2e="catalog-category-row"
                >
                  <div class="flex min-w-0 flex-1 flex-col gap-1">
                    <Link
                      href={ADMIN_CATALOG_PATHS.category(category.id)}
                      navigate={navigate}
                      class="pc-link line-clamp-2 font-medium wrap-anywhere"
                      data-e2e="catalog-category-edit"
                    >
                      {nameOf(category)}
                    </Link>
                    <span class="text-sm text-muted wrap-anywhere">
                      /{category.slug} ·{" "}
                      {category.itemCount === 1 ? `1 item` : `${category.itemCount} items`}
                    </span>
                  </div>
                  <div class="relative -my-2 -mr-2 shrink-0">
                    <Dropdown
                      trigger={<IconEllipsisVertical class="size-5" />}
                      triggerLabel={`Actions for ${nameOf(category)}`}
                      triggerClasses={MENU_TRIGGER_CLASSES}
                      triggerDataE2E="catalog-category-menu"
                    >
                      <DropdownItem
                        href={ADMIN_CATALOG_PATHS.category(category.id)}
                        navigate={navigate}
                      >
                        Edit category
                      </DropdownItem>
                      {index > 0 && (
                        <DropdownItem
                          disabled={props.busy}
                          dataE2E="catalog-category-up"
                          onClick={() => {
                            setFocusOn({ id: category.id, index })
                            props.onMove(category.id, -1)
                          }}
                        >
                          Move up
                        </DropdownItem>
                      )}
                      {index < categories.length - 1 && (
                        <DropdownItem
                          disabled={props.busy}
                          dataE2E="catalog-category-down"
                          onClick={() => {
                            setFocusOn({ id: category.id, index })
                            props.onMove(category.id, 1)
                          }}
                        >
                          Move down
                        </DropdownItem>
                      )}
                      <DropdownItem
                        danger
                        disabled={props.busy || category.itemCount > 0}
                        dataE2E="catalog-category-delete"
                        onClick={() => setDeleting(category)}
                      >
                        {category.itemCount > 0 ? `Move its items to delete it` : `Delete category`}
                      </DropdownItem>
                    </Dropdown>
                  </div>
                </li>
              ))}
            </ListCard>
          )}
      </Stack>
      {deleting && categories && (
        <ConfirmDialog
          title={`Delete "${nameOf(deleting)}"?`}
          message="It holds no items. The website stops showing it."
          confirmLabel="Delete category"
          cancelLabel="Cancel"
          tone="danger"
          dataE2E="catalog-category-delete-dialog"
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const index = categories.findIndex((one) => one.id === deleting.id)
            setDeleting(null)
            setFocusOn({ id: deleting.id, index })
            props.onDelete(deleting)
          }}
        />
      )}
    </div>
  )
}

/** What the category editor's fields hold: the name per language as typed, and the slug. */
export interface CatalogCategoryDraft {
  name: CatalogText
  slug: string
  /** Whether the operator typed the slug; until then it follows the default name. */
  slugEdited: boolean
}

/** The category editor's errors, by field: `slug`, `name:<language>`, and `form`. */
export type CatalogFormErrors = Partial<Record<string, string>>

export interface AdminCatalogCategoryEditorScreenProps {
  /** The category as saved, or `null` on the create page. */
  category: CatalogCategory | null
  languages: readonly string[]
  loading: boolean
  notFound: boolean
  value: CatalogCategoryDraft
  onChange: (value: CatalogCategoryDraft) => void
  errors: CatalogFormErrors
  saving: boolean
  onSave: () => void
  navigate?: Navigate
}

const CATEGORY_BACK = { href: ADMIN_CATALOG_PATHS.categories, label: `Back to categories` }

/** The id of a field of the catalog's forms, for its label and for focus. */
export function catalogFieldId(field: string): string {
  return `catalog-${field.replace(/[^a-zA-Z0-9-]/g, `-`)}`
}

/**
 * One category on a page of its own: its name in every language the catalog keeps, the default
 * first and required, and its address on the website, which follows the name until typed. A
 * refused field gets focus.
 */
export function AdminCatalogCategoryEditorScreen(
  props: AdminCatalogCategoryEditorScreenProps,
): JSX.Element {
  const { category, languages, value, errors, navigate } = props
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const first = [...languages.map((language) => `name:${language}`), `slug`]
      .find((field) => errors[field])
    if (first) root.current?.querySelector<HTMLElement>(`#${catalogFieldId(first)}`)?.focus()
  }, [errors])

  if (props.notFound || (props.loading && !category)) {
    return (
      <Stack gap="xl">
        <PageHeader back={CATEGORY_BACK} navigate={navigate} title="Category" />
        {props.notFound
          ? (
            <div data-e2e="catalog-category-not-found">
              <ListEmpty
                title="This category does not exist"
                description="It may have been deleted."
                action={
                  <Button href={CATEGORY_BACK.href} navigate={navigate} variant="outline">
                    Back to categories
                  </Button>
                }
              />
            </div>
          )
          : (
            <div role="status" aria-label="Loading the category">
              <LoadingSkeleton rows={2} class="max-w-md" />
            </div>
          )}
      </Stack>
    )
  }

  const setName = (language: string, text: string) => {
    const name = { ...value.name, [language]: text }
    const slug = value.slugEdited || language !== languages[0]
      ? value.slug
      : slugify(text).slice(0, CATALOG_SLUG_MAX_LENGTH)
    props.onChange({ ...value, name, slug })
  }
  return (
    <div ref={root}>
      <Stack gap="xl">
        <PageHeader
          back={CATEGORY_BACK}
          navigate={navigate}
          title={category ? catalogText(category.name, languages) : `New category`}
          titleDataE2E="catalog-category-title"
        />
        <ScreenForm pending={props.saving} onSubmit={props.onSave}>
          <Stack class="max-w-md">
            {languages.map((language, index) => (
              <Field
                key={language}
                id={catalogFieldId(`name:${language}`)}
                label={languages.length === 1
                  ? `Name`
                  : `Name in ${catalogLanguageName(language)}${index === 0 ? `` : ` (optional)`}`}
                hint={index === 0 && languages.length > 1
                  ? `Shown when a text has no translation.`
                  : undefined}
                error={errors[`name:${language}`]}
                required={index === 0}
              >
                <Input
                  name={`name-${language}`}
                  lang={language}
                  data-e2e="catalog-category-name"
                  autocomplete="off"
                  maxLength={CATALOG_NAME_MAX_LENGTH}
                  value={value.name[language] ?? ``}
                  onInput={(event) => setName(language, event.currentTarget.value)}
                  required={index === 0}
                />
              </Field>
            ))}
            <Field
              id={catalogFieldId(`slug`)}
              label="Address"
              hint="Part of the website's address: lowercase letters, digits and hyphens."
              error={errors.slug}
              required
            >
              <Input
                name="slug"
                data-e2e="catalog-category-slug"
                autocomplete="off"
                maxLength={CATALOG_SLUG_MAX_LENGTH}
                value={value.slug}
                onInput={(event) =>
                  props.onChange({ ...value, slug: event.currentTarget.value, slugEdited: true })}
                required
              />
            </Field>
            <ErrorState message={errors.form ?? null} />
            <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                href={CATEGORY_BACK.href}
                navigate={navigate}
                variant="ghost"
                class="min-h-11 w-full sm:min-h-9 sm:w-auto"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                data-e2e="catalog-category-save"
                busy={props.saving}
                busyLabel="Saving…"
              >
                {category ? `Save category` : `Add category`}
              </Button>
            </div>
          </Stack>
        </ScreenForm>
      </Stack>
    </div>
  )
}
