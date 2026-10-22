/// <reference lib="deno.ns" />
/**
 * The terminal part of the demo video: a bash shell served by ttyd and shown in a browser page, so
 * the same screencast records it as the app. The shell starts in a staged home with its own
 * prompt; nothing of the recorder's own home, prompt or history shows.
 *
 * Every command is typed at a person's pace. The shell writes a line to a log each time it shows a
 * prompt, which is how the recorder knows a command has finished.
 */
import type { Browser, Page } from "playwright"
import { sleep } from "./take.ts"

/** The page the terminal is drawn in, at the clip's size: 22 px text, as the video rules ask. */
export const TERMINAL_VIEWPORT = { width: 1280, height: 800 }

const THEME = {
  background: "#16181e",
  foreground: "#e8e9ed",
  cursor: "#8bd17c",
  black: "#16181e",
  red: "#f28b82",
  green: "#8bd17c",
  yellow: "#e8c37a",
  blue: "#8ec5ec",
  magenta: "#c9a2e8",
  cyan: "#8ed4cf",
  white: "#e8e9ed",
  brightBlack: "#7c8190",
  brightRed: "#f28b82",
  brightGreen: "#a3dd96",
  brightYellow: "#f0d08f",
  brightBlue: "#a6d3f2",
  brightMagenta: "#d6b6ef",
  brightCyan: "#a5e0db",
  brightWhite: "#ffffff",
}

/**
 * The shell's own startup file: a short green prompt with the folder's name, a grey full-width
 * rule above every prompt but the first after a `clear` (so a viewer sees where each command's
 * output starts), and the log line the recorder waits on.
 */
const BASHRC = String.raw`
PS1='\[\e[38;2;139;209;124m\]\W\[\e[0m\] $ '
__demo_prompt() {
  local status=$?
  printf '%s\n' "$status" >> "$DEMO_LOG"
  if [ -n "$__demo_quiet" ]; then unset __demo_quiet; return; fi
  printf '\n\e[38;2;70;75;88m%s\e[0m\n' "$(printf '─%.0s' $(seq "$COLUMNS"))"
}
PROMPT_COMMAND=__demo_prompt
export GIT_PAGER=cat PAGER=cat
`

/** The window drawn around the terminal, kept clear of the caption band at the bottom. */
const WINDOW_CSS = `
html, body { background: #0d0e12 !important; margin: 0; overflow: hidden }
#demo-window { position: fixed; left: 24px; right: 24px; top: 20px; bottom: 104px;
  background: ${THEME.background}; border-radius: 12px; box-shadow: 0 0 0 1px #2a2d36 }
#demo-bar { position: absolute; left: 0; right: 0; top: 0; height: 40px; display: flex;
  align-items: center; gap: 8px; padding: 0 16px; border-bottom: 1px solid #2a2d36 }
#demo-bar span { width: 12px; height: 12px; border-radius: 50%; background: #3a3e4a }
#terminal-container { position: fixed !important; left: 44px; right: 44px; top: 76px;
  bottom: 120px; width: auto !important; height: auto !important }
`

/** A running terminal: its page, and how to type into it and wait for a command. */
export interface Terminal {
  page: Page
  /** Types `text` at a person's pace, without Enter. */
  type(text: string): Promise<void>
  /** Presses Enter. */
  enter(): Promise<void>
  /** Waits until the shell shows its next prompt; fails after `seconds`. Returns the exit code. */
  done(seconds: number): Promise<number>
  /** Stops ttyd. */
  close(): Promise<void>
}

/** A free TCP port on the loopback interface. */
function freePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 })
  const { port } = listener.addr as Deno.NetAddr
  listener.close()
  return port
}

/**
 * Starts ttyd with a bash in `cwd`, with `home` as its home and only the environment it needs,
 * and opens it in a new page of `browser`.
 */
