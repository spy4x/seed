/// <reference lib="deno.ns" />
/**
 * Records Seed's demo video, "From an empty folder to the app and the admin panel", end to end on
 * this machine, and encodes it into `media/demo/` (see README.md beside this file).
 *
 * `deno task demo-video` records and encodes. `deno task demo-video --encode` only encodes the last
 * take again (`media/demo/.take/`, gitignored), after a change to `captions.vtt` or the music.
 *
 * What it does:
 *
 * 1. In a terminal (ttyd in a browser page, a staged home): `git clone` of Seed from GitHub,
 *    `deno task init`, `deno task dev`. Long waits play faster, and the caption says so.
 * 2. Off camera, between `init` and `dev`, the env file gets hosts and ports of its own
 *    (`my-product.localhost`, spare ports), so the stack runs beside any other Seed stack here.
 *    After `dev`: the development seed (`deno task db:seed`), and the sign-ins of the Product
 *    team's owner in the app and of the seed's administrator in the admin app (`stage.ts`).
 * 3. In the browser: the team's notes, a new note with a tag, the group's members, the admin
 *    panel's people, one teammate's sessions, groups and activity, and the new note on top.
 * 4. `encode.ts` adds the title and end cards, burns in the captions this run wrote to
 *    `captions.vtt`, lays the music under it, and writes the videos and posters.
 *
 * On exit, failed, stopped with Ctrl-C (SIGINT) or SIGTERM, or not, it removes the stack's
 * containers, volumes and images, its temporary folder, and Traefik and the `proxy` network only
 * when this run started them.
 */
import { type Browser, type BrowserContext, chromium, type Locator, type Page } from "playwright"
import { encodeDemo, CARD_SECONDS } from "./encode.ts"
import { clickLike, moveLike, parkLike, type Point, scrollLike } from "./human-mouse.ts"
import { type Screen, sleep, Take } from "./take.ts"
import { openTerminal, type Terminal } from "./terminal.ts"
import { stage } from "./stage.ts"

const OUT = new URL("../", import.meta.url).pathname.replace(/\/$/, "")
const TAKE = `${OUT}/.take`
const RECIPE = new URL("./", import.meta.url).pathname

const PROJECT = "my-product"
const REPOSITORY = "https://github.com/spy4x/seed.git"
const HOSTS = { app: `http://${PROJECT}.localhost`, admin: `http://admin.${PROJECT}.localhost` }
/** The seeded group the video shows, and the title typed in it: made up. */
const GROUP = "Product team"
const NEW_NOTE = "Launch checklist for Friday"
const TAG = "roadmap"

/** Every frame is 2560×1600; the encoder scales it to 1280×800. */
const FRAME = { width: 2560, height: 1600 }
/** The pages are drawn at 960×600 CSS pixels, a third larger than 1280×800: readable when small. */
const PAGE_VIEWPORT = { width: 960, height: 600 }
/** A wait longer than this plays in about this long. */
const SQUEEZED_S = 1.6

const TITLE = "Seed"
const CLAIM = "The groundwork of your SaaS, already built"
const END = "github.com/spy4x/seed"

const pause = (ms: number) => sleep(ms)

/** Runs a command and returns its standard output; throws with its error output when it fails. */
async function run(cmd: string[], options: { cwd?: string; env?: Record<string, string> } = {}) {
  const result = await new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd: options.cwd,
    env: options.env,
    stdout: "piped",
    stderr: "piped",
  }).output()
  const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes).trim()
  if (!result.success) throw new Error(`${cmd.join(" ")} failed: ${text(result.stderr).slice(-2000)}`)
  return text(result.stdout)
}

/** Whether `cmd` succeeds, quietly. */
async function ok(cmd: string[], cwd?: string): Promise<boolean> {
  const { success } = await new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd,
    stdout: "null",
    stderr: "null",
  }).output()
  return success
}

/** A free TCP port on the loopback interface. */
function freePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 })
  const { port } = listener.addr as Deno.NetAddr
  listener.close()
  return port
}

/** Sets `key` to `value` in an env file's text, on the last line that sets it. */
function setEnv(text: string, key: string, value: string): string {
  const lines = text.split("\n")
  const at = lines.findLastIndex((line) => line.startsWith(`${key}=`))
  if (at === -1) throw new Error(`the env file has no ${key}`)
  lines[at] = `${key}=${value}`
  return lines.join("\n")
}

