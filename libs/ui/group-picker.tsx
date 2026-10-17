import type { JSX } from "preact"
import { IconCheck, IconChevronDown } from "@spy4x/preact-icons"
import type { RailShellSidebarPlace } from "@spy4x/preact-system/rail-shell"
import { Dropdown, DropdownItem } from "@spy4x/preact-ui/dropdown"
import { Link } from "@spy4x/preact-ui/link"
import { Tooltip } from "@spy4x/preact-ui/tooltip"
import type { GroupColor, GroupRole } from "@domain/groups"
import { GroupMark } from "./group-appearance.tsx"
import { NEW_GROUP_PATH, ROLE_TEXT } from "./groups-screen.tsx"
import { type Navigate, SCREEN_PATHS } from "./progressive.tsx"

/** One group of the switcher: its name, and the person's role in it. */
export interface PickerGroup {
  id: string
  name: string
  /** The group's colour and emoji, when it has them. */
  color?: GroupColor | null
  emoji?: string | null
  role: GroupRole
}

/** What `AppFrame` needs to show the switcher. */
export interface GroupPickerData {
  groups: readonly PickerGroup[]
  /** The person's selected group, or `null` before it is known or for a person with no groups. */
  selectedId: string | null
  /** Called with the group the person picked. */
  onSelect: (groupId: string) => void
}

/**
 * A `data-e2e` hook for a control `RailShell` draws once per place: the labelled sidebar keeps the
 * plain name, which the e2e specs use at desktop width, and the rail and the phone sheet add their
 * place, so every hook names one element.
 */
export function placeHook(name: string, place: RailShellSidebarPlace): string {
  return place === "sidebar" ? name : `${name}-${place}`
}

/**
 * `contentClass` for a rail tooltip around a menu's trigger: hides the tooltip while the menu is
 * open, so it does not sit beside the open menu (the tooltip shows while focus is inside it).
 */
export const MENU_TOOLTIP_CLASS = "group-has-[[aria-expanded=true]]:invisible!"

/**
 * The group's mark in the switcher: its own colour and emoji, or its initial on a quiet tile when
 * it has neither, so every group has a mark and the names line up.
 */
function SwitcherMark(
  { group, size = "sm" }: { group: PickerGroup; size?: "sm" | "md" },
): JSX.Element {
  if (group.color || group.emoji) {
    return <GroupMark color={group.color} emoji={group.emoji} size={size} />
  }
  return (
    <span
      class={`flex shrink-0 items-center justify-center rounded-md border border-subtle bg-canvas font-semibold text-muted ${
        size === "sm" ? "size-5 text-xs" : "size-7 text-sm"
      }`}
      aria-hidden="true"
    >
      {group.name.trim().charAt(0).toUpperCase()}
    </span>
  )
}

/** The switcher's accessible name: `Group: Home`, or the visible `Choose a group` without one. */
export function switcherLabel(selected: PickerGroup | null): string {
  return selected ? `Group: ${selected.name}` : "Choose a group"
}

/**
 * The current group at the top of the sidebar: a button that opens a short menu of the person's
 * groups. The current one is checked (`menuitemradio`), each names the person's role there, and the
 * menu ends with links to all groups and to a new one.
 *
 * In the labelled sidebar (`place` `"sidebar"`, the default) the button spans the column with the
 * group's mark, its name and the person's role. In the 72 px rail it is the mark alone, named and
 * shown as a tooltip `Group: Home`. On a phone the sheet lists the groups instead
 * ({@link GroupSheet}).
 */
