// Seed's own site: see docs/start-a-product.md
/**
 * Captures the product screenshots and the Open Graph images of the public website.
 *
 * `deno task screenshots` in `apps/mpa`; README.md beside this file says what it needs. It signs up
 * four people on the local development stack, builds their group, notes, tags, notifications and
 * plan through the API, photographs each screen in light and dark, encodes the pictures as WebP
 * into `static/shots/`, renders `og.html` into `static/og/`, and deletes the four accounts again
 * whether or not the run succeeded.
 */
import { type Browser, type BrowserContext, chromium, type Locator, type Page } from "playwright"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { gotoApp } from "../../../e2e/fixtures/app.ts"
import { stripeSignature, subscriptionEvent } from "../../../e2e/fixtures/billing.ts"
import { currentStep, totpCode } from "../../../e2e/fixtures/totp.ts"
import { signUpWithCode } from "../../../e2e/fixtures/sign-up.ts"

const APP = Deno.env.get("SHOTS_APP_URL") ?? "http://app.localhost"
const MPA = new URL("..", import.meta.url).pathname
const MASTERS = `${MPA}screenshots/.out/masters`
const CACHE = `${MPA}screenshots/.out/cache`
const SHOTS = `${MPA}static/shots`
const OG = `${MPA}static/og`

/**
 * The fonts of the Open Graph images: the `geist` npm package at an exact version, checked against
 * the integrity the registry publishes for it.
 */
const GEIST = {
  url: "https://registry.npmjs.org/geist/-/geist-1.7.2.tgz",
  integrity:
    "sha512-Gu5lDFa3pLRyoBlBPf0QIFHVdWAnpco7fS1bJm41jyLPFoguBgiubseUN2oLXMgqZ7uxAxDoXcHMhCY/fOTTgg==",
  files: {
    "geist-sans.woff2": "package/dist/fonts/geist-sans/Geist-Variable.woff2",
    "geist-mono.woff2": "package/dist/fonts/geist-mono/GeistMono-Variable.woff2",
  },
}

/** One password for the four people, made per run and never written anywhere. */
const PASSWORD = `Sd-${crypto.getRandomValues(new Uint32Array(4)).join("")}`

interface Person {
  email: string
  firstName: string
  lastName: string
}

const ADA: Person = { email: "ada@example.com", firstName: "Ada", lastName: "Lovelace" }
const GRACE: Person = { email: "grace@example.com", firstName: "Grace", lastName: "Hopper" }
const LINUS: Person = { email: "linus@example.com", firstName: "Linus", lastName: "Torvalds" }
const MARGARET: Person = {
  email: "margaret@example.com",
  firstName: "Margaret",
  lastName: "Hamilton",
}
const PEOPLE = [ADA, GRACE, LINUS, MARGARET]

const TAGS = [
  { name: "Roadmap", color: "#7e22ce" },
  { name: "Bug", color: "#b91c1c" },
  { name: "Design", color: "#1d4ed8" },
  { name: "Research", color: "#15803d" },
  { name: "Ops", color: "#c2410c" },
] as const
type TagName = typeof TAGS[number]["name"]

/** The six notes of "Acme Studio", oldest first, with who writes each. */
const NOTES: { title: string; body: string; tags: TagName[]; author: Person }[] = [
  {
    title: "Postgres 18 upgrade checklist",
    body: "Snapshot the volume, run the upgrade task on staging first, then production at 06:00.",
    tags: ["Ops"],
    author: GRACE,
  },
  {
    title: "Interview notes: three design agencies",
    body:
      "All three bill per member and hate per-member pricing. Two of them work offline on trains.",
    tags: ["Research"],
    author: MARGARET,
  },
  {
    title: "Checkout fails for EU VAT numbers",
    body: "Stripe rejects numbers with spaces. Strip them before we send the tax id.",
    tags: ["Bug"],
    author: LINUS,
  },
  {
    title: "New pricing page: copy review",
    body: "Lead with the price, then what the plan covers. Cut the comparison table to five rows.",
    tags: ["Design", "Research"],
    author: GRACE,
  },
  {
    title: "Release notes 2.4",
    body: "Two-factor sign-in, group activity, and the offline conflict chooser.",
    tags: ["Roadmap"],
    author: ADA,
  },
  {
    title: "Q4 roadmap: onboarding and billing",
    body: "Ship self-serve onboarding by November, then annual plans and invoices in December.",
    tags: ["Roadmap", "Design"],
    author: ADA,
  },
]

