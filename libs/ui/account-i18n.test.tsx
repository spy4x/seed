/**
 * The sign-in and profile screens in the `en-XA` pseudo-language (#275): it wraps every catalog
 * message in `⟦ ⟧`, so a screen rendered in it shows no English outside those marks except data (a
 * name, an address, a device). English left in the code, past the catalog, fails here.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import {
  type Catalog,
  createTranslator,
  pseudoLocalize,
  type Translator,
} from "@spy4x/platform/universal/i18n"
import { I18nContext } from "@spy4x/preact-ui/i18n"
import { FormatContext } from "@spy4x/preact-ui/format"
import { createFormatters } from "@spy4x/time/format"
import uiEn from "@spy4x/preact-ui/i18n/en"
import systemEn from "@spy4x/preact-system/i18n/en"
import appEn from "@i18n/app/en.json" with { type: "json" }
import appDe from "@i18n/app/de.json" with { type: "json" }
import uiDe from "@spy4x/preact-ui/i18n/de"
import systemDe from "@spy4x/preact-system/i18n/de"
import {
  AccountDeletionBlockReason,
  type GuestSwitchState,
  type SignedInDevice,
  UserMFAStatus,
} from "@domain/identity"
import { AuthScreen } from "./auth-screen.tsx"
import { ConfirmSignUpScreen } from "./confirm-sign-up-screen.tsx"
import { SignUpCodeScreen } from "./sign-up-code-screen.tsx"
import { LinkOpenScreen, LinkRequestScreen } from "./sign-in-link-screen.tsx"
import { ForgotPasswordScreen, ResetPasswordScreen } from "./password-reset-screen.tsx"
import { ProfileScreen, type ProfileScreenProps } from "./profile-screen.tsx"
import {
  GuestBanner,
  GuestSignOutDialog,
  GuestTakenScreen,
  KeepScreen,
  type KeepScreenProps,
  TryScreen,
} from "./guest-screens.tsx"
import { GuestAccountDelete, GuestRefusalDialog, GuestSignInMethods } from "./guest-profile.tsx"

const window = new Window({ url: "http://app.localhost/" })
const own = {
  document: globalThis.document,
  location: globalThis.location,
  getComputedStyle: globalThis.getComputedStyle,
  HTMLElement: globalThis.HTMLElement,
}

beforeAll(() => {
  Object.assign(globalThis, {
    document: window.document,
    location: window.location,
    getComputedStyle: window.getComputedStyle.bind(window),
    HTMLElement: window.HTMLElement,
  })
})

afterAll(async () => {
  Object.assign(globalThis, own)
  await window.happyDOM.close()
})

let root: HTMLElement | null = null

afterEach(async () => {
  if (root) await act(() => render(null, root!))
  document.body.innerHTML = ""
  root = null
})

/** Renders `node` in `t`, the pseudo-language by default, with the formatters dates go through. */
async function mount(node: VNode, t: Translator<string> = PSEUDO): Promise<void> {
  root ??= document.body.appendChild(document.createElement("div"))
  await act(() =>
    render(
      <I18nContext.Provider value={t}>
        <FormatContext.Provider value={FORMAT}>{node}</FormatContext.Provider>
      </I18nContext.Provider>,
      root!,
    )
  )
}

const english = [uiEn, systemEn, appEn] as Catalog[]
const PSEUDO: Translator<string> = createTranslator({
  language: `en-XA`,
  catalogs: english.map((source) => ({ source, translation: pseudoLocalize(source) })),
})
const GERMAN: Translator<string> = createTranslator({
  language: `de`,
  catalogs: english.map((source, index) => ({
    source,
    translation: ([uiDe, systemDe, appDe] as Catalog[])[index],
  })),
})
const FORMAT = createFormatters({ locale: `en-GB`, timeZone: `Europe/Berlin`, hourCycle: `h23` })

