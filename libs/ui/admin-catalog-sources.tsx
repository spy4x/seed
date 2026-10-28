import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { slugify } from "@spy4x/platform/universal/text"
import { IconEllipsisVertical, IconPlus } from "@spy4x/preact-icons"
import { Button } from "@spy4x/preact-ui/button"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { Dropdown, DropdownItem } from "@spy4x/preact-ui/dropdown"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Link } from "@spy4x/preact-ui/link"
import { Stack } from "@spy4x/preact-ui/layout"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { Notice } from "@spy4x/preact-ui/notice"
import { PageAction, PageHeader } from "@spy4x/preact-ui/page-header"
import {
  CATALOG_SLUG_MAX_LENGTH,
  CATALOG_SOURCE_NAME_MAX_LENGTH,
  type CatalogLinkSource,
} from "@domain/catalog"
import { ADMIN_CATALOG_PATHS, catalogFieldId, type CatalogFormErrors } from "./admin-catalog.tsx"
import { useAdminText } from "./i18n.ts"
import { ListCard, ListEmpty, MENU_TRIGGER_CLASSES } from "./notes-screen.tsx"
import { type Navigate, ScreenForm } from "./progressive.tsx"

/** The catalog key of what the sources page says while items get no links: no website address. */
export const TRACKING_OFF_NOTICE = `AdminCatalogSources.trackingOff`

export interface AdminCatalogSourcesScreenProps {
  /** The sources in order, or `null` while they load or when they failed. */
  sources: readonly CatalogLinkSource[] | null
  /** Whether items get tracking links (`AdminCatalogResponse.tracking`). */
  tracking: boolean
  error: string | null
  /** A move or deletion is on its way; the menus wait for it. */
  busy: boolean
  onRetry: () => void
  onMove: (id: string, by: -1 | 1) => void
  onDelete: (source: CatalogLinkSource) => void
  navigate?: Navigate
}

/**
 * The places the shop shares its items in (#483), each with its own tracking link per item, so
 * Umami can tell which brings visitors. "Add source" is the page's one action; a source's name
 * opens its editor, and its menu moves it or deletes it behind a confirmation that says how many
 * shared links stop working.
 */