/** An env file's value of `key`, without a trailing comment. */
function envValue(text: string, key: string): string {
  const line = text.split("\n").findLast((l) => l.startsWith(`${key}=`))
  if (line === undefined) throw new Error(`the env file has no ${key}`)
  return line.slice(key.length + 1).replace(/\s+#.*$/, "").trim()
}

/** Types a command, runs it, and plays a long wait for it faster. Fails when it fails. */
async function command(take: Take, term: Terminal, text: string, seconds = 120): Promise<void> {
  await term.type(text)
  await pause(400)
  await term.enter()
  await take.split()
  const code = await term.done(seconds)
  squeeze(await take.split())
  if (code !== 0) throw new Error(`"${text}" exited with ${code}`)
}

/** Plays a shot that lasted longer than {@link SQUEEZED_S} in about that long. */
function squeeze(shot: { start: number; end: number; speed: number }): void {
  const length = shot.end - shot.start
  if (length > SQUEEZED_S) shot.speed = length / SQUEEZED_S
}

/** The terminal part: clone, init, then (after the off-camera env edit) dev. */
async function terminalPart(take: Take, term: Terminal, screen: Screen, app: string) {
  await take.begin(screen)
  await pause(500)
  await take.caption("Clone Seed into a new folder{fast}")
  await command(take, term, `git clone ${REPOSITORY} ${PROJECT}`, 600)
  await pause(250)
  await command(take, term, `cd ${PROJECT}`)
  await pause(300)

  await take.caption("One command writes the env file with fresh secrets{fast}")
  await term.type("deno task init")
  await pause(400)
  await term.enter()
  await take.split()
  const rows = term.page.locator(".xterm-rows")
  for (const deadline = Date.now() + 600_000; !(await rows.innerText()).includes("Project name");) {
    if (Date.now() > deadline) throw new Error("init asked for no project name within 10 min")
    await sleep(250)
  }
  squeeze(await take.split())
  await pause(800)
  await term.enter()
  if (await term.done(60) !== 0) throw new Error("deno task init failed")
  await take.readPrevious(0.8)
  take.end()

  // Off camera: hosts and ports of its own, and the admin app instead of the monitoring stack.
  const envPath = `${app}/infra/envs/.env`
  let env = await Deno.readTextFile(envPath)
  for (
    const [key, value] of [
      ["DOMAIN", new URL(HOSTS.app).host],
      ["ADMIN_DOMAIN", new URL(HOSTS.admin).host],
      ["COMPOSE_PROFILES", "admin"],
      ["DB_HOST_PORT", `127.0.0.1:${freePort()}`],
      ["KV_HOST_PORT", `127.0.0.1:${freePort()}`],
      ["GRAFANA_HOST_PORT", `127.0.0.1:${freePort()}`],
    ]
  ) env = setEnv(env, key, value)
  await Deno.writeTextFile(envPath, env)

  await take.begin(screen)
  await pause(500)
  await take.caption("deno task dev builds and starts every service{fast}")
  await command(take, term, "deno task dev", 1800)
  await pause(500)
  await take.caption("Every service is up")
  await pause(600)
  await take.readPrevious(0.6)
  take.end()
}

/** Waits until `url` answers 200; the proxy routes a host once its dev server is healthy. */
async function waitFor(url: string, seconds: number): Promise<void> {
  const deadline = Date.now() + seconds * 1000
  while (true) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      await response.body?.cancel()
      if (response.ok) return
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`${url} did not answer within ${seconds} s`)
    await sleep(2000)
  }
}

/** A recording context: the page size, the dark theme, the drawn pointer and key caps. */
async function recordingContext(
  browser: Browser,
  storageState: Awaited<ReturnType<BrowserContext["storageState"]>>,
  userAgent: string,
  start: Point,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: PAGE_VIEWPORT,
    deviceScaleFactor: FRAME.width / PAGE_VIEWPORT.width,
    colorScheme: "dark",
    locale: "en-GB",
    timezoneId: "Etc/UTC",
    userAgent,
    storageState,
  })
  // The click mark keeps its 64 px on the finished video at this page scale.
  await context.addInitScript(
    `window.__demoPointerOptions = ${JSON.stringify({ ...start, mark: 48 })}`,
  )
  await context.addInitScript({ path: `${RECIPE}pointer.js` })
  await context.addInitScript({ path: `${RECIPE}keys.js` })
  return context
}

/** Opens `url` and waits for `ready`, loading again when a cold dev server stalls. */
async function open(page: Page, url: string, ready: string): Promise<void> {
  for (let attempt = 1;; attempt++) {
    try {
      await page.goto(url, { timeout: 120_000 })
      await page.locator(ready).first().waitFor({ timeout: 120_000 })
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {})
      return
    } catch (error) {
      if (attempt === 3) throw error
    }
  }
}