/** What a person reads: every text node, and the names and hints in attributes. */
function readable(): string[] {
  const texts: string[] = []
  const walker = document.createTreeWalker(document.body, 4 /* NodeFilter.SHOW_TEXT */)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    // A date or a relative time is the formatters' data, in their own locale.
    if (node.parentElement?.closest(`script, style, time`)) continue
    texts.push(node.textContent ?? ``)
  }
  for (const element of document.body.querySelectorAll(`:not(time)`)) {
    for (const name of [`aria-label`, `placeholder`, `title`]) {
      const value = element.getAttribute(name)
      if (value) texts.push(value)
    }
  }
  return texts.map((text) => text.trim()).filter(Boolean)
}

/**
 * Data the screens show as it is: names, addresses, devices, brands, a code. Longest first, so a
 * name inside a longer one goes with it.
 */
const DATA = [
  `Firefox on Linux`,
  `Safari on iPhone`,
  `ada@example.com`,
  `a***@example.com`,
  `Ada Lovelace`,
  `Personal`,
  `Family`,
  `GitHub`,
  `Google`,
  `Telegram`,
  `seed_bot`,
  `JPEG`,
  `PNG`,
  `WebP`,
  `HEIC`,
  `ZIP`,
  `JSON`,
  `CSV`,
  `API`,
  `Ada`,
  `Lovelace`,
  `AL`,
  `MB`,
  `KB`,
  `GMT`,
  `CET`,
  `CEST`,
]

/** Every text the page shows that still has English in it, past the pseudo-language and data. */
function englishLeft(): string[] {
  return readable().filter((text) => {
    // A message split around a value spans several nodes: `⟦… ` before it, ` …⟧` after.
    let rest = text.replaceAll(/⟦[^⟧]*(⟧|$)/g, ``).replace(/^[^⟦]*⟧/, ``)
    // A tag's text inside a message (a link, a bold name) has no marks of its own: its accented
    // words are the pseudo-language, as English never has them.
    rest = rest.replaceAll(/\S*[\u00c0-\u024f]\S*/g, ``)
    for (const data of DATA) rest = rest.replaceAll(data, ``)
    return /[A-Za-z]{2,}/.test(rest)
  })
}

const NOW = new Date(`2026-10-17T12:05:00Z`)
const nothing = () => {}

const current: SignedInDevice = {
  id: 7,
  deviceName: `Firefox on Linux`,
  ipHint: `203.0.113.*`,
  createdAt: `2026-10-01T08:00:00.000Z`,
  lastUsedAt: `2026-10-04T08:00:00.000Z`,
  current: true,
}
const phone: SignedInDevice = { ...current, id: 9, deviceName: `Safari on iPhone`, current: false }

const profile: ProfileScreenProps = {
  section: `account`,
  user: { mfa: UserMFAStatus.CONFIGURED, firstName: `Ada`, lastName: `Lovelace` },
  isMfaRequired: false,
  email: { email: `ada@example.com`, proven: false, pending: null },
  values: {
    firstName: `Ada`,
    lastName: `Lovelace`,
    currentPassword: ``,
    newPassword: ``,
    passwordOtp: ``,
    otp: ``,
    totpPassword: ``,
    twoFactorProof: ``,
  },
  onValueChange: nothing,
  errors: { fields: {}, profile: null, password: null, totp: null, push: null },
  pending: { profile: false, password: false, totp: false, push: false },
  enrolment: null,
  pushDevices: [],
  onRemovePush: nothing,
  emailChange: {
    values: { code: ``, email: ``, password: `` },
    onValueChange: nothing,
    errors: { verify: null, send: null, change: null },
    notices: { send: null },
    pending: { verify: false, send: false, change: false },
  },
  methods: {
    methods: [
      { id: 1, kind: `password`, email: `ada@example.com`, current: false, canUnlink: false },
      { id: 2, kind: `google`, email: `ada@example.com`, current: true, canUnlink: true },
    ],
    available: [`github`],
    pending: false,
    error: { key: `SignInMethods.passkeyNotSaved` },
    onLink: nothing,
    onUnlink: nothing,
  },
  devices: {
    sessions: [current, phone],
    pending: false,
    error: null,
    onEnd: nothing,
    onEndOthers: nothing,
  },
  telegram: {
    status: { enabled: true, botUsername: `seed_bot`, linkedAt: null },
    code: null,
    error: { key: `ProfileTelegram.codeFailed` },
    pending: false,
    onLink: nothing,
    onCloseCode: nothing,
    onUnlink: nothing,
  },
  dataExport: {
    exportState: null,
    pending: false,
    error: { kind: `network` },
    onRequest: nothing,
    downloadHref: `/api/export`,
  },
  picture: {
    name: `Ada Lovelace`,
    hasPicture: true,
    status: `idle`,
    error: { key: `ProfilePicture.type`, values: { name: `photo.gif` } },
    announcement: { key: `ProfilePicture.saved` },
    onChoose: nothing,
    onReject: nothing,
    onRemove: nothing,
  },
  accountDeletion: {
    blockers: [{
      groupId: `g1`,
      name: `Family`,
      reason: AccountDeletionBlockReason.Members,
      endsAt: null,
    }],
    values: { password: ``, otp: `` },
    onValueChange: nothing,
    errors: { form: null },
    pending: false,
  },
}

