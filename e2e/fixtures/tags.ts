import { type APIRequestContext, expect, type Locator, type Page, test } from "@playwright/test"
import { gotoApp } from "./app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"

/** Page objects and API helpers for the tag specs. */

/**
 * The app's origin as the running test sees it. The suite's harness rewrites the specs' own
 * `apiBase`, not the fixtures, so a fixture asks the project instead of naming a port.
 */
function origin(): string {
  return new URL(String(test.info().project.use.baseURL)).origin
}

function headers(): Record<string, string> {
  return { origin: origin(), "sec-fetch-site": "same-origin" }
}

export const password = "Passw0rd!"

/** A tag as the API lists it. */
export interface ServerTag {
  id: string
  name: string
  color: string
}

/** A note as the API lists it. */
export interface ServerNote {
  id: string
  title: string
  tagIds: string[]
}

export async function cleanup(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post(`${origin()}/api/test/cleanup-user`, {
    data: { login: email },
  })
  expect.soft(response.status(), await response.text()).toBe(200)
}

export async function signUp(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post(`${origin()}/api/auth/password/sign-up`, {
    headers: headers(),
    data: { email, password },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

/** Makes a group for the signed-in page's user and selects it. */
export async function selectedGroup(page: Page, name: string): Promise<string> {
  const groupId = uuidV7()
  const group = await page.request.post(`${origin()}/api/groups`, {
    headers: headers(),
    data: { id: groupId, name },
  })
  expect(group.status(), await group.text()).toBe(201)
  const selected = await page.request.put(`${origin()}/api/groups/selected`, {
    headers: headers(),
    data: { groupId },
  })
  expect(selected.ok(), await selected.text()).toBe(true)
  return groupId
}

export async function serverTags(page: Page, groupId: string): Promise<ServerTag[]> {
  const response = await page.request.get(`${origin()}/api/groups/${groupId}/tags`)
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json()).tags
}

export async function serverNotes(page: Page, groupId: string): Promise<ServerNote[]> {
  const response = await page.request.get(`${origin()}/api/groups/${groupId}/notes`)
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json()).notes
}

/** The tags page of the selected group. */
export class TagsPage {
  constructor(readonly page: Page) {}

  get names(): Locator {
    return this.page.locator("[data-e2e=tag-list] [data-e2e=tag-edit]")
  }

  row(name: string): Locator {
    return this.page.locator("[data-e2e=tag-list] > li")
      .filter({ has: this.page.locator(`[data-e2e=tag-edit][aria-label="Edit ${name}"]`) })
  }

  /** Opens the page from the notes list's menu, as a person does. */
  async openFromNotes(): Promise<void> {
    await this.page.locator("[data-e2e=notes-menu]").click()
    await this.page.locator("[data-e2e=notes-tags]").click()
    await expect(this.page).toHaveURL("/tags")
    await expect(this.page.locator("[data-e2e=tag-new], [data-e2e=tag-new-empty]").first())
      .toBeVisible()
  }

  async open(): Promise<void> {
    await gotoApp(this.page, "/tags", this.page.locator("[data-e2e=tags-group]"))
  }

  async create(name: string, color?: string): Promise<void> {
    await this.page.locator("[data-e2e=tag-new], [data-e2e=tag-new-empty]").first().click()
    await this.fillAndSave(name, color)
  }

  async rename(from: string, to: string, color?: string): Promise<void> {
    await this.row(from).locator("[data-e2e=tag-edit]").click()
    await this.fillAndSave(to, color)
  }

  async remove(name: string): Promise<void> {
    await this.row(name).locator("[data-e2e=tag-menu]").click()
    await this.page.locator("[data-e2e=tag-delete]:visible").click()
    await this.page.locator("[data-e2e=tag-delete-dialog] [data-e2e=confirm-dialog-confirm]")
      .click()
  }

  private async fillAndSave(name: string, color?: string): Promise<void> {
    const dialog = this.page.locator("[data-e2e=tag-dialog]")
    await dialog.locator("[data-e2e=tag-name]").fill(name)
    if (color) await dialog.getByLabel(color, { exact: true }).check()
    await dialog.locator("[data-e2e=tag-save]").click()
    await expect(dialog).toBeHidden()
  }

  async back(): Promise<void> {
    await this.page.locator("[data-e2e=page-back]").click()
    await expect(this.page).toHaveURL("/notes")
  }
}

/** The notes list and the note page, as far as tags are concerned. */
export class NotesTags {
  constructor(readonly page: Page) {}

  get titles(): Locator {
    return this.page.locator("[data-e2e=note-item-title]")
  }

  /** The labels on the row of the note with this title. */
  labels(title: string): Locator {
    return this.page.locator("li[data-e2e^=note-]").filter({ hasText: title })
      .locator("[data-e2e=note-tag]")
  }

  filterChip(name: string): Locator {
    return this.page.locator("[data-e2e=notes-tag-filter]").getByText(name, { exact: true })
  }

  pickerChip(name: string): Locator {
    return this.page.locator("[data-e2e=note-tags-picker]").getByText(name, { exact: true })
  }

  /** Creates a note on the note page, ticking the given tags, and returns to the list. */
  async create(title: string, tagNames: string[]): Promise<void> {
    await this.page.locator("[data-e2e=note-new], [data-e2e=note-new-empty]").first().click()
    await this.page.locator("[data-e2e=note-title]").fill(title)
    for (const name of tagNames) await this.pickerChip(name).click()
    await this.page.locator("[data-e2e=note-save]").click()
    await expect(this.page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/)
    await this.page.locator("[data-e2e=page-back]").click()
    await expect(this.page).toHaveURL(/\/notes(\?.*)?$/)
  }
}