/** How long a page may take to answer a click on camera; the rest of the wait plays faster. */
const ANSWER_S = 0.5
/** Typing pace on camera, in seconds a key, however long the keys took to reach the page. */
const KEY_S = 0.065

/** Clicks `field` like a person, then types `text` at {@link KEY_S} a key. */
async function typeAtPace(take: Take, page: Page, pointer: Point, field: Locator, text: string) {
  await clickLike(page, pointer, field)
  await take.within(text.length * KEY_S, () => page.keyboard.type(text, { delay: 55 }))
}

const NOTE_TITLE = "[data-e2e=note-item-title]"
const USERS = "[data-e2e=admin-users-list] tbody tr"

/** The browser part: the app, the admin panel, then the new note in the app again. */
async function browserPart(
  take: Take,
  browser: Browser,
  states: Awaited<ReturnType<typeof stage>>,
  userAgent: string,
  teammate: string,
): Promise<void> {
  const appStart = { x: 620, y: 330 }
  const app = await (await recordingContext(browser, states.app, userAgent, appStart)).newPage()
  const admin = await (await recordingContext(browser, states.admin, userAgent, { x: 600, y: 330 }))
    .newPage()

  // Off camera: open every screen once, so a cold dev server compiles nothing on camera.
  await open(app, `${HOSTS.app}/groups`, `a:has-text("${GROUP}")`)
  await open(app, `${HOSTS.app}/notes`, NOTE_TITLE)
  await app.locator("[data-e2e=note-new]").click()
  await app.locator("[data-e2e=note-title]").waitFor({ timeout: 120_000 })
  await open(admin, `${HOSTS.admin}/users?q=${encodeURIComponent(teammate)}`, USERS)
  await admin.getByRole("link", { name: teammate }).click()
  await admin.locator("[data-e2e=admin-user-title]").waitFor({ timeout: 120_000 })
  await open(admin, `${HOSTS.admin}/users`, USERS)
  await open(app, `${HOSTS.app}/notes`, NOTE_TITLE)

  const appScreen = await take.watch(app, FRAME)
  const adminScreen = await take.watch(admin, FRAME)
  try {
    // The poster: the team's notes, without the pointer.
    await app.evaluate(`__demoPointerVisible(false)`)
    await app.screenshot({ path: `${TAKE}/poster.png` })
    await app.evaluate(`__demoPointerVisible(true)`)
    await app.mouse.move(appStart.x, appStart.y)
    const pa = { ...appStart }

    await take.begin(appScreen)
    await take.caption("The app, with a team's sample notes and tags")
    await pause(1200)
    await take.readPrevious(0.4)
    await take.caption("Write a note and tag it")
    await clickLike(app, pa, app.locator("[data-e2e=note-new]"), { scroll: false })
    await take.within(ANSWER_S, () => app.locator("[data-e2e=note-title]").waitFor())
    await pause(300)
    await typeAtPace(take, app, pa, app.locator("[data-e2e=note-title]"), NEW_NOTE)
    await pause(300)
    await clickLike(app, pa, app.getByRole("button", { name: TAG, exact: true }))
    await pause(400)
    await take.caption("Create it, and the whole team can read it")
    await clickLike(app, pa, app.getByRole("button", { name: "Create note" }))
    // The note's page shows "Loading the note…" first, then the note under its title.
    await take.within(ANSWER_S, () =>
      app.waitForFunction((title) =>
        document.querySelector("h1")?.textContent?.trim() === title &&
        !document.body.innerText.includes("Loading the note"), NEW_NOTE, { timeout: 60_000 }))
    await parkLike(app, pa)
    await pause(1500)
    await take.readPrevious(0.3)

    await take.caption("Every group has members, each with a role")
    await clickLike(app, pa, app.getByRole("link", { name: "Groups" }).first(), { scroll: false })
    const group = app.getByRole("link", { name: new RegExp(GROUP) })
    await take.within(ANSWER_S, () => group.waitFor())
    await pause(400)
    await clickLike(app, pa, group)
    await take.within(ANSWER_S, () => app.getByText(/^Members \(\d+\)$/).waitFor())
    await pause(400)
    await moveLike(app, pa, { x: 620, y: 360 })
    const members = await app.getByText(/^Members \(\d+\)$/).boundingBox()
    if (!members) throw new Error("no Members heading")
    await scrollLike(app, Math.round(members.y - 90))
    await pause(900)
    await take.readPrevious(0.3)
    take.end()

    const pb = { x: 600, y: 330 }
    await take.begin(adminScreen)
    await take.caption("The admin panel, on its own host: find a teammate")
    await pause(300)
    await typeAtPace(take, admin, pb, admin.locator("[data-e2e=admin-users-search]"), teammate)
    await pause(400)
    await take.within(ANSWER_S, async () => {
      await admin.keyboard.press("Enter")
      await admin.waitForURL(/\?q=/)
      await admin.getByRole("link", { name: teammate }).waitFor()
    })
    await pause(900)
    await clickLike(admin, pb, admin.getByRole("link", { name: teammate }))
    await take.within(ANSWER_S, () => admin.locator("[data-e2e=admin-user-title]").waitFor())
    await pause(800)
    await take.readPrevious(0.2)
    await take.caption("Their sessions, groups and activity, at a glance")
    for (const tab of [/^Sessions/, /^Groups/, /^Activity/]) {
      await clickLike(admin, pb, admin.getByRole("tab", { name: tab }), { scroll: false })
      await pause(600)
    }
    await parkLike(admin, pb)
    await pause(300)
    await take.readPrevious(0.2)
    take.end()

    // The result: the new note on top of the team's list.
    await open(app, `${HOSTS.app}/notes`, NOTE_TITLE)
    const top = (await app.locator(NOTE_TITLE).first().textContent())?.trim()
    if (top !== NEW_NOTE) throw new Error(`the newest note is "${top}", not the new one`)
    await take.begin(appScreen)
    await take.caption("The new note now leads the team's list")
    await pause(1500)
    await take.readPrevious(0.3)
    take.end()
  } finally {
    await take.stop([appScreen, adminScreen])
  }
}