const TAKEN: GuestSwitchState = {
  method: `password`,
  maskedEmail: `a***@example.com`,
  needsPassword: true,
  needsCode: true,
  groups: [{ id: `g1`, name: `Personal` }, { id: `g2`, name: `Family` }],
  notes: 3,
}

const keep: KeepScreenProps = {
  isGuest: true,
  providers: [`google`, `github`],
  passkeys: true,
  busy: null,
  error: null,
  kept: null,
  onProvider: nothing,
  onPasskey: nothing,
  onEmail: nothing,
  onDone: nothing,
}

const screens: Record<string, VNode> = {
  "sign-in": (
    <AuthScreen
      screen="sign-in"
      isSignedIn={false}
      isMfaRequired={false}
      busy={false}
      error={null}
      lastSignIn={{ method: `google`, email: `a***@example.com` }}
      demo
    />
  ),
  "sign-up": (
    <AuthScreen
      screen="sign-up"
      isSignedIn={false}
      isMfaRequired={false}
      busy={false}
      error={null}
      providers={[`google`]}
    />
  ),
  "one-time code": (
    <AuthScreen screen="one-time-code" isSignedIn={false} isMfaRequired busy={false} error={null} />
  ),
  "sign-up code": (
    <SignUpCodeScreen
      isSignedIn={false}
      pending={{ email: `ada@example.com`, expiresAt: `2026-10-17T12:15:00.000Z` }}
      exists={null}
      minutes={10}
      busy={false}
      error={null}
      resending={false}
      resendNotice={null}
      resendError={null}
      onSubmit={nothing}
      onResend={nothing}
      onDifferentAddress={nothing}
      onSignInInstead={nothing}
      onForgotPassword={nothing}
    />
  ),
  "sign-up code, an account exists": (
    <SignUpCodeScreen
      isSignedIn={false}
      pending={{ email: `ada@example.com`, expiresAt: `2026-10-17T12:15:00.000Z` }}
      exists={{ email: `ada@example.com`, password: true, providers: [`google`] }}
      minutes={10}
      busy={false}
      error={null}
      resending={false}
      resendNotice={null}
      resendError={null}
      onSubmit={nothing}
      onResend={nothing}
      onDifferentAddress={nothing}
      onSignInInstead={nothing}
      onForgotPassword={nothing}
    />
  ),
  "confirm sign-up": (
    <ConfirmSignUpScreen
      pending={{
        provider: `google`,
        email: `ada@example.com`,
        name: `Ada Lovelace`,
        avatarUrl: null,
        expiresAt: `2026-10-17T12:15:00.000Z`,
        unconfirmedAccount: true,
      }}
      busy={false}
      error={null}
      onBack={nothing}
      onCreate={nothing}
    />
  ),
  "link request": (
    <LinkRequestScreen
      email="ada@example.com"
      onEmailChange={nothing}
      sentTo="ada@example.com"
      fieldError={null}
      error={null}
      pending={false}
      onSubmit={nothing}
      resending={false}
      onResend={nothing}
      onDifferentAddress={nothing}
    />
  ),
  "link open": (
    <LinkOpenScreen
      state="ready"
      signedInAs="ada@example.com"
      busy={false}
      error={null}
      onContinue={nothing}
    />
  ),
  "forgot password": (
    <ForgotPasswordScreen email="" onEmailChange={nothing} sent error={null} pending={false} />
  ),
  "reset password": (
    <ResetPasswordScreen
      email="ada@example.com"
      code="code"
      newPassword=""
      onNewPasswordChange={nothing}
      done={false}
      error={null}
      pending={false}
    />
  ),
  "profile account": <ProfileScreen {...profile} />,
  "profile security": <ProfileScreen {...profile} section="security" />,
  "profile notifications": <ProfileScreen {...profile} section="notifications" />,
  "profile danger zone": <ProfileScreen {...profile} section="danger-zone" />,
  "try, failed": <TryScreen state={{ kind: `failed` }} onRetry={nothing} />,
  "try, signed in": <TryScreen state={{ kind: `signed-in` }} onRetry={nothing} />,
  "try, off": <TryScreen state={{ kind: `off` }} onRetry={nothing} />,
  keep: <KeepScreen {...keep} />,
  "keep, kept": <KeepScreen {...keep} kept="passkey" />,
  "keep, not a guest": <KeepScreen {...keep} isGuest={false} />,
  "keep, taken": (
    <GuestTakenScreen state={TAKEN} busy={false} error={null} onSwitch={nothing} onKeep={nothing} />
  ),
  "keep, taken by Google": (
    <GuestTakenScreen
      state={{ ...TAKEN, method: `google`, groups: [TAKEN.groups[0]] }}
      busy={false}
      error={null}
      onSwitch={nothing}
      onKeep={nothing}
    />
  ),
  "keep, nothing waits": (
    <GuestTakenScreen state={null} busy={false} error={null} onSwitch={nothing} onKeep={nothing} />
  ),
  "guest banner": <GuestBanner wipeAt={NOW} onDismiss={nothing} />,
  "guest banner, outside the demo": <GuestBanner wipeAt={null} onDismiss={nothing} />,
  "guest sign-out": <GuestSignOutDialog onKeep={nothing} onSignOut={nothing} onCancel={nothing} />,
  "guest refusal": <GuestRefusalDialog action="invite" onClose={nothing} />,
  "guest profile": (
    <>
      <GuestSignInMethods />
      <GuestAccountDelete pending={false} error={null} onDelete={nothing} />
    </>
  ),
}