export async function openTerminal(
  browser: Browser,
  work: string,
  cwd: string,
): Promise<Terminal> {
  const home = `${work}/home`
  const log = `${work}/prompts.log`
  await Deno.mkdir(home, { recursive: true })
  await Deno.writeTextFile(`${work}/bashrc`, BASHRC)
  await Deno.writeTextFile(log, "")
  const port = freePort()
  const keep = ["PATH", "LANG", "DOCKER_HOST"].flatMap((name) => {
    const value = Deno.env.get(name)
    return value ? [`${name}=${value}`] : []
  })
  const denoDir = Deno.env.get("DENO_DIR") ??
    JSON.parse(
      new TextDecoder().decode(
        (await new Deno.Command("deno", { args: ["info", "--json"], stdout: "piped" }).output())
          .stdout,
      ),
    ).denoDir
  const options = {
    fontSize: 22,
    fontFamily: "Hack, 'DejaVu Sans Mono', monospace",
    lineHeight: 1.2,
    cursorBlink: false,
    disableLeaveAlert: true,
    disableResizeOverlay: true,
    rendererType: "dom",
    theme: JSON.stringify(THEME),
  }
  const ttyd = new Deno.Command("ttyd", {
    args: [
      ...["-i", "127.0.0.1", "-p", String(port), "-W", "-O", "-o", "-w", cwd],
      ...Object.entries(options).flatMap(([key, value]) => ["-t", `${key}=${value}`]),
      ...["env", "-i", `HOME=${home}`, "TERM=xterm-256color", `DENO_DIR=${denoDir}`, ...keep],
      ...[`DEMO_LOG=${log}`, "__demo_quiet=1"],
      ...["bash", "--noprofile", "--rcfile", `${work}/bashrc`, "-i"],
    ],
    stdout: "null",
    stderr: "null",
  }).spawn()

  const page = await browser.newPage({
    viewport: TERMINAL_VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: "dark",
  })
  for (const deadline = Date.now() + 15_000;; await sleep(200)) {
    try {
      await page.goto(`http://127.0.0.1:${port}/`)
      break
    } catch (error) {
      if (Date.now() > deadline) throw error
    }
  }
  await page.addStyleTag({ content: WINDOW_CSS })
  await page.evaluate(() => {
    const window = document.createElement("div")
    window.id = "demo-window"
    window.innerHTML = `<div id="demo-bar"><span></span><span></span><span></span></div>`
    document.body.prepend(window)
    // xterm fits itself to its container when the window resizes.
    dispatchEvent(new Event("resize"))
  })
  await page.locator(".xterm-rows").waitFor()
  await waitForPrompts(log, 1, 15)
  await page.locator(".xterm-helper-textarea").focus()

  let prompts = 1
  return {
    page,
    type: (text) => page.keyboard.type(text, { delay: 50 }),
    enter: () => page.keyboard.press("Enter"),
    async done(seconds) {
      prompts++
      return await waitForPrompts(log, prompts, seconds)
    },
    async close() {
      // Stop everything the shell still runs (`deno task dev`, docker compose) first: killing
      // ttyd alone leaves its shell's session starting containers while the stack is removed.
      const shells = await new Deno.Command("pgrep", { args: ["-P", String(ttyd.pid)] }).output()
      for (const pid of new TextDecoder().decode(shells.stdout).split("\n").filter(Boolean)) {
        await stopSession(pid)
      }
      await page.close().catch(() => {})
      try {
        ttyd.kill("SIGTERM")
      } catch { /* already gone */ }
      await ttyd.status
    },
  }
}

/** Stops every process of the session that `leader` leads: SIGTERM, then SIGKILL after 20 s. */
async function stopSession(leader: string): Promise<void> {
  for (const [signal, seconds] of [["TERM", 20], ["KILL", 5]] as const) {
    await new Deno.Command("pkill", { args: [`-${signal}`, "-s", leader] }).output()
    for (const deadline = Date.now() + seconds * 1000; Date.now() < deadline; await sleep(200)) {
      const { success } = await new Deno.Command("pgrep", { args: ["-s", leader] }).output()
      if (!success) return
    }
  }
}

/** Waits until the shell has shown `count` prompts and returns the last command's exit code. */
async function waitForPrompts(log: string, count: number, seconds: number): Promise<number> {
  const deadline = Date.now() + seconds * 1000
  while (true) {
    const lines = (await Deno.readTextFile(log)).split("\n").filter(Boolean)
    if (lines.length >= count) return Number(lines[count - 1])
    if (Date.now() > deadline) {
      throw new Error(`the terminal showed no prompt within ${seconds} s`)
    }
    await sleep(250)
  }
}
