import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { formatMoney } from "@spy4x/platform/universal/money"
import { search, searchWords, slugify } from "@spy4x/platform/universal/text"
import { IconEllipsisVertical, IconImage, IconPlus } from "@spy4x/preact-icons"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { Dropdown, DropdownItem } from "@spy4x/preact-ui/dropdown"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Link } from "@spy4x/preact-ui/link"
import { Stack } from "@spy4x/preact-ui/layout"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { PageAction, PageHeader } from "@spy4x/preact-ui/page-header"
import { ToggleChips } from "@spy4x/preact-ui/toggle-chips"
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
import { useAdminText } from "./i18n.ts"
import { type Navigate, ScreenForm } from "./progressive.tsx"
import type { Translator } from "@spy4x/platform/universal/i18n"

/** The catalog module's pages in the admin app, and the one file address its pages load. */
export const ADMIN_CATALOG_PATHS = {
  list: `/catalog`,
  create: `/catalog/new`,
  item: (id: string) => `/catalog/${encodeURIComponent(id)}`,
  categories: `/catalog/categories`,
  categoryCreate: `/catalog/categories/new`,
  category: (id: string) => `/catalog/categories/${encodeURIComponent(id)}`,
  sources: `/catalog/sources`,
  sourceCreate: `/catalog/sources/new`,
  source: (id: string) => `/catalog/sources/${encodeURIComponent(id)}`,
  /** A photo's narrowest width, served by the API on this host (`img-src 'self'`). */
  thumbnail: (photoId: string) =>
    `/api/admin/catalog/photos/${encodeURIComponent(photoId)}/thumbnail`,
  /** A photo's widest width, for the lightbox. */
  full: (photoId: string) => `/api/admin/catalog/photos/${encodeURIComponent(photoId)}/full`,
} as const

const STATUS_BADGES: Record<CatalogItemStatus, { text: string; color: `green` | `gray` }> = {
  draft: { text: `AdminCatalog.draft`, color: `gray` },
  published: { text: `AdminCatalog.published`, color: `green` },
  hidden: { text: `AdminCatalog.hidden`, color: `gray` },
}

/** An item's status as a pill: draft, on the website or hidden. */
export function CatalogStatusBadge({ status }: { status: CatalogItemStatus }): JSX.Element {
  const t = useAdminText()
  const badge = STATUS_BADGES[status]
  return <Badge text={t.t(badge.text)} color={badge.color} type="outline" />
}

const STOCK_WORDS: Record<CatalogStock, string | null> = {
  "in-stock": null,
  "some-sold-out": `AdminCatalog.someSoldOut`,
  "sold-out": `AdminCatalog.soldOut`,
}