/** The Product team's owner, who uses the app, the group's id, and the teammate to look up. */
async function people(app: string, user: string, database: string) {
  const sql = (query: string) =>
    run(["docker", "exec", `${PROJECT}-db`, "psql", "-U", user, "-d", database, "-At", "-c", query], {
      cwd: app,
    })
  const group = await sql(`select id from groups where name = '${GROUP}'`)
  const owner = await sql(
    `select k.email from group_members m join auth_keys k on k.user_id = m.user_id
     join users u on u.id = m.user_id
     where m.group_id = '${group}' and m.role = 4 and k.method = 'password' and u.mfa = 1`,
  )
  const teammate = await sql(
    `select u.first_name || ' ' || u.last_name from group_members m join users u on u.id = m.user_id
     where m.group_id = '${group}' and m.role < 4
     order by (select count(*) from auth_sessions s where s.user_id = u.id) desc, u.id limit 1`,
  )
  if (!group || !owner || !teammate) {
    throw new Error(`the seed has no "${GROUP}" with an owner who signs in with a password`)
  }
  return { group, owner, teammate }
}

/** Records the whole take into {@link TAKE}. */
async function record(): Promise<void> {
  const existing = await run(["docker", "ps", "-a", "--format", "{{.Names}}"])
  if (existing.split("\n").some((name) => name.startsWith(`${PROJECT}-`))) {
    throw new Error(`containers named ${PROJECT}-* exist; this recording needs that name`)
  }
  const traefikBefore = existing.split("\n").includes("traefik")
  const networkBefore = await ok(["docker", "network", "inspect", "proxy"])

  await Deno.remove(TAKE, { recursive: true }).catch(() => {})
  await Deno.mkdir(`${TAKE}/frames`, { recursive: true })
  const work = await Deno.makeTempDir({ prefix: "seed-demo-" })
  const projects = `${work}/projects`
  const app = `${projects}/${PROJECT}`
  await Deno.mkdir(projects)
  const take = new Take(`${TAKE}/frames`)
  // Playwright's own signal handlers would close the browser and exit before the cleanup below.
  const browser = await chromium.launch({
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  })
  let term: Terminal | null = null
  // Deno skips `finally` when a signal ends the process, so Ctrl-C and SIGTERM run the same
  // cleanup themselves, once, and then exit.
  let released: Promise<void> | null = null
  const release = () =>
    released ??= (async () => {
      await term?.close().catch(() => {})
      await browser.close().catch(() => {})
      await cleanup(app, traefikBefore, networkBefore)
      // The containers write the database files and Vite's caches as their own users.
      await ok(["sudo", "-n", "find", work, "-delete"])
    })()
  const listeners = ([["SIGINT", 130], ["SIGTERM", 143]] as const).map(([signal, code]) => {
    const listener = () => {
      console.error(`${signal}: removing the stack, then exiting`)
      release().finally(() => Deno.exit(code))
    }
    Deno.addSignalListener(signal, listener)
    return [signal, listener] as const
  })
  try {
    const agent = await browser.newPage()
    const userAgent = (await agent.evaluate(() => navigator.userAgent)).replace("Headless", "")
    await agent.close()

    term = await openTerminal(browser, work, projects)
    const termScreen = await take.watch(term.page, FRAME)
    await terminalPart(take, term, termScreen, app)
    await take.stop([termScreen])
    await term.close()
    term = null

    const env = await Deno.readTextFile(`${app}/infra/envs/.env`)
    await waitFor(`${HOSTS.app}/sign-in`, 900)
    await waitFor(`${HOSTS.admin}/sign-in`, 900)
    const dbUser = envValue(env, "DB_USER")
    await run(["deno", "task", "db:seed"], {
      cwd: app,
      env: {
        ENV: "dev",
        DB_HOST: "127.0.0.1",
        DB_PORT: envValue(env, "DB_HOST_PORT").split(":")[1],
        DB_USER: dbUser,
        DB_PASS: envValue(env, "DB_PASS"),
        DB_NAME: envValue(env, "DB_NAME"),
        AUTH_PEPPER: envValue(env, "AUTH_PEPPER"),
        SEED_PASSWORD: envValue(env, "SEED_PASSWORD"),
      },
    })
    const { group, owner, teammate } = await people(app, dbUser, envValue(env, "DB_NAME"))
    const states = await stage(
      browser,
      HOSTS,
      envValue(env, "SEED_PASSWORD"),
      userAgent,
      { email: owner, groupId: group },
    )
    await browserPart(take, browser, states, userAgent, teammate)

    await writeTake(take)
    await Deno.writeTextFile(`${OUT}/captions.vtt`, take.vtt(CARD_SECONDS.title))
    console.log(`take: ${take.seconds().toFixed(1)} s in ${take.shots.length} shots`)
  } finally {
    await release()
    for (const [signal, listener] of listeners) Deno.removeSignalListener(signal, listener)
  }
}