export function AdminCatalogSourcesScreen(props: AdminCatalogSourcesScreenProps): JSX.Element {
  const { sources, navigate } = props
  const t = useAdminText()
  const [deleting, setDeleting] = useState<CatalogLinkSource | null>(null)
  const [focusOn, setFocusOn] = useState<{ id: string; index: number } | null>(null)
  const page = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focusOn || props.busy || !sources) return
    const menus = page.current?.querySelectorAll<HTMLElement>(`[data-e2e=catalog-source-menu]`)
    const at = sources.findIndex((source) => source.id === focusOn.id)
    const target = at >= 0 ? menus?.[at] : menus?.[focusOn.index] ?? menus?.[focusOn.index - 1] ??
      page.current?.querySelector<HTMLElement>(`[data-e2e=catalog-source-new]`)
    target?.focus()
    setFocusOn(null)
  }, [focusOn, sources, props.busy])

  return (
    <div ref={page} class="flex flex-col gap-8">
      <PageHeader
        back={{ href: ADMIN_CATALOG_PATHS.list, label: t.t(`AdminCatalogSources.back`) }}
        navigate={navigate}
        title={t.t(`AdminCatalogSources.title`)}
        subtitle={t.t(`AdminCatalogSources.subtitle`)}
        titleDataE2E="catalog-sources-title"
        action={
          <PageAction
            label={t.t(`AdminCatalogSources.add`)}
            Icon={IconPlus}
            href={ADMIN_CATALOG_PATHS.sourceCreate}
            navigate={navigate}
            dataE2E="catalog-source-new"
          />
        }
      />
      <Stack>
        {!props.tracking && sources !== null && (
          <Notice tone="info" data-e2e="catalog-sources-tracking-off">
            {t.t(TRACKING_OFF_NOTICE)}
          </Notice>
        )}
        {props.error && (
          <div class="flex flex-col items-center gap-3" data-e2e="catalog-sources-error">
            <ErrorState message={sources ? props.error : t.t(`AdminCatalog.error`)} />
            {!sources && (
              <Button variant="secondary" onClick={props.onRetry}>
                {t.t(`AdminCatalog.retry`)}
              </Button>
            )}
          </div>
        )}
        {sources === null
          ? !props.error && (
            <div role="status" aria-label={t.t(`AdminCatalogSources.loading`)}>
              <LoadingSkeleton rows={3} />
            </div>
          )
          : sources.length === 0
          ? (
            <ListEmpty
              title={t.t(`AdminCatalogSources.emptyTitle`)}
              description={t.t(`AdminCatalogSources.emptyText`)}
              action={
                <Button
                  href={ADMIN_CATALOG_PATHS.sourceCreate}
                  navigate={navigate}
                  variant="outline"
                >
                  {t.t(`AdminCatalogSources.add`)}
                </Button>
              }
            />
          )
          : (
            <ListCard dataE2E="catalog-source-list">
              {sources.map((source, index) => (
                <li
                  key={source.id}
                  class="flex min-h-14 items-center gap-3 px-4 py-3 sm:px-6"
                  data-e2e="catalog-source-row"
                >
                  <div class="flex min-w-0 flex-1 flex-col gap-1">
                    <Link
                      href={ADMIN_CATALOG_PATHS.source(source.id)}
                      navigate={navigate}
                      class="pc-link line-clamp-2 font-medium wrap-anywhere"
                      data-e2e="catalog-source-edit"
                    >
                      <bdi translate={false}>{source.name}</bdi>
                    </Link>
                    <span class="text-sm text-muted wrap-anywhere">
                      {/* A query parameter, no language changes it. The rule knows only translate="no", which Preact cannot set. */}
                      <bdi translate={false}>
                        {/* deno-lint-ignore ui-text/no-literal */}
                        {`utm_source=${source.slug}`}
                      </bdi>
                      {` · ${t.t(`AdminCatalogSources.links`, { count: source.linkCount })}`}
                    </span>
                  </div>
                  <div class="relative -my-2 -mr-2 shrink-0">
                    <Dropdown
                      trigger={<IconEllipsisVertical class="size-5" />}
                      triggerLabel={t.t(`AdminCatalogSources.actionsFor`, { name: source.name })}
                      triggerClasses={MENU_TRIGGER_CLASSES}
                      triggerDataE2E="catalog-source-menu"
                    >
                      <DropdownItem
                        href={ADMIN_CATALOG_PATHS.source(source.id)}
                        navigate={navigate}
                      >
                        {t.t(`AdminCatalogSources.edit`)}
                      </DropdownItem>
                      {index > 0 && (
                        <DropdownItem
                          disabled={props.busy}
                          dataE2E="catalog-source-up"
                          onClick={() => {
                            setFocusOn({ id: source.id, index })
                            props.onMove(source.id, -1)
                          }}
                        >
                          {t.t(`AdminCatalogSources.moveUp`)}
                        </DropdownItem>
                      )}
                      {index < sources.length - 1 && (
                        <DropdownItem
                          disabled={props.busy}
                          dataE2E="catalog-source-down"
                          onClick={() => {
                            setFocusOn({ id: source.id, index })
                            props.onMove(source.id, 1)
                          }}
                        >
                          {t.t(`AdminCatalogSources.moveDown`)}
                        </DropdownItem>
                      )}
                      <DropdownItem
                        danger
                        disabled={props.busy}
                        dataE2E="catalog-source-delete"
                        onClick={() => setDeleting(source)}
                      >
                        {t.t(`AdminCatalogSources.deleteMenu`)}
                      </DropdownItem>
                    </Dropdown>
                  </div>
                </li>
              ))}
            </ListCard>
          )}
      </Stack>
      {deleting && sources && (
        <ConfirmDialog
          title={t.t(`AdminCatalogSources.deleteTitle`, { name: deleting.name })}
          message={deleting.linkCount === 0
            ? t.t(`AdminCatalogSources.deleteNoLinks`)
            : t.t(`AdminCatalogSources.deleteLinks`, { count: deleting.linkCount })}
          confirmLabel={t.t(`AdminCatalogSources.delete`)}
          cancelLabel={t.t(`AdminCatalogSources.cancel`)}
          tone="danger"
          dataE2E="catalog-source-delete-dialog"
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const index = sources.findIndex((one) => one.id === deleting.id)
            setDeleting(null)
            setFocusOn({ id: deleting.id, index })
            props.onDelete(deleting)
          }}
        />
      )}
    </div>
  )
}

/** What the source editor's fields hold. */
export interface CatalogSourceDraft {
  name: string
  slug: string
  /** Whether the operator typed the slug; until then it follows the name. */
  slugEdited: boolean
}