describe(`the sign-in and profile screens`, () => {
  for (const [name, screen] of Object.entries(screens)) {
    it(`${name}: an en-XA render is all pseudo-language or data`, async () => {
      await mount(screen)
      // The render reached the screen: some pseudo-text is on the page.
      expect(document.body.textContent).toContain(`⟦`)
      expect(englishLeft()).toEqual([])
    })
  }
})

describe(`what the server answered, said in the screen's own words`, () => {
  it(`a requested reset link: the neutral German line, with focus on the title`, async () => {
    await mount(
      <ForgotPasswordScreen email="" onEmailChange={nothing} sent error={null} pending={false} />,
      GERMAN,
    )
    await act(() => new Promise((done) => setTimeout(done, 0)))
    const card = document.querySelector(`[data-e2e=forgot-password-sent]`)!
    expect(card.querySelector(`[role=status]`)!.textContent).toBe(
      appDe[`PasswordResetScreen.sent`],
    )
    expect(document.activeElement?.tagName).toBe(`H1`)
    expect(card.contains(document.activeElement)).toBe(true)
  })

  it(`a new code: the German sentence names the address, kept apart from the text`, async () => {
    await mount(
      <ProfileScreen
        {...profile}
        openEmailCode
        emailChange={{ ...profile.emailChange!, notices: { send: `ada@example.com` } }}
      />,
      GERMAN,
    )
    const notice = document.querySelector(`[data-e2e=email-send-notice]`)!
    expect(notice.textContent).toBe(`Ein neuer Code ist unterwegs an ada@example.com.`)
    expect(notice.querySelector(`bdi`)!.textContent).toBe(`ada@example.com`)
  })
})
