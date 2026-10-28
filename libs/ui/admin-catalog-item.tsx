// deno-lint-ignore-file ui-text/no-literal
import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { formatMoney } from "@spy4x/platform/universal/money"
import { slugify } from "@spy4x/platform/universal/text"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  IconCopy,
  IconEllipsisVertical,
  IconGlobe,
  IconPlus,
  IconTrashBin,
} from "@spy4x/preact-icons"
import { Button } from "@spy4x/preact-ui/button"
import { Card, CardBody, CardHeader } from "@spy4x/preact-ui/card"
import { Checkbox } from "@spy4x/preact-ui/checkbox"
import { ColorField, type ColorPreset } from "@spy4x/preact-ui/color-field"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { Dropdown, DropdownItem } from "@spy4x/preact-ui/dropdown"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { FileInput } from "@spy4x/preact-ui/file-input"
import { Input, Select, Textarea } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { Modal } from "@spy4x/preact-ui/modal"
import { MoneyInput } from "@spy4x/preact-ui/money-input"
import { PageAction, PageHeader } from "@spy4x/preact-ui/page-header"
import { SortableList } from "@spy4x/preact-ui/sortable-list"
import { Tabs } from "@spy4x/preact-ui/tabs"
import {
  CATALOG_ALT_MAX_LENGTH,
  CATALOG_COLOUR_NAME_MAX_LENGTH,
  CATALOG_COLOURS_MAX,
  CATALOG_DESCRIPTION_MAX_LENGTH,
  CATALOG_DETAIL_MAX_LENGTH,
  CATALOG_HEIGHT_MAX_CM,
  CATALOG_NAME_MAX_LENGTH,
  CATALOG_PHOTO_MAX_BYTES,
  CATALOG_PHOTO_TYPES,
  CATALOG_PHOTOS_MAX,
  CATALOG_PRICE_MAX,
  CATALOG_SIZE_LABEL_MAX_LENGTH,
  CATALOG_SIZES_MAX,
  CATALOG_SLUG_MAX_LENGTH,
  CATALOG_WEIGHT_MAX_KG,
  type CatalogCategory,
  catalogCombinationKey,
  catalogCombinations,
  CatalogError,
  type CatalogItem,
  type CatalogItemFields,
  catalogLanguageName,
  type CatalogLinkSource,
  type CatalogPhoto,
  type CatalogRange,
  type CatalogSettings,
  type CatalogText,
  catalogText,
  parseCatalogItemFields,
} from "@domain/catalog"
import {
  ADMIN_CATALOG_PATHS,
  catalogFieldId,
  type CatalogFormErrors,
  CatalogStatusBadge,
  CatalogThumbnail,
} from "./admin-catalog.tsx"
import { ListEmpty, MENU_TRIGGER_CLASSES } from "./notes-screen.tsx"
import { type Navigate, ScreenForm } from "./progressive.tsx"

// #region Draft

/** One colour as its fields hold it. */
export interface CatalogColourDraft {
  id: string
  name: CatalogText
  swatch: string
}

/** One size as its fields hold it: the ranges as typed, empty for none. */
export interface CatalogSizeDraft {
  id: string
  label: string
  heightMin: string
  heightMax: string
  weightMin: string
  weightMax: string
}

/** What the item editor's fields hold, as typed. */
export interface CatalogItemDraft {
  name: CatalogText
  description: CatalogText
  material: CatalogText
  fit: CatalogText
  care: CatalogText
  slug: string
  /** Whether the operator typed the slug; until then it follows the default name. */
  slugEdited: boolean
  /** `` for none. */
  categoryId: string
  price: number | null
  colours: CatalogColourDraft[]
  sizes: CatalogSizeDraft[]
  /** The sold-out combinations' keys (`catalogCombinationKey`). */
  soldOut: string[]
}

const rangeText = (range: CatalogRange | null, end: `min` | `max`) =>
  range ? String(range[end]) : ``

/** The fields of `item`, or of a new item when it is `null`. */
export function catalogItemDraft(item: CatalogItem | null): CatalogItemDraft {
  return {
    name: { ...item?.name },
    description: { ...item?.description },
    material: { ...item?.material },
    fit: { ...item?.fit },
    care: { ...item?.care },
    slug: item?.slug ?? ``,
    slugEdited: item !== null,
    categoryId: item?.categoryId ?? ``,
    price: item?.price ?? null,
    colours: item?.colours.map((colour) => ({ ...colour, name: { ...colour.name } })) ?? [],
    sizes: item?.sizes.map((size) => ({
      id: size.id,
      label: size.label,
      heightMin: rangeText(size.heightCm, `min`),
      heightMax: rangeText(size.heightCm, `max`),
      weightMin: rangeText(size.weightKg, `min`),
      weightMax: rangeText(size.weightKg, `max`),
    })) ?? [],
    soldOut: item?.soldOut.map(catalogCombinationKey) ?? [],
  }
}

/** Whether two drafts hold the same item, whatever the slug's origin. */
export function sameCatalogItemDraft(a: CatalogItemDraft, b: CatalogItemDraft): boolean {
  const plain = ({ slugEdited: _, ...rest }: CatalogItemDraft) => JSON.stringify(rest)
  return plain(a) === plain(b)
}

