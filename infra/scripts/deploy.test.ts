/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { basename, globToRegExp } from "@std/path"
import { planDeploy, shellQuote, VAPID_PATH } from "./deploy.ts"
import { MissingEnvError } from "@spy4x/server/config"

const ENV_FILE = "infra/envs/.env.home"

Deno.test("planDeploy sends files and the env file to the host and path from the env file", () => {
  const [files, envFile] = planDeploy(
    { SSH_TO_SERVER: "deploy@home.example.net", PATH_ON_SERVER: "/srv/app" },
    ENV_FILE,
  )
  expect(files.command).toBe("rsync")
  expect(files.args.at(-1)).toBe("deploy@home.example.net:/srv/app")
  expect(files.args).toContain("--delete")
  expect(files.args).not.toContain("--delete-excluded")
  expect(envFile.command).toBe("rsync")
  expect(envFile.args).toEqual([
    "-e",
    "ssh",
    "-p",
    "--chmod=F600",
    ENV_FILE,
    "deploy@home.example.net:/srv/app/infra/envs/.env",
  ])
})

/**
 * The `--exclude=` patterns of the file copy that come before its first include, applied with
 * rsync's rule for them: a pattern starting with `/` matches the path from the transfer root, any
 * other pattern without a slash matches the file name in any directory. rsync itself is not run:
 * the CI image has none. The pull request records a real `rsync --dry-run` of the same filters.
 */
function excludedBeforeIncludes(args: string[], path: string): boolean {
  const firstInclude = args.findIndex((arg) => arg.startsWith("--include"))
  return args.slice(0, firstInclude).some((arg) => {
    if (!arg.startsWith("--exclude=")) return false
    const pattern = arg.slice("--exclude=".length)
    if (pattern.startsWith("/")) return globToRegExp(pattern.slice(1)).test(path)
    return !pattern.includes("/") && globToRegExp(pattern).test(basename(path))
  })
}

Deno.test("planDeploy's file copy excludes every env file and the web push keys", () => {
  const envFile = "infra/secrets/home-server"
  const [files] = planDeploy({ SSH_TO_SERVER: "h", PATH_ON_SERVER: "/srv/app" }, envFile)
  for (
    const path of [
      "apps/api/.env",
      "libs/server/.env.local",
      "infra/.env.prod",
      "infra/envs/.env",
      "infra/envs/.env.prod",
      "infra/envs/home.env",
      "infra/secrets/home-server",
      "infra/configs/vapid.json",
    ]
  ) {
    expect({ path, excluded: excludedBeforeIncludes(files.args, path) })
      .toEqual({ path, excluded: true })
  }
  for (const path of ["apps/api/index.ts", "infra/compose/compose.prod.yml", "deno.jsonc"]) {
    expect({ path, excluded: excludedBeforeIncludes(files.args, path) })
      .toEqual({ path, excluded: false })
  }
})

Deno.test("planDeploy starts the app in the quoted path with the configured Deno", () => {
  const [, , , start] = planDeploy(
    { SSH_TO_SERVER: "h", PATH_ON_SERVER: "/srv/my app", DENO_ON_SERVER: "/opt/deno/deno" },
    ENV_FILE,
  )
  expect(start).toEqual({
    label: "Starting the app",
    command: "ssh",
    args: [
      "h",
      `cd '/srv/my app' && PATH="$HOME/.deno/bin:$PATH" /opt/deno/deno task compose up -d --build`,
    ],
  })
})

Deno.test("planDeploy reads a leading ~/ in PATH_ON_SERVER as the home directory", () => {
  const [files, , , start] = planDeploy({ SSH_TO_SERVER: "h", PATH_ON_SERVER: "~/app" }, ENV_FILE)
  expect(files.args.at(-1)).toBe("h:app")
  expect(start.args[1]).toMatch(/^cd 'app' && .* deno task compose up -d --build$/)
})

Deno.test("planDeploy refuses an env file without SSH_TO_SERVER or PATH_ON_SERVER, or with it blank", () => {
  expect(() => planDeploy({ PATH_ON_SERVER: "/srv/app" }, ENV_FILE))
    .toThrow(new MissingEnvError("SSH_TO_SERVER"))
  expect(() => planDeploy({ SSH_TO_SERVER: "h" }, ENV_FILE))
    .toThrow(new MissingEnvError("PATH_ON_SERVER"))
  expect(() => planDeploy({ SSH_TO_SERVER: "h", PATH_ON_SERVER: "" }, ENV_FILE))
    .toThrow(new MissingEnvError("PATH_ON_SERVER"))
})

Deno.test("shellQuote keeps a single quote inside one shell word", () => {
  expect(shellQuote(`it's`)).toBe(`'it'\\''s'`)
})

Deno.test("planDeploy creates the web push keys on the server before starting the app", () => {
  const steps = planDeploy({ SSH_TO_SERVER: "h", PATH_ON_SERVER: "/srv/app" }, ENV_FILE)
  expect(steps.map((step) => step.label)).toEqual([
    "Copying files",
    `Copying ${ENV_FILE} to infra/envs/.env`,
    "Creating web push keys if missing",
    "Starting the app",
  ])
  const [server, command] = steps[2].args
  expect(steps[2].command).toBe("ssh")
  expect(server).toBe("h")
  // In this order: an empty directory left by an earlier start goes first (rmdir cannot delete a
  // file), then only a missing file is generated, so a key on the server is never replaced.
  expect(command).toBe(
    `cd '/srv/app' && if [ -d ${VAPID_PATH} ]; then rmdir ${VAPID_PATH}; fi && ` +
      `if [ ! -e ${VAPID_PATH} ]; then ` +
      `(umask 077 && PATH="$HOME/.deno/bin:$PATH" deno task vapid-key:create); fi && ` +
      `chmod 600 ${VAPID_PATH}`,
  )
})

Deno.test("planDeploy runs the key step with the configured Deno", () => {
  const steps = planDeploy(
    { SSH_TO_SERVER: "h", PATH_ON_SERVER: "/srv/app", DENO_ON_SERVER: "/opt/deno/deno" },
    ENV_FILE,
  )
  expect(steps[2].args[1]).toContain(`/opt/deno/deno task vapid-key:create`)
})