/** The Open Graph card of one website page: its words (marketing brief 4.3) and picture. */
interface OgCard {
  file: string
  eyebrow: string
  title: string
  sub: string
  /** A dark picture under `static/`, such as `shots/notes-dark-1280.webp`, or "" for words only. */
  shot: string
  /** How far down the screenshot its frame starts, in the card's pixels. */
  top?: number
  /** How wide the screenshot is drawn, in the card's pixels: 860 unless set. */
  width?: number
}

const OG_CARDS: OgCard[] = [
  {
    file: "home",
    eyebrow: "Open-source SaaS foundation",
    title: "The groundwork of your SaaS, already built.",
    sub: "Seed · open source · MIT · one server you rent",
    shot: "shots/notes-dark-1280.webp",
  },
  {
    file: "features",
    eyebrow: "Features",
    title: "Auth, groups, billing, offline, admin.",
    sub: "Everything Seed ships, and what it does not yet",
    shot: "shots/group-members-dark-1280.webp",
  },
  {
    file: "admin",
    eyebrow: "Admin panel",
    title: "An admin panel for your SaaS.",
    sub: "Users · billing · audit log · roles",
    shot: "video/admin-panel-poster-1920.webp",
  },
  {
    file: "compare",
    eyebrow: "Compare",
    title: "Seed vs ShipFast, Supastarter, Makerkit, Open SaaS",
    sub: "Honest, sourced, checked 16 Oct 2026",
    shot: "",
  },
  {
    file: "pricing",
    eyebrow: "Pricing",
    title: "Seed is free.",
    sub: "MIT licence · you pay for one server",
    shot: "",
  },
  {
    file: "subscribe",
    eyebrow: "Newsletter",
    title: "What shipped in Seed, briefly.",
    sub: "A short email when it changes",
    shot: "",
  },
]

type Theme = "light" | "dark"
type Form = "desktop" | "mobile"

/** The widths each form is delivered at. The realtime pair is half a desktop wide. */
const WIDTHS: Record<Form, number[]> = { desktop: [1280, 640], mobile: [780, 390] }
const HALF_WIDTHS = [640, 320]

/** Hidden caret, no transitions: added by the test browser, never by the site. */
const STEADY_CSS = `*, *::before, *::after { caret-color: transparent !important;
  transition: none !important; animation: none !important; }`

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>

/** What the screens need from the seeding. */
interface Seeded {
  groupId: string
  noteIds: string[]
  /** The moment every page's clock is fixed at, a few minutes after the data was made. */
  now: Date
  /** Ada's signed-in session on the app host, with two-factor sign-in on. */
  appState: StorageState
  /** API contexts of Ada and Grace, for writes during a capture. */
  ada: Page
  grace: Page
}

const failures: string[] = []

/** Origin headers the API's same-origin guard asks of a write. */
function sameOrigin(): Record<string, string> {
  return { origin: APP, "sec-fetch-site": "same-origin" }
}

/** Throws with the response body unless the status is 200 or 201. */
async function expectOk(
  what: string,
  response: { status(): number; text(): Promise<string> },
): Promise<void> {
  if (![200, 201].includes(response.status())) {
    throw new Error(`${what}: ${response.status()} ${await response.text()}`)
  }
}