/** A range typed in two fields: `null` for two empty ones, else whole numbers or a refusal. */
function rangeOf(min: string, max: string, field: string, noun: string): CatalogRange | null {
  if (min.trim() === `` && max.trim() === ``) return null
  const [low, high] = [min, max].map((text) => Number(text.trim()))
  if (min.trim() === `` || max.trim() === ``) {
    throw new CatalogError(`INVALID_REQUEST`, `Enter both ends of the ${noun}, or neither.`, field)
  }
  if (!Number.isInteger(low) || !Number.isInteger(high)) {
    throw new CatalogError(`INVALID_REQUEST`, `Enter the ${noun} in whole numbers.`, field)
  }
  return { min: low, max: high }
}

/**
 * The draft checked with the API's own rules: the fields to send, or the field a refusal names
 * and its message, so the editor shows it before any request.
 */
export function catalogItemFields(
  draft: CatalogItemDraft,
  languages: readonly string[],
): { ok: true; fields: CatalogItemFields } | { ok: false; field: string; message: string } {
  try {
    if (draft.price === null) {
      throw new CatalogError(`INVALID_REQUEST`, `Enter the price.`, `price`)
    }
    const sizes = draft.sizes.map((size) => ({
      id: size.id,
      label: size.label,
      heightCm: rangeOf(size.heightMin, size.heightMax, `size:${size.id}`, `height`),
      weightKg: rangeOf(size.weightMin, size.weightMax, `size:${size.id}`, `weight`),
    }))
    const sold = new Set(draft.soldOut)
    const fields = parseCatalogItemFields({
      slug: draft.slug,
      categoryId: draft.categoryId || null,
      name: draft.name,
      description: draft.description,
      material: draft.material,
      fit: draft.fit,
      care: draft.care,
      price: draft.price,
      colours: draft.colours,
      sizes,
      // A combination of a colour or size removed since it was marked is dropped, not refused.
      soldOut: catalogCombinations(draft.colours, sizes).filter((combination) =>
        sold.has(catalogCombinationKey(combination))
      ),
    }, languages)
    return { ok: true, fields }
  } catch (refusal) {
    if (!(refusal instanceof CatalogError)) throw refusal
    return { ok: false, field: refusal.field ?? `form`, message: refusal.message }
  }
}

// #endregion

// #region Screen

/** The photos' part of the editor: uploads on their way and the last refusal. */
export interface CatalogPhotosState {
  /** How many chosen photos are still uploading. */
  uploading: number
  /** A move, a save or a removal is on its way. */
  busy: boolean
  error: string | null
}

export interface AdminCatalogItemScreenProps {
  /** The item as saved, or `null` on the create page. */
  item: CatalogItem | null
  settings: CatalogSettings
  categories: readonly CatalogCategory[]
  loading: boolean
  notFound: boolean
  value: CatalogItemDraft
  onChange: (value: CatalogItemDraft) => void
  errors: CatalogFormErrors
  saving: boolean
  onSave: () => void
  /** Saves unsaved changes, then publishes. */
  onPublish: () => void
  onHide: () => void
  onDelete: () => void
  photos: CatalogPhotosState
  onUpload: (files: File[]) => void
  onPhotoMove: (from: number, to: number) => void
  onPhotoSave: (photoId: string, change: { alt: CatalogText; colourId: string | null }) => void
  onPhotoRemove: (photoId: string) => void
  /** The item's tracking links (#483); left out while items get none. */
  shareLinks?: CatalogShareLinksState
  navigate?: Navigate
}

/** What the item page's "Share links" card shows. */
export interface CatalogShareLinksState {
  sources: readonly CatalogLinkSource[]
  /** The short address of each source that has a link, by source id. */
  links: Readonly<Record<string, string>>
  /** The source whose link is being made and copied. */
  copying: string | null
  /** Makes the source's link when it has none, then copies it. */
  onCopy: (sourceId: string) => void
}

const BACK = { href: ADMIN_CATALOG_PATHS.list, label: `Back to the catalog` }

/** The fields in page order, so focus goes to the first refused one. */
function fieldOrder(draft: CatalogItemDraft, languages: readonly string[]): string[] {
  const texts = [`name`, `description`, `material`, `fit`, `care`]
  return [
    ...languages.flatMap((language) => texts.map((field) => `${field}:${language}`)),
    `slug`,
    `categoryId`,
    `price`,
    ...draft.colours.map((colour) => `colour:${colour.id}`),
    ...draft.sizes.map((size) => `size:${size.id}`),
    `soldOut`,
  ]
}

/**
 * One catalog item on a page of its own (#466), at `/catalog/new` and `/catalog/:id`. Its texts in
 * each language the catalog keeps, one tab per language; its address, category and price; its
 * colours with swatches; its sizes, each with an optional height and weight range for the size
 * calculator; what is sold out, colour by size; and, once saved, its photos: uploaded several at
 * once, dragged into order, the first being the cover. "Save" is the form's action; "Publish"
 * sits beside it until the item is on the website, and the menu hides or deletes it, each behind a
 * confirmation. A refused field gets focus, on its language's tab.
 */
export function AdminCatalogItemScreen(props: AdminCatalogItemScreenProps): JSX.Element {
  const { item, navigate } = props
  if (props.notFound || (props.loading && !item)) {
    return (
      <Stack gap="xl">
        <PageHeader back={BACK} navigate={navigate} title="Item" />
        {props.notFound
          ? (
            <div data-e2e="catalog-item-not-found">
              <ListEmpty
                title="This item does not exist"
                description="It may have been deleted."
                action={
                  <Button href={BACK.href} navigate={navigate} variant="outline">
                    Back to the catalog
                  </Button>
                }
              />
            </div>
          )
          : (
            <div role="status" aria-label="Loading the item">
              <LoadingSkeleton rows={6} />
            </div>
          )}
      </Stack>
    )
  }
  return <Editor {...props} />
}