/** The catalog's settings in one line: `Prices in VND · Texts in Tiếng Việt and English`. */
export function catalogSettingsLine(t: Translator<string>, settings: CatalogSettings): string {
  const languages = new Intl.ListFormat(t.language, { type: `conjunction` })
    .format(settings.languages.map(catalogLanguageName))
  return t.t(`AdminCatalog.settings`, { currency: settings.currency, languages })
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

/** What the list shows: one status or every item, only items with something sold out, and a search. */
export interface AdminCatalogFilter {
  status: CatalogItemStatus | null
  soldOut: boolean
  query: string
}

export const ADMIN_CATALOG_NO_FILTER: AdminCatalogFilter = {
  status: null,
  soldOut: false,
  query: ``,
}

/** The longest search the list's box takes. */
export const ADMIN_CATALOG_SEARCH_MAX_LENGTH = 100

const STATUS_CHIPS: { value: CatalogItemStatus | `all`; label: string }[] = [
  { value: `all`, label: `AdminCatalog.chipAll` },
  { value: `draft`, label: `AdminCatalog.chipDraft` },
  { value: `published`, label: `AdminCatalog.chipPublished` },
  { value: `hidden`, label: `AdminCatalog.chipHidden` },
]

/** The items a filter shows, and the counts of its chips. */
export interface CatalogListView {
  items: CatalogItemRow[]
  /** Each status chip's count, and "Sold-out sizes"'s, under the other filters. */
  counts: Record<CatalogItemStatus | `all` | `soldOut`, number>
}

/**
 * Filters the catalog's items: every word of the search must occur, accents and case ignored, in
 * the item's name in any language, its address or its category's name. A status chip's count
 * follows the search and the sold-out filter; the sold-out count follows the search and the status.
 */
export function filterCatalogItems(
  catalog: AdminCatalogResponse,
  filter: AdminCatalogFilter,
): CatalogListView {
  const categories = new Map(catalog.categories.map((category) => [category.id, category]))
  const words = searchWords(filter.query)
  const found = catalog.items.filter((item) => {
    const category = item.categoryId ? categories.get(item.categoryId) : undefined
    const values = [
      ...Object.values(item.name),
      item.slug,
      ...Object.values(category?.name ?? {}),
    ]
    return words.every((word) => values.some((value) => search(value, word)))
  })
  const soldOut = (item: CatalogItemRow) => item.stock !== `in-stock`
  const ofStatus = (item: CatalogItemRow) => filter.status === null || item.status === filter.status
  const forChips = filter.soldOut ? found.filter(soldOut) : found
  return {
    items: forChips.filter(ofStatus),
    counts: {
      all: forChips.length,
      draft: forChips.filter((item) => item.status === `draft`).length,
      published: forChips.filter((item) => item.status === `published`).length,
      hidden: forChips.filter((item) => item.status === `hidden`).length,
      soldOut: found.filter(ofStatus).filter(soldOut).length,
    },
  }
}

export interface AdminCatalogScreenProps {
  /** The catalog, or `null` while it loads or when it failed. */
  catalog: AdminCatalogResponse | null
  error: string | null
  onRetry: () => void
  filter: AdminCatalogFilter
  onFilter: (filter: AdminCatalogFilter) => void
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
  const t = useAdminText()
  return (
    <div class="flex flex-col gap-8">
      <PageHeader
        title={t.t(`AdminCatalog.title`)}
        subtitle={catalog ? catalogSettingsLine(t, catalog.settings) : t.t(`AdminCatalog.subtitle`)}
        titleDataE2E="catalog-title"
        action={
          <PageAction
            label={t.t(`AdminCatalog.addItem`)}
            Icon={IconPlus}
            href={ADMIN_CATALOG_PATHS.create}
            navigate={navigate}
            dataE2E="catalog-new"
          />
        }
        menu={
          <>
            <DropdownItem
              href={ADMIN_CATALOG_PATHS.categories}
              navigate={navigate}
              dataE2E="catalog-categories"
            >
              {t.t(`AdminCatalog.categories`)}
            </DropdownItem>
            <DropdownItem
              href={ADMIN_CATALOG_PATHS.sources}
              navigate={navigate}
              dataE2E="catalog-sources"
            >
              {t.t(`AdminCatalog.sources`)}
            </DropdownItem>
          </>
        }
        menuDataE2E="catalog-menu"
      />
      <Stack>
        {props.error && (
          <div class="flex flex-col items-center gap-3" data-e2e="catalog-error">
            <ErrorState message={catalog ? props.error : t.t(`AdminCatalog.error`)} />
            {!catalog && (
              <Button variant="secondary" onClick={props.onRetry}>
                {t.t(`AdminCatalog.retry`)}
              </Button>
            )}
          </div>
        )}
        {catalog === null
          ? !props.error && (
            <div role="status" aria-label={t.t(`AdminCatalog.loading`)}>
              <LoadingSkeleton rows={4} />
            </div>
          )
          : catalog.items.length === 0
          ? catalog.categories.length === 0
            ? (
              <ListEmpty
                title={t.t(`AdminCatalog.startTitle`)}
                description={t.t(`AdminCatalog.startText`)}
                action={
                  <Button
                    href={ADMIN_CATALOG_PATHS.categoryCreate}
                    navigate={navigate}
                    variant="outline"
                  >
                    {t.t(`AdminCatalog.addCategory`)}
                  </Button>
                }
              />
            )
            : (
              <ListEmpty
                title={t.t(`AdminCatalog.emptyTitle`)}
                description={t.t(`AdminCatalog.emptyText`)}
                action={
                  <Button href={ADMIN_CATALOG_PATHS.create} navigate={navigate} variant="outline">
                    {t.t(`AdminCatalog.addItem`)}
                  </Button>
                }
              />
            )
          : (
            <CatalogList
              catalog={catalog}
              filter={props.filter}
              onFilter={props.onFilter}
              navigate={navigate}
            />
          )}
      </Stack>
    </div>
  )
}

/** The search, the chips and the rows of a catalog that has items. */
function CatalogList(
  { catalog, filter, onFilter, navigate }: {
    catalog: AdminCatalogResponse
    filter: AdminCatalogFilter
    onFilter: (filter: AdminCatalogFilter) => void
    navigate?: Navigate
  },
): JSX.Element {
  const categories = new Map(catalog.categories.map((category) => [category.id, category]))
  const languages = catalog.settings.languages
  const view = filterCatalogItems(catalog, filter)
  const filtered = filter.query !== `` || filter.status !== null || filter.soldOut
  const t = useAdminText()
  const count = t.t(`AdminCatalog.count`, { count: view.items.length })
  return (
    <>
      <div class="flex flex-col gap-3" role="search" data-e2e="catalog-filters">
        <div class="max-w-md">
          <Field id="catalog-q" label={t.t(`AdminCatalog.search`)}>
            <Input
              type="search"
              data-e2e="catalog-search"
              value={filter.query}
              maxLength={ADMIN_CATALOG_SEARCH_MAX_LENGTH}
              autocomplete="off"
              onInput={(event) => onFilter({ ...filter, query: event.currentTarget.value })}
            />
          </Field>
        </div>
        {/* One row that scrolls sideways on a phone rather than wrapping. */}
        <div class="-mx-4 flex max-w-[calc(100%+2rem)] items-center gap-4 overflow-x-auto px-4 sm:mx-0 sm:max-w-full sm:flex-wrap sm:px-0">
          <div data-e2e="catalog-status">
            <ToggleChips
              mode="single"
              label={t.t(`AdminCatalog.status`)}
              class="flex-nowrap sm:flex-wrap"
              options={STATUS_CHIPS.map((chip) => ({
                value: chip.value,
                label: t.t(chip.label, { count: view.counts[chip.value] }),
              }))}
              value={filter.status ?? `all`}
              onChange={(value) =>
                onFilter({
                  ...filter,
                  status: value === null || value === `all` ? null : value as CatalogItemStatus,
                })}
            />
          </div>
          <div data-e2e="catalog-sold-out">
            <ToggleChips
              label={t.t(`AdminCatalog.stock`)}
              options={[{
                value: `soldOut`,
                label: t.t(`AdminCatalog.chipSoldOut`, { count: view.counts.soldOut }),
              }]}
              value={filter.soldOut ? [`soldOut`] : []}
              onChange={(value) => onFilter({ ...filter, soldOut: value.length > 0 })}
            />
          </div>
        </div>
      </div>
      <h2 class="text-sm text-muted" aria-live="polite" data-e2e="catalog-count">{count}</h2>
      {view.items.length === 0
        ? (
          <Card data-e2e="catalog-nothing">
            <EmptyState
              inset
              title={t.t(`AdminCatalog.nothingTitle`)}
              description={t.t(`AdminCatalog.nothingText`)}
              action={filtered && (
                <Button
                  variant="ghost"
                  data-e2e="catalog-clear"
                  onClick={() => onFilter(ADMIN_CATALOG_NO_FILTER)}
                >
                  {t.t(`AdminCatalog.clearFilters`)}
                </Button>
              )}
            />
          </Card>
        )
        : (
          <ListCard dataE2E="catalog-list">
            {view.items.map((item) => (
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
    </>
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
  const t = useAdminText()
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
          <bdi translate={false}>{name}</bdi>
        </Link>
        <span class="text-sm text-muted wrap-anywhere">
          {category
            ? <bdi translate={false}>{catalogText(category.name, languages)}</bdi>
            : t.t(`AdminCatalog.noCategory`)}
          {` · ${formatMoney(item.price, currency)} · `}
          {t.t(`AdminCatalog.photos`, { count: item.photoCount })}
          {stock && <span class="text-danger">{` · ${t.t(stock)}`}</span>}
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
  const t = useAdminText()
  const nameOf = (category: CatalogCategory) => catalogText(category.name, languages)

  return (
    <div ref={page} class="flex flex-col gap-8">
      <PageHeader
        back={{ href: ADMIN_CATALOG_PATHS.list, label: t.t(`AdminCatalogCategories.back`) }}
        navigate={navigate}
        title={t.t(`AdminCatalogCategories.title`)}
        subtitle={t.t(`AdminCatalogCategories.subtitle`)}
        titleDataE2E="catalog-categories-title"
        action={
          <PageAction
            label={t.t(`AdminCatalog.addCategory`)}
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
            <ErrorState message={categories ? props.error : t.t(`AdminCatalog.error`)} />
            {!categories && (
              <Button variant="secondary" onClick={props.onRetry}>
                {t.t(`AdminCatalog.retry`)}
              </Button>
            )}
          </div>
        )}
        {categories === null
          ? !props.error && (
            <div role="status" aria-label={t.t(`AdminCatalogCategories.loading`)}>
              <LoadingSkeleton rows={3} />
            </div>
          )
          : categories.length === 0
          ? (
            <ListEmpty
              title={t.t(`AdminCatalogCategories.emptyTitle`)}
              description={t.t(`AdminCatalogCategories.emptyText`)}
              action={
                <Button
                  href={ADMIN_CATALOG_PATHS.categoryCreate}
                  navigate={navigate}
                  variant="outline"
                >
                  {t.t(`AdminCatalog.addCategory`)}
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
                      <bdi translate={false}>{nameOf(category)}</bdi>
                    </Link>
                    <span class="text-sm text-muted wrap-anywhere">
                      <bdi translate={false}>/{category.slug}</bdi>
                      {` · ${t.t(`AdminCatalogCategories.items`, { count: category.itemCount })}`}
                    </span>
                  </div>
                  <div class="relative -my-2 -mr-2 shrink-0">
                    <Dropdown
                      trigger={<IconEllipsisVertical class="size-5" />}
                      triggerLabel={t.t(`AdminCatalogCategories.actionsFor`, {
                        name: nameOf(category),
                      })}
                      triggerClasses={MENU_TRIGGER_CLASSES}
                      triggerDataE2E="catalog-category-menu"
                    >
                      <DropdownItem
                        href={ADMIN_CATALOG_PATHS.category(category.id)}
                        navigate={navigate}
                      >
                        {t.t(`AdminCatalogCategories.edit`)}
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
                          {t.t(`AdminCatalogCategories.moveUp`)}
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
                          {t.t(`AdminCatalogCategories.moveDown`)}
                        </DropdownItem>
                      )}
                      <DropdownItem
                        danger
                        disabled={props.busy || category.itemCount > 0}
                        dataE2E="catalog-category-delete"
                        onClick={() => setDeleting(category)}
                      >
                        {t.t(
                          category.itemCount > 0
                            ? `AdminCatalogCategories.moveItemsFirst`
                            : `AdminCatalogCategories.delete`,
                        )}
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
          title={t.t(`AdminCatalogCategories.deleteTitle`, { name: nameOf(deleting) })}
          message={t.t(`AdminCatalogCategories.deleteText`)}
          confirmLabel={t.t(`AdminCatalogCategories.delete`)}
          cancelLabel={t.t(`AdminCatalogCategories.cancel`)}
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
  const t = useAdminText()
  const back = { href: ADMIN_CATALOG_PATHS.categories, label: t.t(`AdminCatalogCategory.back`) }
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const first = [...languages.map((language) => `name:${language}`), `slug`]
      .find((field) => errors[field])
    if (first) root.current?.querySelector<HTMLElement>(`#${catalogFieldId(first)}`)?.focus()
  }, [errors])

  if (props.notFound || (props.loading && !category)) {
    return (
      <Stack gap="xl">
        <PageHeader back={back} navigate={navigate} title={t.t(`AdminCatalogCategory.title`)} />
        {props.notFound
          ? (
            <div data-e2e="catalog-category-not-found">
              <ListEmpty
                title={t.t(`AdminCatalogCategory.notFound`)}
                description={t.t(`AdminCatalogCategory.notFoundText`)}
                action={
                  <Button href={back.href} navigate={navigate} variant="outline">
                    {back.label}
                  </Button>
                }
              />
            </div>
          )
          : (
            <div role="status" aria-label={t.t(`AdminCatalogCategory.loading`)}>
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
          back={back}
          navigate={navigate}
          title={category
            ? catalogText(category.name, languages)
            : t.t(`AdminCatalogCategory.newTitle`)}
          titleDataE2E="catalog-category-title"
        />
        <ScreenForm pending={props.saving} onSubmit={props.onSave}>
          <Stack class="max-w-md">
            {languages.map((language, index) => (
              <Field
                key={language}
                id={catalogFieldId(`name:${language}`)}
                label={languages.length === 1 ? t.t(`AdminCatalogCategory.name`) : t.t(
                  index === 0
                    ? `AdminCatalogCategory.nameIn`
                    : `AdminCatalogCategory.nameInOptional`,
                  { language: catalogLanguageName(language) },
                )}
                hint={index === 0 && languages.length > 1
                  ? t.t(`AdminCatalogCategory.nameHint`)
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
              label={t.t(`AdminCatalogCategory.slug`)}
              hint={t.t(`AdminCatalogCategory.slugHint`)}
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
                href={back.href}
                navigate={navigate}
                variant="ghost"
                class="min-h-11 w-full sm:min-h-9 sm:w-auto"
              >
                {t.t(`AdminCatalogCategory.cancel`)}
              </Button>
              <Button
                type="submit"
                class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                data-e2e="catalog-category-save"
                busy={props.saving}
                busyLabel={t.t(`AdminCatalogCategory.saving`)}
              >
                {t.t(category ? `AdminCatalogCategory.save` : `AdminCatalogCategory.add`)}
              </Button>
            </div>
          </Stack>
        </ScreenForm>
      </Stack>
    </div>
  )
}