async function cleanupPeople(page: Page): Promise<void> {
  for (const person of PEOPLE) {
    const response = await page.request.post(`${APP}/api/test/cleanup-user`, {
      data: { login: person.email },
    })
    await expectOk(`cleanup of ${person.email}`, response)
  }
}

/** Signs `person` up in `page`'s context (the cookie lands there), names them, returns their id. */
async function signUp(page: Page, person: Person): Promise<number> {
  const response = await signUpWithCode(page.request, `${APP}/api/auth/password/sign-up`, {
    headers: sameOrigin(),
    data: { email: person.email, password: PASSWORD },
  })
  await expectOk(`sign-up of ${person.email}`, response)
  const { id } = await response.json() as { id: number }
  const named = await page.request.patch(`${APP}/api/users/me`, {
    headers: sameOrigin(),
    data: { firstName: person.firstName, lastName: person.lastName },
  })
  await expectOk(`name of ${person.email}`, named)
  return id
}

async function createGroup(page: Page, name: string): Promise<string> {
  const id = uuidV7()
  const response = await page.request.post(`${APP}/api/groups`, {
    headers: sameOrigin(),
    data: { id, name },
  })
  await expectOk(`group ${name}`, response)
  return id
}

/** Adds a member through the development route; the product only invites. */
async function addMember(page: Page, person: Person, groupId: string, role: 1 | 2 | 3) {
  const response = await page.request.post(`${APP}/api/test/add-member`, {
    data: { login: person.email, groupId, role },
  })
  await expectOk(`member ${person.email}`, response)
}

/** Changes a member's role as the signed-in owner does, so it is audited and notified. */
async function setRole(page: Page, groupId: string, userId: number, role: 1 | 2 | 3) {
  const response = await page.request.patch(`${APP}/api/groups/${groupId}/members/${userId}`, {
    headers: { ...sameOrigin(), "idempotency-key": uuidV7() },
    data: { role },
  })
  await expectOk(`role of ${userId} in ${groupId}`, response)
}

/**
 * Puts a group on Pro through the development billing provider: the signed webhook Stripe would
 * send after a checkout. Roles other than the default are a Pro feature.
 */
async function upgradeToPro(page: Page, groupId: string): Promise<void> {
  const id = uuidV7().replace(/-/g, "")
  const body = subscriptionEvent({
    reference: groupId,
    subscriptionId: `sub_${id}`,
    customerId: `cus_${id}`,
    currentPeriodEnd: Math.floor(Date.now() / 1000) + 18 * 24 * 3600,
  })
  const webhook = await page.request.post(`${APP}/api/webhooks/billing`, {
    headers: {
      "content-type": "application/json",
      "stripe-signature": await stripeSignature(body),
    },
    data: body,
  })
  await expectOk(`Pro for ${groupId}`, webhook)
}