export interface AdminCatalogSourceEditorScreenProps {
  /** The source as saved, or `null` on the create page. */
  source: CatalogLinkSource | null
  loading: boolean
  notFound: boolean
  value: CatalogSourceDraft
  onChange: (value: CatalogSourceDraft) => void
  /** By field: `name`, `slug`, and `form`. */
  errors: CatalogFormErrors
  saving: boolean
  onSave: () => void
  navigate?: Navigate
}

/**
 * One source on a page of its own: its name, which only the operator sees, and the `utm_source`
 * its links carry, which follows the name until typed. A refused field gets focus.
 */
export function AdminCatalogSourceEditorScreen(
  props: AdminCatalogSourceEditorScreenProps,
): JSX.Element {
  const { source, value, errors, navigate } = props
  const t = useAdminText()
  const back = { href: ADMIN_CATALOG_PATHS.sources, label: t.t(`AdminCatalogSource.back`) }
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const first = [`name`, `slug`].find((field) => errors[field])
    if (first) root.current?.querySelector<HTMLElement>(`#${catalogFieldId(first)}`)?.focus()
  }, [errors])

  if (props.notFound || (props.loading && !source)) {
    return (
      <Stack gap="xl">
        <PageHeader back={back} navigate={navigate} title={t.t(`AdminCatalogSource.title`)} />
        {props.notFound
          ? (
            <div data-e2e="catalog-source-not-found">
              <ListEmpty
                title={t.t(`AdminCatalogSource.notFound`)}
                description={t.t(`AdminCatalogSource.notFoundText`)}
                action={
                  <Button href={back.href} navigate={navigate} variant="outline">
                    {back.label}
                  </Button>
                }
              />
            </div>
          )
          : (
            <div role="status" aria-label={t.t(`AdminCatalogSource.loading`)}>
              <LoadingSkeleton rows={2} class="max-w-md" />
            </div>
          )}
      </Stack>
    )
  }

  return (
    <div ref={root}>
      <Stack gap="xl">
        <PageHeader
          back={back}
          navigate={navigate}
          title={source ? source.name : t.t(`AdminCatalogSource.newTitle`)}
          titleDataE2E="catalog-source-title"
        />
        <ScreenForm pending={props.saving} onSubmit={props.onSave}>
          <Stack class="max-w-md">
            <Field
              id={catalogFieldId(`name`)}
              label={t.t(`AdminCatalogSource.name`)}
              hint={t.t(`AdminCatalogSource.nameHint`)}
              error={errors.name}
              required
            >
              <Input
                name="name"
                data-e2e="catalog-source-name"
                autocomplete="off"
                maxLength={CATALOG_SOURCE_NAME_MAX_LENGTH}
                value={value.name}
                onInput={(event) => {
                  const name = event.currentTarget.value
                  props.onChange({
                    ...value,
                    name,
                    slug: value.slugEdited
                      ? value.slug
                      : slugify(name).slice(0, CATALOG_SLUG_MAX_LENGTH),
                  })
                }}
                required
              />
            </Field>
            <Field
              id={catalogFieldId(`slug`)}
              label={t.t(`AdminCatalogSource.slug`)}
              hint={t.t(`AdminCatalogSource.slugHint`)}
              error={errors.slug}
              required
            >
              <Input
                name="slug"
                data-e2e="catalog-source-slug"
                autocomplete="off"
                maxLength={CATALOG_SLUG_MAX_LENGTH}
                value={value.slug}
                onInput={(event) =>
                  props.onChange({ ...value, slug: event.currentTarget.value, slugEdited: true })}
                required
              />
            </Field>
            {source && source.linkCount > 0 && (
              <p class="text-sm text-muted" data-e2e="catalog-source-links-note">
                {t.t(`AdminCatalogSource.linksNote`, { count: source.linkCount })}
              </p>
            )}
            <ErrorState message={errors.form ?? null} />
            <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                href={back.href}
                navigate={navigate}
                variant="ghost"
                class="min-h-11 w-full sm:min-h-9 sm:w-auto"
              >
                {t.t(`AdminCatalogSource.cancel`)}
              </Button>
              <Button
                type="submit"
                class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                data-e2e="catalog-source-save"
                busy={props.saving}
                busyLabel={t.t(`AdminCatalogSource.saving`)}
              >
                {t.t(source ? `AdminCatalogSource.save` : `AdminCatalogSources.add`)}
              </Button>
            </div>
          </Stack>
        </ScreenForm>
      </Stack>
    </div>
  )
}