/** The language tabs' ids: this, then the language. */
const LANGUAGE_TAB = `catalog-language-`

type Asking = `publish` | `hide` | `delete` | null

function Editor(props: AdminCatalogItemScreenProps): JSX.Element {
  const { item, settings, value, errors, navigate } = props
  const languages = settings.languages
  const [language, setLanguage] = useState(languages[0])
  const [asking, setAsking] = useState<Asking>(null)
  const root = useRef<HTMLDivElement>(null)
  const edit = (patch: Partial<CatalogItemDraft>) => props.onChange({ ...value, ...patch })

  // The first refused field gets focus, on its own language's tab.
  useEffect(() => {
    const first = fieldOrder(value, languages).find((field) => errors[field])
    if (!first) return
    const [, tag] = first.split(`:`)
    if (languages.includes(tag)) setLanguage(tag)
    setTimeout(() => root.current?.querySelector<HTMLElement>(`#${catalogFieldId(first)}`)?.focus())
  }, [errors])

  const setText = (field: `name` | `description` | `material` | `fit` | `care`, text: string) => {
    const patch: Partial<CatalogItemDraft> = { [field]: { ...value[field], [language]: text } }
    if (field === `name` && language === languages[0] && !value.slugEdited) {
      patch.slug = slugify(text).slice(0, CATALOG_SLUG_MAX_LENGTH)
    }
    edit(patch)
  }

  const status = item?.status ?? `draft`
  const title = item ? catalogText(item.name, languages) : `New item`
  const busy = props.saving
  const menu = item && (
    <>
      {status === `published` && (
        <DropdownItem onClick={() => setAsking(`hide`)} dataE2E="catalog-item-hide">
          Hide from the website…
        </DropdownItem>
      )}
      <DropdownItem danger onClick={() => setAsking(`delete`)} dataE2E="catalog-item-delete">
        Delete item…
      </DropdownItem>
    </>
  )
  const saveButton = (
    <Button
      type="submit"
      variant={status === `published` ? `primary` : `secondary`}
      class="min-h-11 flex-1 sm:min-h-9 sm:flex-none"
      busy={busy}
      busyLabel="Saving…"
      hotkey="mod+s"
      data-e2e="catalog-item-save"
    >
      {item ? `Save changes` : `Save draft`}
    </Button>
  )

  return (
    <div ref={root}>
      <ScreenForm pending={busy} onSubmit={props.onSave}>
        <Stack gap="xl">
          <PageHeader
            back={BACK}
            navigate={navigate}
            title={title}
            titleDataE2E="catalog-item-title"
            subtitle={<CatalogStatusBadge status={status} />}
            action={item && status !== `published`
              ? (
                <PageAction
                  label="Publish…"
                  Icon={IconGlobe}
                  disabled={busy}
                  onClick={() => setAsking(`publish`)}
                  dataE2E="catalog-item-publish"
                />
              )
              : undefined}
            menu={menu}
            menuDataE2E="catalog-item-menu"
          />

          <Card>
            <CardHeader title="Texts" headingLevel={2} />
            <CardBody>
              {languages.length === 1 ? <Texts {...{ props, language, setText }} /> : (
                <Tabs
                  label="Language"
                  lazy
                  active={`${LANGUAGE_TAB}${language}`}
                  onChange={(id) => setLanguage(id.slice(LANGUAGE_TAB.length))}
                  tabDataE2E="catalog-item-language"
                  tabs={languages.map((tag, index) => ({
                    id: `${LANGUAGE_TAB}${tag}`,
                    label: `${catalogLanguageName(tag)}${index === 0 ? ` (default)` : ``}`,
                    content: <Texts {...{ props, language: tag, setText }} />,
                  }))}
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Price and place" headingLevel={2} />
            <CardBody>
              <div class="grid gap-4 sm:grid-cols-3">
                <Field
                  id={catalogFieldId(`price`)}
                  label={`Price (${settings.currency})`}
                  hint={value.price === null
                    ? undefined
                    : `Shown as ${formatMoney(value.price, settings.currency)}`}
                  error={errors.price}
                  required
                >
                  <MoneyInput
                    id={catalogFieldId(`price`)}
                    name="price"
                    currency={settings.currency}
                    value={value.price}
                    min={0}
                    max={CATALOG_PRICE_MAX}
                    onChange={(price) => edit({ price })}
                    required
                  />
                </Field>
                <Field
                  id={catalogFieldId(`categoryId`)}
                  label="Category"
                  hint="An item goes on the website only in a category."
                  error={errors.categoryId}
                >
                  <Select
                    name="categoryId"
                    data-e2e="catalog-item-category"
                    value={value.categoryId}
                    options={[
                      { value: ``, label: `No category` },
                      ...props.categories.map((category) => ({
                        value: category.id,
                        label: catalogText(category.name, languages),
                      })),
                    ]}
                    onChange={(event) => edit({ categoryId: event.currentTarget.value })}
                  />
                </Field>
                <Field
                  id={catalogFieldId(`slug`)}
                  label="Address"
                  hint="Part of the website's address. It follows the name until you change it."
                  error={errors.slug}
                  required
                >
                  <Input
                    name="slug"
                    data-e2e="catalog-item-slug"
                    autocomplete="off"
                    maxLength={CATALOG_SLUG_MAX_LENGTH}
                    value={value.slug}
                    onInput={(event) => edit({ slug: event.currentTarget.value, slugEdited: true })}
                    required
                  />
                </Field>
              </div>
            </CardBody>
          </Card>

          <Colours {...{ props, edit }} />
          <Sizes {...{ props, edit }} />
          <Availability {...{ props, edit }} />
          {item ? <Photos {...props} item={item} /> : (
            <Card>
              <CardHeader title="Photos" headingLevel={2} />
              <CardBody>
                <p class="text-sm text-muted" data-e2e="catalog-item-photos-later">
                  Save the draft first, then add its photos here.
                </p>
              </CardBody>
            </Card>
          )}

          {item && props.shareLinks && (
            <ShareLinks
              state={props.shareLinks}
              published={status === `published`}
              {...{ navigate }}
            />
          )}

          <ErrorState message={errors.form ?? null} />
          <div
            class="flex gap-2 sm:justify-end"
            data-e2e="catalog-item-footer"
          >
            <Button
              href={BACK.href}
              navigate={navigate}
              variant="ghost"
              class="min-h-11 sm:min-h-9"
            >
              Cancel
            </Button>
            {saveButton}
          </div>
        </Stack>
      </ScreenForm>
      {asking === `publish` && item && (
        <ConfirmDialog
          title={`Publish "${title}"?`}
          message={value.categoryId
            ? `The website shows it in its category, with your changes saved first.`
            : `Pick a category first: the website shows items only in one.`}
          confirmLabel="Publish"
          cancelLabel="Cancel"
          dataE2E="catalog-item-publish-dialog"
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            setAsking(null)
            props.onPublish()
          }}
        />
      )}
      {asking === `hide` && (
        <ConfirmDialog
          title={`Hide "${title}"?`}
          message="The website stops showing it within a minute. You can publish it again."
          confirmLabel="Hide"
          cancelLabel="Cancel"
          dataE2E="catalog-item-hide-dialog"
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            setAsking(null)
            props.onHide()
          }}
        />
      )}
      {asking === `delete` && (
        <ConfirmDialog
          title={`Delete "${title}"?`}
          message="Its photos are deleted too. This cannot be undone."
          confirmLabel="Delete item"
          cancelLabel="Cancel"
          tone="danger"
          dataE2E="catalog-item-delete-dialog"
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            setAsking(null)
            props.onDelete()
          }}
        />
      )}
    </div>
  )
}