/** Builds everything the screens show. Each person has a browser context of their own. */
async function seed(browser: Browser, contexts: BrowserContext[], ada: Page): Promise<Seeded> {
  const pageFor = async () => {
    const context = await browser.newContext({ baseURL: APP })
    contexts.push(context)
    return await context.newPage()
  }
  const [grace, linus, margaret] = await Promise.all([pageFor(), pageFor(), pageFor()])
  const adaId = await signUp(ada, ADA)
  await signUp(grace, GRACE)
  const linusId = await signUp(linus, LINUS)
  await signUp(margaret, MARGARET)

  const groupId = await createGroup(ada, "Acme Studio")
  await upgradeToPro(ada, groupId)
  await addMember(ada, GRACE, groupId, 3)
  await addMember(ada, LINUS, groupId, 1)
  await addMember(ada, MARGARET, groupId, 2)
  await setRole(ada, groupId, linusId, 2)
  const selected = await ada.request.put(`${APP}/api/groups/selected`, {
    headers: sameOrigin(),
    data: { groupId },
  })
  await expectOk("selected group", selected)

  // Tags have no REST write: the operations route runs what the socket runs.
  const tagIds = new Map<TagName, string>()
  for (const tag of TAGS) {
    const id = uuidV7()
    const response = await ada.request.post(`${APP}/api/call/tag.create`, {
      headers: { ...sameOrigin(), "x-realtime-user": String(adaId), "idempotency-key": uuidV7() },
      data: { groupId, id, name: tag.name, color: tag.color },
    })
    await expectOk(`tag ${tag.name}`, response)
    tagIds.set(tag.name, id)
  }
  const pages = new Map([[ADA, ada], [GRACE, grace], [LINUS, linus], [MARGARET, margaret]])
  const noteIds: string[] = []
  for (const note of NOTES) {
    const id = uuidV7()
    const response = await pages.get(note.author)!.request.post(
      `${APP}/api/groups/${groupId}/notes`,
      {
        headers: { ...sameOrigin(), "idempotency-key": uuidV7() },
        data: {
          id,
          title: note.title,
          body: note.body,
          tagIds: note.tags.map((tag) => tagIds.get(tag)!),
        },
      },
    )
    await expectOk(`note ${note.title}`, response)
    noteIds.push(id)
  }

  // Ada's inbox: an invitation, a role change and a group handed over.
  const apollo = await createGroup(margaret, "Apollo Guidance")
  const invitation = await margaret.request.post(`${APP}/api/groups/${apollo}/invitations`, {
    headers: sameOrigin(),
    data: { role: 1, email: ADA.email },
  })
  await expectOk("invitation to Ada", invitation)
  const northwind = await createGroup(grace, "Northwind Labs")
  await upgradeToPro(grace, northwind)
  await addMember(grace, ADA, northwind, 1)
  await setRole(grace, northwind, adaId, 3)
  const kernel = await createGroup(linus, "Kernel Notes")
  await addMember(linus, ADA, kernel, 2)
  const transfer = await linus.request.post(`${APP}/api/groups/${kernel}/transfer`, {
    headers: sameOrigin(),
    data: { userId: adaId, name: "Kernel Notes", password: PASSWORD },
  })
  await expectOk("transfer to Ada", transfer)

  // An authenticator, so the profile shows two-factor sign-in on.
  const started = await ada.request.post(`${APP}/api/auth/totp/connect/start`, {
    headers: sameOrigin(),
    data: { password: PASSWORD },
  })
  await expectOk("authenticator start", started)
  const { secret } = await started.json() as { secret: string }
  const finished = await ada.request.post(`${APP}/api/auth/totp/connect/finish`, {
    headers: sameOrigin(),
    data: { otp: await totpCode(secret, currentStep()) },
  })
  await expectOk("authenticator finish", finished)
  // Ada has used the product for a while: her first-steps card is gone from the profile.
  const dismissed = await ada.request.post(`${APP}/api/call/onboarding.dismiss`, {
    headers: {
      ...sameOrigin(),
      "content-type": "application/json",
      "x-realtime-user": String(adaId),
      "idempotency-key": uuidV7(),
    },
    // The operation takes no payload, and the route reads JSON: `null` is both.
    data: "null",
  })
  await expectOk("first-steps card dismissal", dismissed)

  return {
    groupId,
    noteIds,
    now: new Date(Date.now() + 3 * 60_000),
    appState: await ada.context().storageState(),
    ada,
    grace,
  }
}

interface ContextOptions {
  theme: Theme
  form: Form
  state?: StorageState
  /** CSS width of a desktop capture; the realtime pair is half the usual width. */
  width?: number
  /** The page saves a note while it is open, so its clock is the real time. */
  live?: boolean
}