/**
 * Writes the take as one lossless 1280×800, 30 fps video, `take.mkv`, from one frame per slot,
 * and drops the frames.
 */
async function writeTake(take: Take): Promise<void> {
  const seq = `${TAKE}/seq`
  await Deno.mkdir(seq)
  for (const [i, file] of take.sequence().entries()) {
    await Deno.link(file, `${seq}/${String(i).padStart(6, "0")}.jpg`)
  }
  await run([
    ...["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-threads", "2"],
    ...["-framerate", "30", "-i", `${seq}/%06d.jpg`],
    ...["-vf", "scale=1280:800:flags=lanczos:out_range=tv"],
    ...["-c:v", "libx264", "-qp", "0", "-preset", "veryfast", "-pix_fmt", "yuv444p"],
    `${TAKE}/take.mkv`,
  ])
  await Deno.remove(seq, { recursive: true })
  await Deno.remove(`${TAKE}/frames`, { recursive: true })
}

/** Removes the stack this run started, its volumes and images, and Traefik if it was ours. */
async function cleanup(app: string, traefikBefore: boolean, networkBefore: boolean) {
  const compose = [
    ..."docker compose -f infra/compose/compose.shared.yml -f infra/compose/compose.dev.yml".split(" "),
    ...["--env-file", "infra/envs/.env"],
  ]
  if (await Deno.stat(`${app}/infra/envs/.env`).catch(() => null)) {
    await ok([...compose, "down", "-v", "--rmi", "local", "--timeout", "5"], app)
    if (!traefikBefore) {
      await ok(["docker", "compose", "-f", "infra/compose/compose.proxy.yml", "--env-file",
        "infra/envs/.env", "down"], app)
    }
  }
  const images = await run(["docker", "images", "-q", `${PROJECT}/*`]).catch(() => "")
  for (const image of images.split("\n").filter(Boolean)) await ok(["docker", "rmi", image])
  if (!networkBefore) await ok(["docker", "network", "rm", "proxy"])
}

/** Encodes the last take into `media/demo/`. */
async function encode(): Promise<void> {
  await encodeDemo({
    take: `${TAKE}/take.mkv`,
    out: OUT,
    title: TITLE,
    claim: CLAIM,
    end: END,
    poster: `${TAKE}/poster.png`,
  })
}

if (import.meta.main) {
  if (!Deno.args.includes("--encode")) await record()
  await encode()
}