export function GroupPicker(
  { groups, selectedId, onSelect, navigate, place = "sidebar" }: GroupPickerData & {
    navigate?: Navigate
    place?: Exclude<RailShellSidebarPlace, "overlay">
  },
): JSX.Element {
  const selected = groups.find((group) => group.id === selectedId) ?? null
  const label = switcherLabel(selected)
  const rail = place === "rail"
  const hook = (name: string) => placeHook(name, place)
  const menu = (
    <Dropdown
      trigger={rail
        ? (selected
          ? <SwitcherMark group={selected} size="md" />
          : <IconChevronDown class="size-5 text-muted" aria-hidden="true" />)
        : (
          <>
            {selected && <SwitcherMark group={selected} size="md" />}
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate">{selected?.name ?? "Choose a group"}</span>
              {selected && (
                <span class="truncate text-xs font-normal text-muted">
                  {ROLE_TEXT[selected.role]}
                </span>
              )}
            </span>
            <IconChevronDown class="size-4 shrink-0 text-muted" aria-hidden="true" />
          </>
        )}
      triggerLabel={label}
      triggerDataE2E={hook("group-picker")}
      triggerClasses={rail
        ? "flex min-h-11 w-full items-center justify-center rounded-md py-2 hover:bg-canvas"
        : "flex min-h-11 w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left text-sm font-medium text-foreground hover:bg-canvas"}
      containerClasses="relative flex w-full min-w-0 text-left"
      panelClasses="z-30 w-72 max-w-[calc(100vw-5rem)]"
      horizontal="left"
      vertical="down"
      menuLabel="Switch group"
    >
      {groups.map((group) => (
        <DropdownItem
          key={group.id}
          checked={group.id === selectedId}
          onClick={() => group.id !== selectedId && onSelect(group.id)}
          dataE2E={hook(`group-picker-${group.id}`)}
        >
          <SwitcherMark group={group} />
          <span class="min-w-0 flex-1 truncate">{group.name}</span>
          {/* A space, so a screen reader says "Home Owner", not "HomeOwner"; flex drops it. */}
          {" "}
          <span class="shrink-0 text-xs text-muted">{ROLE_TEXT[group.role]}</span>
        </DropdownItem>
      ))}
      {groups.length > 0 && <div role="separator" class="my-1 border-t border-subtle" />}
      <DropdownItem
        href={SCREEN_PATHS.groups}
        navigate={navigate}
        dataE2E={hook("group-picker-all")}
      >
        All groups
      </DropdownItem>
      <DropdownItem href={NEW_GROUP_PATH} navigate={navigate} dataE2E={hook("group-picker-new")}>
        New group
      </DropdownItem>
    </Dropdown>
  )
  if (!rail) return menu
  return (
    <Tooltip
      label={label}
      content={label}
      placement="right"
      focusable={false}
      class="flex w-full"
      contentClass={MENU_TOOLTIP_CLASS}
    >
      {menu}
    </Tooltip>
  )
}

const sheetRow =
  "flex min-h-11 w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-canvas"

/**
 * The groups in the phone's Account sheet: one row per group, the current one checked, then "All
 * groups" and "New group". Choosing a group selects it and closes the sheet, as a menu closes when
 * an item is chosen; the two links close it by leaving the page.
 */
export function GroupSheet(
  { groups, selectedId, onSelect, navigate }: GroupPickerData & { navigate?: Navigate },
): JSX.Element {
  return (
    <div class="flex flex-col gap-1" role="group" aria-labelledby="group-sheet-heading">
      <h3 id="group-sheet-heading" class="px-3 pt-1 text-xs font-medium text-muted">Group</h3>
      <ul class="flex flex-col gap-1">
        {groups.map((group) => {
          const current = group.id === selectedId
          return (
            <li key={group.id}>
              <button
                type="button"
                class={sheetRow}
                aria-current={current ? "true" : undefined}
                onClick={(event) => {
                  if (!current) onSelect(group.id)
                  event.currentTarget.closest("dialog")?.close()
                }}
                data-e2e={`group-sheet-${group.id}`}
              >
                <span class="flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
                  {current && <IconCheck class="size-4 text-accent" />}
                </span>
                <SwitcherMark group={group} />
                <span class="min-w-0 flex-1 truncate font-medium">{group.name}</span>{" "}
                <span class="shrink-0 text-xs text-muted">{ROLE_TEXT[group.role]}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <div class="grid grid-cols-2 gap-1">
        <Link
          href={SCREEN_PATHS.groups}
          navigate={navigate}
          class={`${sheetRow} justify-center text-accent`}
          data-e2e="group-sheet-all"
        >
          All groups
        </Link>
        <Link
          href={NEW_GROUP_PATH}
          navigate={navigate}
          class={`${sheetRow} justify-center text-accent`}
          data-e2e="group-sheet-new"
        >
          New group
        </Link>
      </div>
    </div>
  )
}