async function openPage(
  browser: Browser,
  contexts: BrowserContext[],
  seeded: Seeded,
  options: ContextOptions,
): Promise<Page> {
  const desktop = options.form === "desktop"
  const context = await browser.newContext({
    baseURL: APP,
    storageState: options.state,
    colorScheme: options.theme,
    reducedMotion: "reduce",
    viewport: desktop ? { width: options.width ?? 1280, height: 800 } : { width: 390, height: 844 },
    deviceScaleFactor: desktop ? 2 : 3,
    isMobile: !desktop,
    hasTouch: !desktop,
    locale: "en-GB",
    timezoneId: "Europe/London",
  })
  contexts.push(context)
  const page = await context.newPage()
  // A note saved during the capture is "just now"; the seeded ones are a few minutes old.
  await page.clock.setFixedTime(options.live ? new Date() : seeded.now)
  return page
}

/** Scrolls so `target`'s top sits just under the window's top edge: the shell has no header bar. */
async function scrollToTop(target: Locator): Promise<void> {
  await target.evaluate((element) => {
    globalThis.scrollTo({ top: element.getBoundingClientRect().top + globalThis.scrollY - 16 })
  })
}

/** Waits until the page is still, then writes the master PNG, of `clip` alone when given. */
async function snap(page: Page, name: string, clip?: Clip): Promise<void> {
  await page.addStyleTag({ content: STEADY_CSS })
  await page.waitForLoadState("networkidle")
  await page.evaluate(() => document.fonts.ready)
  // A focused control shows its ring; a picture has no keyboard user.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  // Nor a pointer: a row under the last click would show its hover colour.
  const viewport = page.viewportSize()!
  await page.mouse.move(viewport.width - 2, viewport.height / 2)
  await page.waitForTimeout(300)
  await page.screenshot({
    path: `${MASTERS}/${name}.png`,
    animations: "disabled",
    caret: "hide",
    clip,
  })
}

/** A part of the viewport, in CSS pixels. */
interface Clip {
  x: number
  y: number
  width: number
  height: number
}

/** A screen that only reads: opened in each theme and form, waited for, and arranged. */
interface Screen {
  name: string
  forms: Form[]
  open(page: Page, seeded: Seeded): Promise<void>
  /** The part of the viewport the picture keeps; the whole viewport when absent. */
  clip?: Clip
}

/** The group's Plan and billing tab, scrolled so the tab's title sits at the top. */
async function openBilling(page: Page, seeded: Seeded): Promise<void> {
  await gotoApp(
    page,
    `/groups/${seeded.groupId}/billing`,
    page.locator("[data-e2e=billing-plan][data-plan=pro]"),
  )
  await scrollToTop(page.locator("[data-e2e=group-section-billing]"))
}

const SCREENS: Screen[] = [
  {
    name: "notes",
    forms: ["desktop", "mobile"],
    async open(page) {
      await gotoApp(page, "/notes", page.locator("[data-e2e=note-item-title]").nth(5))
    },
  },
  {
    name: "profile-security",
    forms: ["desktop"],
    async open(page) {
      await gotoApp(page, "/profile/security", page.locator("[data-e2e=totp-disable]"))
    },
  },
  {
    name: "group-members",
    forms: ["desktop"],
    async open(page, seeded) {
      await gotoApp(
        page,
        `/groups/${seeded.groupId}/members`,
        page.locator("[data-e2e=group-member]").nth(3),
      )
      // Linus's menu open: the roles an owner hands out, which the billing picture lacks.
      await page.locator("[data-e2e=group-member-menu]").nth(1).click()
      await page.getByRole("menuitem", { name: "Make Viewer" }).waitFor()
      // The menu focuses its first item a frame after it opens, which scrolls the page; the
      // members go back to the top only after that.
      await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "menuitem")
      await scrollToTop(page.locator("[data-e2e=group-section-members]"))
    },
  },
  {
    name: "billing",
    forms: ["desktop"],
    open: openBilling,
  },
  {
    // The home page's billing card: the plan alone, on a phone, from the canvas above its
    // "Plan and billing" title to the canvas below the "Pro plan" card.
    name: "billing-plan",
    forms: ["mobile"],
    open: openBilling,
    clip: { x: 0, y: 144, width: 390, height: 208 },
  },
  {
    name: "notifications",
    forms: ["desktop"],
    async open(page) {
      await gotoApp(page, "/notifications", page.locator("[data-e2e=notification-text]").nth(2))
    },
  },
  {
    name: "activity",
    forms: ["desktop"],
    async open(page, seeded) {
      await gotoApp(
        page,
        `/groups/${seeded.groupId}/activity`,
        page.locator("[data-e2e=activity-text]").nth(5),
      )
    },
  },
  {
    name: "sign-in",
    forms: ["mobile"],
    async open(page) {
      await gotoApp(page, "/sign-in", page.locator("[data-e2e=auth-form-login]"))
      await page.locator("[data-e2e=auth-form-login]").fill(ADA.email)
    },
  },
]

