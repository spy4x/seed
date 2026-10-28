import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { NotificationKind } from "@domain/notifications"
import { telegramText } from "./telegram-notification.ts"

const roleChanged = {
  kind: NotificationKind.RoleChanged,
  payload: { groupName: `Team`, from: `editor`, to: `viewer` },
}

describe(`the Telegram notification's words`, () => {
  it(`are in the person's saved language, the group's name as it is`, () => {
    expect(telegramText({ ...roleChanged, language: `ru`, locale: null })).toEqual({
      text: `Ваша роль в группе «Team» теперь: читатель.`,
      open: `Открыть`,
    })
  })

  it(`are in English when the person saved no language, or one the app lacks`, () => {
    const english = { text: `Your role in “Team” is now a viewer.`, open: `Open` }
    expect(telegramText({ ...roleChanged, language: null, locale: null })).toEqual(english)
    expect(telegramText({ ...roleChanged, language: `xx`, locale: null })).toEqual(english)
  })

  it(`write the export's last day in the saved region format, else the language's`, () => {
    const ready = {
      kind: NotificationKind.DataExportReady,
      payload: { expiresAt: `2026-10-30T10:00:00.000Z` },
    }
    expect(telegramText({ ...ready, language: `en`, locale: `en-GB` }).text)
      .toBe(`Your data is ready. Download it from your profile until 30 Oct 2026.`)
    expect(telegramText({ ...ready, language: `de`, locale: null }).text).toContain(`30.10.2026`)
  })
})
