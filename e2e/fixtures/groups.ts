import { expect, type Locator, type Page } from "@playwright/test"

/** Page objects for the group pages: the list, the editor and the way to a group's notes. */

/** `text` as a regular expression that matches it literally. */
function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Opens the groups page from the main navigation, the way a person gets there. */
export async function openGroups(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Groups" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Groups" })).toBeVisible()
}

/**
 * The row link of the group named `name` on the groups page. The current group's link is named
 * "<name>, current group", so both names match.
 */
export function groupLink(page: Page, name: string): Locator {
  return page.locator("[data-e2e=group-list]").getByRole("link", {
    name: new RegExp(`^${literal(name)}(, current group)?$`),
  })
}

/** Opens the page of the group named `name` from the groups page. */
export async function openGroup(page: Page, name: string): Promise<void> {
  await groupLink(page, name).click()
  await expect(page).toHaveURL(/\/groups\/[0-9a-f-]{36}$/)
  await expect(page.locator("[data-e2e=group-general-name]")).toHaveText(name)
}

/** The address part each tab of a group's page adds to `/groups/:groupId`. */
const TAB_PATHS = {
  "General": "",
  "Members": "/members",
  "Plan and billing": "/billing",
  "Activity": "/activity",
}

/** Opens a tab of the open group's page by its name, the way a person does, and waits for its address. */
export async function openGroupTab(page: Page, tab: keyof typeof TAB_PATHS): Promise<void> {
  await page.getByRole("tab", { name: tab, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/groups/[0-9a-f-]{36}${TAB_PATHS[tab]}$`))
  await expect(page.getByRole("tab", { name: tab, exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
}

/**
 * Creates a group named `name` from the groups page's "New group", and resolves on the new group's
 * page, which takes the create page's place in the history.
 */
export async function createGroup(page: Page, name: string): Promise<void> {
  // By its hook, not its name: until the list has loaded, the empty page can show a second
  // "New group" button, and a click by name then matches two.
  await page.locator("[data-e2e=group-new]").click()
  await expect(page).toHaveURL("/groups/new")
  await page.locator("[data-e2e=group-name]").fill(name)
  await page.locator("[data-e2e=group-create]").click()
  await expect(page).toHaveURL(/\/groups\/[0-9a-f-]{36}$/)
  await expect(page.locator("[data-e2e=group-general-name]")).toHaveText(name)
}

/**
 * Opens the notes of the group named `name`: its page from the groups page, "Switch to this group"
 * in its menu unless it is already the current group, then Notes in the main navigation.
 */
export async function openNotes(page: Page, name: string): Promise<void> {
  await openGroups(page)
  await openGroup(page, name)
  if (await page.locator("[data-e2e=group-current]").count() === 0) {
    await page.locator("[data-e2e=group-menu]").click()
    await page.getByRole("menuitem", { name: "Switch to this group" }).click()
    await expect(page.locator("[data-e2e=group-current]")).toBeVisible()
  }
  await page.getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Notes" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Notes", exact: true })).toBeVisible()
  await expect(page.locator("[data-e2e=notes-group]")).toHaveText(name)
}