/** Runs `shoot`, recording a failure instead of stopping, so one broken screen does not hide others. */
async function attempt(name: string, shoot: () => Promise<void>): Promise<void> {
  try {
    await shoot()
    console.log(`captured ${name}`)
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message.split("\n")[0] : error}`)
    console.error(`FAILED ${name}`, error)
  }
}

async function captureScreens(browser: Browser, contexts: BrowserContext[], seeded: Seeded) {
  for (const theme of ["light", "dark"] as const) {
    for (const screen of SCREENS) {
      for (const form of screen.forms) {
        const name = `${screen.name}-${theme}-${form}`
        await attempt(name, async () => {
          const signedOut = screen.name === "sign-in"
          const page = await openPage(browser, contexts, seeded, {
            theme,
            form,
            state: signedOut ? undefined : seeded.appState,
          })
          try {
            await screen.open(page, seeded)
            await snap(page, name, screen.clip)
          } finally {
            await page.context().close()
          }
        })
      }
    }
  }
  // These change a note, so they run after every screen that lists notes, and both realtime
  // pictures come before the conflict moves its note to the top of the list.
  for (const theme of ["light", "dark"] as const) {
    await attempt(`realtime-${theme}`, () => captureRealtime(browser, contexts, seeded, theme))
  }
  for (const theme of ["light", "dark"] as const) {
    await attempt(
      `offline-conflict-${theme}`,
      () => captureConflict(browser, contexts, seeded, theme),
    )
  }
}

/**
 * The same note on two devices: one edits its title, and the other's list shows the saved title
 * without a reload.
 */
async function captureRealtime(
  browser: Browser,
  contexts: BrowserContext[],
  seeded: Seeded,
  theme: Theme,
): Promise<void> {
  const noteId = seeded.noteIds[5]
  const options = {
    theme,
    form: "desktop",
    state: seeded.appState,
    width: 640,
    live: true,
  } as const
  const a = await openPage(browser, contexts, seeded, options)
  const b = await openPage(browser, contexts, seeded, options)
  try {
    await gotoApp(a, `/notes/${noteId}`, a.locator("[data-e2e=note-title]"))
    await gotoApp(b, "/notes", b.locator("[data-e2e=note-item-title]").nth(5))
    const title = "Q4 roadmap: onboarding, billing and invoices"
    await a.locator("[data-e2e=note-title]").fill(title)
    await snap(a, `realtime-a-${theme}-desktop`)
    await a.locator("[data-e2e=note-save]").click()
    await b.locator("[data-e2e=note-item-title]", { hasText: title }).waitFor()
    await snap(b, `realtime-b-${theme}-desktop`)
  } finally {
    await a.context().close()
    await b.context().close()
    // The title goes back, so the next theme starts from the same note.
    await saveTitle(seeded.ada, seeded, noteId, NOTES[5].title)
  }
}

interface Note {
  body: string
  version: number
}

/** Saves a note's title through `as`'s API context, at the version the server holds. */
async function saveTitle(as: Page, seeded: Seeded, noteId: string, title: string): Promise<void> {
  const url = `${APP}/api/groups/${seeded.groupId}/notes/${noteId}`
  const current = await as.request.get(url)
  await expectOk("note read", current)
  const read = await current.json() as { note?: Note } & Note
  const note = read.note ?? read
  const saved = await as.request.patch(url, {
    headers: { ...sameOrigin(), "idempotency-key": uuidV7() },
    data: { title, body: note.body, version: note.version },
  })
  await expectOk("note save", saved)
}

/** An edit made offline meets Grace's newer one on the server: the chooser lists both. */
async function captureConflict(
  browser: Browser,
  contexts: BrowserContext[],
  seeded: Seeded,
  theme: Theme,
): Promise<void> {
  const noteId = seeded.noteIds[2]
  const page = await openPage(browser, contexts, seeded, {
    theme,
    form: "desktop",
    state: seeded.appState,
    live: true,
  })
  try {
    await gotoApp(page, `/notes/${noteId}`, page.locator("[data-e2e=note-title]"))
    await page.locator("[data-e2e=shell-ws-status]", { hasText: "Online" }).waitFor()
    await page.context().setOffline(true)
    await page.locator("[data-e2e=note-title]").fill("Checkout fails for EU VAT numbers (fixed)")
    await page.locator("[data-e2e=note-save]").click()
    await saveTitle(seeded.grace, seeded, noteId, "Checkout fails for EU VAT numbers with spaces")
    await page.context().setOffline(false)
    await page.locator("[data-e2e=offline-status] li").first().waitFor({ timeout: 30_000 })
    // The editor's "Note saved" toast would cover the list; the picture is about the conflict.
    const saved = page.locator("[data-e2e=note-saved]")
    if (await saved.isVisible()) await saved.getByRole("button").click()
    await saved.waitFor({ state: "detached" })
    await snap(page, `offline-conflict-${theme}-desktop`)
  } finally {
    await page.context().close()
    await saveTitle(seeded.ada, seeded, noteId, NOTES[2].title)
  }
}

/** Runs a command and throws with its error output when it fails. */
async function run(command: string, args: string[]): Promise<void> {
  const { code, stderr } = await new Deno.Command(command, { args, stdout: "null" }).output()
  if (code !== 0) {
    throw new Error(`${command} ${args.join(" ")}: ${new TextDecoder().decode(stderr)}`)
  }
}

/**
 * Encodes every master into its delivered widths with `cwebp`. Quality starts at 80 and steps down
 * until the file fits its budget: the notes hero 90 KB at 1280, every other file 70 KB.
 */
async function encodeShots(): Promise<void> {
  for await (const entry of Deno.readDir(MASTERS)) {
    const match = entry.name.match(/^(.+)-(light|dark)-(desktop|mobile)\.png$/)
    if (!match) continue
    const [, name, theme, form] = match
    const widths = name.startsWith("realtime-") ? HALF_WIDTHS : WIDTHS[form as Form]
    for (const width of widths) {
      const target = `${SHOTS}/${name}-${theme}-${width}.webp`
      const budget = (name === "notes" && width === 1280 ? 90 : 70) * 1024
      let quality = 80
      for (;;) {
        await run("cwebp", [
          ...["-quiet", "-mt", "-m", "6", "-q", String(quality)],
          ...["-resize", String(width), "0", `${MASTERS}/${entry.name}`, "-o", target],
        ])
        if ((await Deno.stat(target)).size <= budget || quality <= 50) break
        quality -= 5
      }
      if ((await Deno.stat(target)).size > budget) {
        failures.push(`${target} is over its budget at quality ${quality}`)
      }
    }
  }
}

/** Downloads the pinned `geist` package once, checks its integrity and unpacks the two fonts. */
async function geistFonts(): Promise<void> {
  const fontsReady = await Promise.all(
    Object.keys(GEIST.files).map((name) =>
      Deno.stat(`${CACHE}/${name}`).then(() => true, () => false)
    ),
  )
  if (fontsReady.every(Boolean)) return
  const response = await fetch(GEIST.url)
  if (!response.ok) throw new Error(`${GEIST.url}: ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-512", bytes))
  const integrity = `sha512-${btoa(String.fromCharCode(...digest))}`
  if (integrity !== GEIST.integrity) throw new Error(`${GEIST.url} does not match its integrity`)
  const archive = `${CACHE}/geist.tgz`
  await Deno.writeFile(archive, bytes)
  await run("tar", ["-xzf", archive, "-C", CACHE, ...Object.values(GEIST.files)])
  for (const [name, path] of Object.entries(GEIST.files)) {
    await Deno.rename(`${CACHE}/${path}`, `${CACHE}/${name}`)
  }
  await Deno.remove(`${CACHE}/package`, { recursive: true })
  await Deno.remove(archive)
}