/**
 * One short link per source (#483): the first "Copy link" makes it, later presses copy the same
 * one. A source's row shows its link once it has one, so it can also be selected by hand.
 */
function ShareLinks(
  { state, published, navigate }: {
    state: CatalogShareLinksState
    published: boolean
    navigate?: Navigate
  },
): JSX.Element {
  return (
    <Card>
      <CardHeader
        title="Share links"
        headingLevel={2}
        action={state.sources.length > 0 && (
          <Button
            href={ADMIN_CATALOG_PATHS.sources}
            navigate={navigate}
            variant="ghost"
            class="min-h-11 sm:min-h-9"
            data-e2e="catalog-item-sources"
          >
            Edit sources
          </Button>
        )}
      />
      <CardBody>
        <Stack>
          <p class="text-sm text-muted">
            {state.sources.length === 0
              ? `Add the places you share items in, such as a Facebook group or a Zalo group. Each gets its own link to this item, so you see which brings visitors.`
              : `Share each place's own link, so you see which brings visitors.`}
            {!published && ` The links open the item once it is on the website.`}
          </p>
          {state.sources.length === 0
            ? (
              <div>
                <Button
                  href={ADMIN_CATALOG_PATHS.sourceCreate}
                  navigate={navigate}
                  variant="outline"
                  class="min-h-11 sm:min-h-9"
                  data-e2e="catalog-item-source-new"
                >
                  Add a source
                </Button>
              </div>
            )
            : (
              <ul
                class="-mx-4 divide-y divide-subtle border-y border-subtle sm:-mx-6"
                data-e2e="catalog-item-links"
              >
                {state.sources.map((source) => {
                  const link = state.links[source.id]
                  const copying = state.copying === source.id
                  return (
                    <li
                      key={source.id}
                      class="flex min-h-14 items-center gap-3 px-4 py-3 sm:px-6"
                      data-e2e="catalog-item-link"
                    >
                      <div class="flex min-w-0 flex-1 flex-col gap-1">
                        <span class="font-medium wrap-anywhere">{source.name}</span>
                        <span
                          class={`text-sm text-muted ${
                            link ? `break-all select-all` : `wrap-anywhere`
                          }`}
                          data-e2e="catalog-item-link-url"
                        >
                          {link ?? `No link yet · utm_source=${source.slug}`}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        class="min-h-11 shrink-0 sm:min-h-9"
                        aria-label={`Copy link for ${source.name}`}
                        busy={copying}
                        busyLabel="Copying…"
                        disabled={state.copying !== null && !copying}
                        onClick={() => state.onCopy(source.id)}
                        data-e2e="catalog-item-link-copy"
                      >
                        <IconCopy class="size-4" aria-hidden="true" />
                        Copy link
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
        </Stack>
      </CardBody>
    </Card>
  )
}

const TEXT_FIELDS = [
  { field: `description`, label: `Description`, max: CATALOG_DESCRIPTION_MAX_LENGTH, rows: 4 },
  { field: `material`, label: `Material`, max: CATALOG_DETAIL_MAX_LENGTH, rows: 1 },
  { field: `fit`, label: `Fit`, max: CATALOG_DETAIL_MAX_LENGTH, rows: 1 },
  { field: `care`, label: `Care`, max: CATALOG_DETAIL_MAX_LENGTH, rows: 1 },
] as const

/** The item's texts in one language. */
function Texts(
  { props, language, setText }: {
    props: AdminCatalogItemScreenProps
    language: string
    setText: (field: `name` | (typeof TEXT_FIELDS)[number][`field`], text: string) => void
  },
): JSX.Element {
  const { value, errors, settings } = props
  const main = language === settings.languages[0]
  return (
    <Stack>
      <Field
        id={catalogFieldId(`name:${language}`)}
        label={main ? `Name` : `Name (optional)`}
        hint={main && settings.languages.length > 1
          ? `Shown in every language that has no name of its own.`
          : undefined}
        error={errors[`name:${language}`]}
        required={main}
      >
        <Input
          name={`name-${language}`}
          lang={language}
          data-e2e="catalog-item-name"
          autocomplete="off"
          maxLength={CATALOG_NAME_MAX_LENGTH}
          value={value.name[language] ?? ``}
          onInput={(event) => setText(`name`, event.currentTarget.value)}
          required={main}
        />
      </Field>
      {TEXT_FIELDS.map(({ field, label, max, rows }) => (
        <Field
          key={field}
          id={catalogFieldId(`${field}:${language}`)}
          label={`${label} (optional)`}
          error={errors[`${field}:${language}`]}
        >
          {rows === 1
            ? (
              <Input
                name={`${field}-${language}`}
                lang={language}
                data-e2e={`catalog-item-${field}`}
                maxLength={max}
                value={value[field][language] ?? ``}
                onInput={(event) => setText(field, event.currentTarget.value)}
              />
            )
            : (
              <Textarea
                name={`${field}-${language}`}
                lang={language}
                rows={rows}
                data-e2e={`catalog-item-${field}`}
                maxLength={max}
                value={value[field][language] ?? ``}
                onInput={(event) => setText(field, event.currentTarget.value)}
              />
            )}
        </Field>
      ))}
    </Stack>
  )
}

type Edit = (patch: Partial<CatalogItemDraft>) => void

/** Focuses the first field of the row just added, once it is drawn. */
function useFocusAdded(): [(id: string) => void, (element: HTMLElement | null) => void] {
  const added = useRef<string | null>(null)
  return [
    (id) => {
      added.current = id
    },
    (element) => {
      if (element && element.dataset.row === added.current) {
        added.current = null
        element.querySelector<HTMLElement>(`input`)?.focus()
      }
    },
  ]
}

function Colours({ props, edit }: { props: AdminCatalogItemScreenProps; edit: Edit }) {
  const { value, errors, settings } = props
  const [markAdded, focusAdded] = useFocusAdded()
  const languages = settings.languages
  const setColour = (id: string, patch: Partial<CatalogColourDraft>) =>
    edit({
      colours: value.colours.map((colour) => colour.id === id ? { ...colour, ...patch } : colour),
    })
  return (
    <Card>
      <CardHeader
        title="Colours"
        headingLevel={2}
        action={value.colours.length < CATALOG_COLOURS_MAX && (
          <Button
            variant="secondary"
            size="sm"
            class="min-h-11 sm:min-h-0"
            data-e2e="catalog-item-add-colour"
            onClick={() => {
              const id = uuidV7()
              markAdded(id)
              edit({ colours: [...value.colours, { id, name: {}, swatch: `#1f2937` }] })
            }}
          >
            <IconPlus class="size-4" aria-hidden="true" /> Add colour
          </Button>
        )}
      />
      <CardBody>
        {value.colours.length === 0
          ? <p class="text-sm text-muted">One colour only? Leave this empty.</p>
          : (
            <ul class="flex flex-col divide-y divide-subtle">
              {value.colours.map((colour, index) => {
                const field = `colour:${colour.id}`
                const label = catalogText(colour.name, languages) || `Colour ${index + 1}`
                return (
                  <li
                    key={colour.id}
                    ref={focusAdded}
                    data-row={colour.id}
                    class="flex flex-col gap-3 py-4 first:pt-0 last:pb-0"
                    data-e2e="catalog-item-colour"
                  >
                    <div class="grid gap-3 sm:grid-cols-2">
                      {languages.map((language, at) => (
                        <Field
                          key={language}
                          id={at === 0
                            ? catalogFieldId(field)
                            : `${catalogFieldId(field)}-${language}`}
                          label={languages.length === 1
                            ? `Name`
                            : `Name in ${catalogLanguageName(language)}`}
                          required={at === 0}
                          error={at === 0 ? errors[field] : undefined}
                        >
                          <Input
                            lang={language}
                            data-e2e="catalog-item-colour-name"
                            autocomplete="off"
                            maxLength={CATALOG_COLOUR_NAME_MAX_LENGTH}
                            value={colour.name[language] ?? ``}
                            onInput={(event) =>
                              setColour(colour.id, {
                                name: { ...colour.name, [language]: event.currentTarget.value },
                              })}
                            required={at === 0}
                          />
                        </Field>
                      ))}
                    </div>
                    <div class="flex flex-wrap items-end justify-between gap-3">
                      <ColorField
                        legend="Swatch"
                        presets={CATALOG_SWATCHES}
                        value={colour.swatch}
                        onChange={(swatch) => setColour(colour.id, { swatch: swatch ?? `#000000` })}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        class="ml-auto min-h-11 sm:min-h-0"
                        data-e2e="catalog-item-remove-colour"
                        onClick={() =>
                          edit({ colours: value.colours.filter((one) => one.id !== colour.id) })}
                      >
                        <IconTrashBin class="size-4" aria-hidden="true" /> Remove {label}
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
      </CardBody>
    </Card>
  )
}

/** A checkbox's label as a 44px tap target on a phone, the box in its middle. */
const TAP_CLASS = `size-11 justify-center sm:size-auto`

/** A row menu's item: a 44px tap target on a phone. */
const MENU_ITEM_CLASS = `min-h-11 sm:min-h-0`

/** Garment colours a shop picks most, in one row; any other comes from the picker or a hex code. */
const CATALOG_SWATCHES: readonly ColorPreset[] = [
  { value: `#111827`, label: `Black` },
  { value: `#f9fafb`, label: `White` },
  { value: `#6b7280`, label: `Grey` },
  { value: `#1e3a5f`, label: `Navy` },
  { value: `#d8c7a3`, label: `Beige` },
  { value: `#7c4a2d`, label: `Brown` },
  { value: `#b91c1c`, label: `Red` },
  { value: `#2f5d3a`, label: `Green` },
]

function Sizes({ props, edit }: { props: AdminCatalogItemScreenProps; edit: Edit }) {
  const { value, errors } = props
  const [markAdded, focusAdded] = useFocusAdded()
  const setSize = (id: string, patch: Partial<CatalogSizeDraft>) =>
    edit({ sizes: value.sizes.map((size) => size.id === id ? { ...size, ...patch } : size) })
  const number = (
    size: CatalogSizeDraft,
    key: keyof CatalogSizeDraft,
    label: string,
    top: number,
  ) => (
    <label class="flex flex-col gap-1 text-sm">
      <span class="text-muted">{label}</span>
      <Input
        type="number"
        inputMode="numeric"
        min={1}
        max={top}
        step={1}
        class="w-full"
        data-e2e={`catalog-item-size-${key}`}
        value={size[key]}
        onInput={(event) => setSize(size.id, { [key]: event.currentTarget.value })}
      />
    </label>
  )
  return (
    <Card>
      <CardHeader
        title="Sizes"
        headingLevel={2}
        action={value.sizes.length < CATALOG_SIZES_MAX && (
          <Button
            variant="secondary"
            size="sm"
            class="min-h-11 sm:min-h-0"
            data-e2e="catalog-item-add-size"
            onClick={() => {
              const id = uuidV7()
              markAdded(id)
              edit({
                sizes: [...value.sizes, {
                  id,
                  label: ``,
                  heightMin: ``,
                  heightMax: ``,
                  weightMin: ``,
                  weightMax: ``,
                }],
              })
            }}
          >
            <IconPlus class="size-4" aria-hidden="true" /> Add size
          </Button>
        )}
      />
      <CardBody>
        <p class="mb-4 text-sm text-muted">
          Smallest first. Give a size the heights and weights it fits, and the website suggests a
          size from a shopper's height and weight.
        </p>
        {value.sizes.length > 0 && (
          <ul class="flex flex-col divide-y divide-subtle">
            {value.sizes.map((size, index) => {
              const field = `size:${size.id}`
              const label = size.label.trim() || `Size ${index + 1}`
              return (
                <li
                  key={size.id}
                  ref={focusAdded}
                  data-row={size.id}
                  class="flex flex-col gap-3 py-4 first:pt-0 last:pb-0"
                  data-e2e="catalog-item-size"
                >
                  <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <fieldset
                      class="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]"
                      aria-describedby={errors[field]
                        ? `${catalogFieldId(field)}-error`
                        : undefined}
                    >
                      <legend class="sr-only">{label}</legend>
                      <label class="col-span-2 flex flex-col gap-1 text-sm sm:col-span-1">
                        <span class="text-muted">Size</span>
                        <Input
                          id={catalogFieldId(field)}
                          data-e2e="catalog-item-size-label"
                          autocomplete="off"
                          maxLength={CATALOG_SIZE_LABEL_MAX_LENGTH}
                          value={size.label}
                          onInput={(event) =>
                            setSize(size.id, { label: event.currentTarget.value })}
                          required
                        />
                      </label>
                      {number(size, `heightMin`, `Height from, cm`, CATALOG_HEIGHT_MAX_CM)}
                      {number(size, `heightMax`, `Height to, cm`, CATALOG_HEIGHT_MAX_CM)}
                      {number(size, `weightMin`, `Weight from, kg`, CATALOG_WEIGHT_MAX_KG)}
                      {number(size, `weightMax`, `Weight to, kg`, CATALOG_WEIGHT_MAX_KG)}
                    </fieldset>
                    <Button
                      variant="ghost"
                      size="sm"
                      class="min-h-11 self-end sm:min-h-0"
                      data-e2e="catalog-item-remove-size"
                      onClick={() =>
                        edit({ sizes: value.sizes.filter((one) => one.id !== size.id) })}
                    >
                      <IconTrashBin class="size-4" aria-hidden="true" /> Remove {label}
                    </Button>
                  </div>
                  {errors[field] && (
                    <p id={`${catalogFieldId(field)}-error`} class="text-sm text-danger">
                      {errors[field]}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

/** What is in stock, colour by size: every box starts ticked, and an unticked one is sold out. */
function Availability({ props, edit }: { props: AdminCatalogItemScreenProps; edit: Edit }) {
  const { value, settings } = props
  const sold = new Set(value.soldOut)
  const colours = value.colours.length > 0 ? value.colours : [null]
  const sizes = value.sizes.length > 0 ? value.sizes : [null]
  const colourName = (colour: CatalogColourDraft | null) =>
    colour ? catalogText(colour.name, settings.languages) || `Unnamed colour` : `Every colour`
  const sizeName = (size: CatalogSizeDraft | null) =>
    size ? size.label || `Unnamed size` : `In stock`
  const toggle = (key: string, inStock: boolean) =>
    edit({
      soldOut: inStock ? value.soldOut.filter((one) => one !== key) : [...value.soldOut, key],
    })
  return (
    <Card>
      <CardHeader title="In stock" headingLevel={2} />
      <CardBody>
        <p class="mb-4 text-sm text-muted">
          Untick what is sold out. The website shows it, and an item with nothing left as sold out.
        </p>
        <div class="overflow-x-auto" id={catalogFieldId(`soldOut`)} tabIndex={-1}>
          <table class="text-sm" data-e2e="catalog-item-stock">
            <thead>
              <tr>
                <td />
                {sizes.map((size) => (
                  <th key={size?.id ?? `-`} scope="col" class="px-3 pb-2 text-left font-medium">
                    {sizeName(size)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {colours.map((colour) => (
                <tr key={colour?.id ?? `-`}>
                  <th scope="row" class="py-2 pr-3 text-left font-medium">
                    <span class="inline-flex items-center gap-2">
                      {colour && (
                        <span
                          class="size-4 rounded-full border border-subtle"
                          style={{ background: colour.swatch }}
                          aria-hidden="true"
                        />
                      )}
                      {colourName(colour)}
                    </span>
                  </th>
                  {sizes.map((size) => {
                    const key = catalogCombinationKey({
                      colourId: colour?.id ?? null,
                      sizeId: size?.id ?? null,
                    })
                    return (
                      <td key={key} class="p-0 sm:px-3 sm:py-2">
                        <Checkbox
                          labelClass={TAP_CLASS}
                          checked={!sold.has(key)}
                          aria-label={`${colourName(colour)}, ${sizeName(size)}: in stock`}
                          data-e2e="catalog-item-in-stock"
                          onChange={(event) => toggle(key, event.currentTarget.checked)}
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ErrorState message={props.errors.soldOut ?? null} />
      </CardBody>
    </Card>
  )
}

const PHOTO_STATE_WORDS: Record<CatalogPhoto[`state`], string | null> = {
  preparing: `Preparing…`,
  ready: null,
  refused: `This file could not be read as an image. Remove it and upload another.`,
}

/** The photos of a saved item: upload, order, cover, details and removal. */
function Photos(props: AdminCatalogItemScreenProps & { item: CatalogItem }): JSX.Element {
  const { item, photos, settings } = props
  const languages = settings.languages
  const [editing, setEditing] = useState<CatalogPhoto | null>(null)
  const [removing, setRemoving] = useState<CatalogPhoto | null>(null)
  const full = item.photos.length + photos.uploading >= CATALOG_PHOTOS_MAX
  const name = catalogText(item.name, languages)
  const colourName = (id: string | null) => {
    const colour = item.colours.find((one) => one.id === id)
    return colour ? catalogText(colour.name, languages) : null
  }
  const photoLabel = (photo: CatalogPhoto) =>
    `Photo ${item.photos.indexOf(photo) + 1}${item.photos[0] === photo ? `, the cover` : ``}`
  // After "Make cover", focus follows the photo to its new place, once the new order is drawn.
  const [focusOn, setFocusOn] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focusOn || photos.busy) return
    const at = item.photos.findIndex((photo) => photo.id === focusOn)
    if (at < 0) return setFocusOn(null)
    list.current?.querySelectorAll<HTMLElement>(`[data-e2e=catalog-item-photo-menu]`)[at]?.focus()
    setFocusOn(null)
  }, [focusOn, item.photos, photos.busy])
  return (
    <Card>
      <CardHeader
        title="Photos"
        headingLevel={2}
        action={!full && (
          <FileInput
            id="catalog-item-photos"
            appearance="button"
            multiple
            accept={CATALOG_PHOTO_TYPES.join(`,`) + `,.heic`}
            maxSize={CATALOG_PHOTO_MAX_BYTES}
            label="Add photos"
            busy={photos.uploading > 0}
            busyLabel={`Uploading ${photos.uploading}…`}
            onFiles={props.onUpload}
            onReject={(refused) => props.onUpload(refused.map((rejection) => rejection.file))}
          />
        )}
      />
      <CardBody>
        <Stack>
          <p class="text-sm text-muted">
            JPEG, PNG, WebP or HEIC, up to {CATALOG_PHOTO_MAX_BYTES / 1024 / 1024} MB each, at most
            {` ${CATALOG_PHOTOS_MAX}`}. Drag to reorder: the first is the cover.
          </p>
          <ErrorState message={photos.error} />
          {item.photos.length > 0 && (
            <div ref={list}>
              <SortableList
                items={item.photos}
                itemLabel={photoLabel}
                onMove={props.onPhotoMove}
                renderItem={(photo) => {
                  const words = PHOTO_STATE_WORDS[photo.state]
                  const colour = colourName(photo.colourId)
                  const alt = catalogText(photo.alt, languages)
                  return (
                    <div class="flex items-center gap-3 py-1" data-e2e="catalog-item-photo">
                      {photo.state === `ready`
                        ? <CatalogThumbnail photoId={photo.id} alt={alt} size="size-16" />
                        : <CatalogThumbnail photoId={null} size="size-16" />}
                      <div class="flex min-w-0 flex-1 flex-col gap-1">
                        <span class="font-medium">
                          {item.photos[0] === photo
                            ? `Cover`
                            : `Photo ${item.photos.indexOf(photo) + 1}`}
                          {colour && <span class="font-normal text-muted">{` · ${colour}`}</span>}
                        </span>
                        <span
                          class={`text-sm ${
                            photo.state === `refused` ? `text-danger` : `text-muted`
                          }`}
                        >
                          {words ?? (alt || `No description yet`)}
                        </span>
                      </div>
                      <Dropdown
                        trigger={<IconEllipsisVertical class="size-5" />}
                        triggerLabel={`More actions for ${photoLabel(photo)}`}
                        triggerClasses={MENU_TRIGGER_CLASSES}
                        triggerDataE2E="catalog-item-photo-menu"
                      >
                        {item.photos[0] !== photo && (
                          <DropdownItem
                            class={MENU_ITEM_CLASS}
                            disabled={photos.busy}
                            dataE2E="catalog-item-photo-cover"
                            onClick={() => {
                              setFocusOn(photo.id)
                              props.onPhotoMove(item.photos.indexOf(photo), 0)
                            }}
                          >
                            Make cover<span class="sr-only">: {photoLabel(photo)}</span>
                          </DropdownItem>
                        )}
                        <DropdownItem
                          class={MENU_ITEM_CLASS}
                          disabled={photos.busy}
                          dataE2E="catalog-item-photo-edit"
                          onClick={() => setEditing(photo)}
                        >
                          Describe<span class="sr-only">: {photoLabel(photo)}</span>
                        </DropdownItem>
                        <DropdownItem
                          class={MENU_ITEM_CLASS}
                          danger
                          disabled={photos.busy}
                          dataE2E="catalog-item-photo-remove"
                          onClick={() => setRemoving(photo)}
                        >
                          Remove<span class="sr-only">: {photoLabel(photo)}</span>
                        </DropdownItem>
                      </Dropdown>
                    </div>
                  )
                }}
              />
            </div>
          )}
          {item.photos.length === 0 && photos.uploading === 0 && (
            <p class="text-sm" data-e2e="catalog-item-no-photos">
              No photos yet. The website shows a placeholder until you add some.
            </p>
          )}
        </Stack>
      </CardBody>
      {editing && (
        <PhotoDialog
          photo={editing}
          item={item}
          languages={languages}
          title={`Describe the photo of ${name}`}
          onClose={() => setEditing(null)}
          onSave={(change) => {
            setEditing(null)
            props.onPhotoSave(editing.id, change)
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title="Remove this photo?"
          message="The website stops showing it, and its file is deleted."
          confirmLabel="Remove photo"
          cancelLabel="Cancel"
          tone="danger"
          dataE2E="catalog-item-photo-remove-dialog"
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            setRemoving(null)
            props.onPhotoRemove(removing.id)
          }}
        />
      )}
    </Card>
  )
}

/** A photo's description in each language, and the colour it shows. */
function PhotoDialog(
  { photo, item, languages, title, onClose, onSave }: {
    photo: CatalogPhoto
    item: CatalogItem
    languages: readonly string[]
    title: string
    onClose: () => void
    onSave: (change: { alt: CatalogText; colourId: string | null }) => void
  },
): JSX.Element {
  const [alt, setAlt] = useState<CatalogText>({ ...photo.alt })
  const [colourId, setColourId] = useState(photo.colourId ?? ``)
  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      dataE2E="catalog-item-photo-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            data-e2e="catalog-item-photo-save"
            onClick={() => onSave({ alt, colourId: colourId || null })}
          >
            Save photo
          </Button>
        </>
      }
    >
      <Stack>
        {languages.map((language) => (
          <Field
            key={language}
            id={`catalog-photo-alt-${language}`}
            label={languages.length === 1
              ? `What it shows`
              : `What it shows, in ${catalogLanguageName(language)}`}
            hint={language === languages[0]
              ? `For people who cannot see it, such as "Brown hoodie, front, on a hanger".`
              : undefined}
          >
            <Input
              lang={language}
              data-e2e="catalog-item-photo-alt"
              maxLength={CATALOG_ALT_MAX_LENGTH}
              value={alt[language] ?? ``}
              onInput={(event) => setAlt({ ...alt, [language]: event.currentTarget.value })}
            />
          </Field>
        ))}
        {item.colours.length > 0 && (
          <Field id="catalog-photo-colour" label="Colour it shows">
            <Select
              data-e2e="catalog-item-photo-colour"
              value={colourId}
              options={[
                { value: ``, label: `Every colour` },
                ...item.colours.map((colour) => ({
                  value: colour.id,
                  label: catalogText(colour.name, languages),
                })),
              ]}
              onChange={(event) => setColourId(event.currentTarget.value)}
            />
          </Field>
        )}
      </Stack>
    </Modal>
  )
}

// #endregion