/**
 * Renders `og.html` once per page at 1200×630. The page is served from a made-up origin that maps
 * to this app's files and the cached fonts, so it needs no server and loads nothing from outside.
 */
async function renderOgImages(browser: Browser, contexts: BrowserContext[]): Promise<void> {
  await geistFonts()
  const context = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  })
  contexts.push(context)
  const origin = "http://og.invalid"
  await context.route(`${origin}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname
    const file = path.startsWith("/fonts/") ? `${CACHE}/${path.slice(7)}` : `${MPA}${path.slice(1)}`
    try {
      await route.fulfill({ path: file })
    } catch {
      await route.fulfill({ status: 404 })
    }
  })
  await context.route((url) => !url.href.startsWith(origin), (route) => route.abort())
  try {
    for (const card of OG_CARDS) {
      await attempt(`og-${card.file}`, async () => {
        const page = await context.newPage()
        const query = new URLSearchParams({
          eyebrow: card.eyebrow,
          title: card.title,
          sub: card.sub,
          shot: card.shot ? `/static/${card.shot}` : "",
          top: String(card.top ?? 0),
          width: String(card.width ?? 860),
        })
        await page.goto(`${origin}/screenshots/og.html?${query}`)
        await page.evaluate(() => document.fonts.ready)
        await page.locator("body[data-ready]").waitFor({ state: "attached" })
        const master = `${MASTERS}/og-${card.file}.png`
        await page.screenshot({ path: master })
        await page.close()
        const target = `${OG}/${card.file}.png`
        await run("magick", [master, "-strip", "-define", "png:compression-level=9", target])
        if ((await Deno.stat(target)).size > 150 * 1024) {
          // A screenshot has too many colours for 150 KB: 256 of them, dithered, fit.
          await run("magick", [
            ...[master, "-strip", "-dither", "FloydSteinberg", "-colors", "256"],
            ...["-define", "png:compression-level=9", `PNG8:${target}`],
          ])
        }
        if ((await Deno.stat(target)).size > 150 * 1024) {
          failures.push(`${target} is over 150 KB`)
        }
      })
    }
  } finally {
    await context.close()
  }
}

async function main(): Promise<void> {
  const ogOnly = Deno.args.includes("--og-only")
  for (const dir of [MASTERS, CACHE, SHOTS, OG]) await Deno.mkdir(dir, { recursive: true })
  const browser = await chromium.launch()
  const contexts: BrowserContext[] = []
  try {
    if (!ogOnly) {
      const adaContext = await browser.newContext({ baseURL: APP })
      contexts.push(adaContext)
      const ada = await adaContext.newPage()
      await cleanupPeople(ada)
      try {
        const seeded = await seed(browser, contexts, ada)
        await captureScreens(browser, contexts, seeded)
      } finally {
        await cleanupPeople(ada)
      }
      await encodeShots()
    }
    await renderOgImages(browser, contexts)
  } finally {
    for (const context of contexts) await context.close().catch(() => {})
    await browser.close()
  }
  if (failures.length) {
    console.error(`\n${failures.length} failed:\n${failures.join("\n")}`)
    Deno.exit(1)
  }
  console.log(`Done: ${SHOTS} and ${OG}`)
}

if (import.meta.main) await main()
