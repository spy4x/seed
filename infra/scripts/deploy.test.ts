/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { basename, globToRegExp } from "@std/path"
import {
  ALLOW_DIRTY_FLAG,
  DEFAULT_ENV_FILE,
  EXAMPLE_ENV_FILE,
  isSecretName,
  parseDeployArgs,
  planDeploy,
  planFromEnvFile,
  refuseDirtyTree,
  refuseExampleSecrets,
  unsafeSecretsIn,
  VAPID_PATH,
} from "./deploy.ts"
import { readEnvFile } from "./env-file.ts"
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

Deno.test("planDeploy's file copy does not keep a file because it is newer on the server", () => {
  const [files] = planDeploy({ SSH_TO_SERVER: "h", PATH_ON_SERVER: "/srv/app" }, ENV_FILE)
  // rsync's `-u` (`--update`) skips every file whose copy on the receiver is newer. Short options
  // come bundled in one word, such as `-avhz`.
  const bundles = files.args.filter((arg) => /^-[A-Za-z]+$/.test(arg))
  expect(bundles[0], "the copy is still an archive copy").toContain("a")
  expect(bundles.filter((bundle) => bundle.includes("u"))).toEqual([])
  expect(files.args.filter((arg) => arg.startsWith("--update"))).toEqual([])
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

Deno.test("planDeploy keeps a single quote in PATH_ON_SERVER inside one shell word", () => {
  const [, , , start] = planDeploy({ SSH_TO_SERVER: "h", PATH_ON_SERVER: "/srv/it's" }, ENV_FILE)
  expect(start.args[1]).toMatch(/^cd '\/srv\/it'\\''s' && /)
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

/** Every secret the shipped example file gives a value: all of them are public. */
const EXAMPLE_SECRETS = [
  "DB_PASS",
  "KV_PASSWORD",
  "S3_SECRET_ACCESS_KEY",
  "GARAGE_RPC_SECRET",
  "GRAFANA_PASS",
  "AUTH_COOKIE_SECRET",
  "AUTH_PEPPER",
]

/** The shipped example with a value of its own for every secret: a file that may deploy. */
async function safeValues(): Promise<Record<string, string>> {
  const values = { ...await readEnvFile(EXAMPLE_ENV_FILE) }
  for (const name of EXAMPLE_SECRETS) values[name] = `real-${name}`
  return { ...values, SSH_TO_SERVER: "deploy@home.example.net", PATH_ON_SERVER: "/srv/app" }
}

/** What `refuseExampleSecrets` says about `values`, or "" when it lets them through. */
async function refusal(values: Record<string, string>): Promise<string> {
  try {
    refuseExampleSecrets(values, await readEnvFile(EXAMPLE_ENV_FILE), ENV_FILE)
    return ""
  } catch (err) {
    return (err as Error).message
  }
}

Deno.test("an env file copied from the shipped example is refused for each of its secrets", async () => {
  const example = await readEnvFile(EXAMPLE_ENV_FILE)
  expect(unsafeSecretsIn({ ...example }, example)).toEqual(
    EXAMPLE_SECRETS.map((name) => ({ name, reason: "example" })),
  )
})

Deno.test("a deploy with one example password left stops and names that variable, not its value", async () => {
  const example = await readEnvFile(EXAMPLE_ENV_FILE)
  const message = await refusal({ ...await safeValues(), GRAFANA_PASS: example.GRAFANA_PASS })

  expect(message).toContain(ENV_FILE)
  expect(message).toContain("GRAFANA_PASS")
  expect(message).not.toContain("KV_PASSWORD")
  expect(message).not.toContain(example.GRAFANA_PASS)
})

Deno.test("a deploy whose secrets all differ from the example goes ahead, example limits and all", async () => {
  expect(await refusal(await safeValues())).toBe("")
})

Deno.test("a secret set to another variable's example value is refused", async () => {
  const example = await readEnvFile(EXAMPLE_ENV_FILE)
  expect(example.DB_PASS).not.toBe(example.KV_PASSWORD)
  const values = { ...await safeValues(), DB_PASS: example.KV_PASSWORD, SMTP_PASS: example.DB_PASS }

  expect(unsafeSecretsIn(values, example)).toEqual([
    { name: "DB_PASS", reason: "example" },
    { name: "SMTP_PASS", reason: "example" },
  ])
})

Deno.test("a secret the example sets is refused when the env file leaves it empty", async () => {
  const message = await refusal({ ...await safeValues(), GRAFANA_PASS: "" })

  expect(message).toContain("has no value for GRAFANA_PASS")
  expect(message).not.toContain("KV_PASSWORD")
})

Deno.test("a secret the example sets is refused when the env file leaves it out", async () => {
  const { GRAFANA_PASS: _, ...values } = await safeValues()

  expect(await refusal(values)).toContain("has no value for GRAFANA_PASS")
})

Deno.test("a secret the example leaves empty may stay empty or be left out", async () => {
  const example = await readEnvFile(EXAMPLE_ENV_FILE)
  expect(example.SMTP_PASS).toBe("")
  const values: Record<string, string> = { ...await safeValues(), SMTP_PASS: "" }
  delete values.STRIPE_SECRET_KEY

  expect(unsafeSecretsIn(values, example)).toEqual([])
})

Deno.test("a deploy goes ahead without the seed password, and with the example's", async () => {
  const example = await readEnvFile(EXAMPLE_ENV_FILE)
  expect(example.SEED_PASSWORD).not.toBe("")
  const { SEED_PASSWORD: _, ...without } = await safeValues()

  expect(await refusal(without)).toBe("")
  expect(await refusal({ ...without, SEED_PASSWORD: "" })).toBe("")
  expect(await refusal({ ...without, SEED_PASSWORD: example.SEED_PASSWORD })).toBe("")
})

Deno.test("the seed password of the example is refused as the value of another secret", async () => {
  const example = await readEnvFile(EXAMPLE_ENV_FILE)
  const values = { ...await safeValues(), DB_PASS: example.SEED_PASSWORD }

  expect(unsafeSecretsIn(values, example)).toEqual([{ name: "DB_PASS", reason: "example" }])
})

/** Reads env files from `files` instead of the disk; a path it lacks is a missing file. */
function reader(files: Record<string, Record<string, string>>) {
  return (path: string): Promise<Record<string, string>> => {
    if (!(path in files)) return Promise.reject(new Deno.errors.NotFound(`readfile '${path}'`))
    return Promise.resolve(files[path])
  }
}

Deno.test("no deploy step is planned for an env file that holds an example password", async () => {
  const example = await readEnvFile(EXAMPLE_ENV_FILE)
  const safe = await safeValues()
  const files = { [EXAMPLE_ENV_FILE]: example, [ENV_FILE]: safe }
  expect((await planFromEnvFile(ENV_FILE, reader(files))).length).toBe(4)

  files[ENV_FILE] = { ...safe, KV_PASSWORD: example.KV_PASSWORD }
  await expect(planFromEnvFile(ENV_FILE, reader(files))).rejects.toThrow("KV_PASSWORD")
})

Deno.test("a deploy without the example file stops and says the file is missing", async () => {
  const files = { [ENV_FILE]: await safeValues() }

  await expect(planFromEnvFile(ENV_FILE, reader(files))).rejects.toThrow(
    `${EXAMPLE_ENV_FILE} is missing`,
  )
})

Deno.test("a name that describes a key or names passkeys is not a secret and may hold any value", async () => {
  const example = await readEnvFile(EXAMPLE_ENV_FILE)
  // `app` is the example's DB_PASS and the default project name.
  expect(example.DB_PASS).toBe("app")
  const values = {
    ...await safeValues(),
    S3_KEY_PREFIX: "app",
    PASSKEY_RP_ID: "app",
    PASSKEY_RP_NAME: "app",
    S3_BUCKET_BACKUPS_ACCESS_KEY_ID: "app",
  }

  expect(unsafeSecretsIn(values, example)).toEqual([])
})

Deno.test("the exemption for key descriptions and passkeys lets no secret through", async () => {
  for (
    const name of [
      "PASSKEY_SECRET",
      "PASSKEY_PRIVATE_KEY",
      "SECRET_KEY_ID",
      "S3_KEY",
      "KEY_PREFIX_SECRET",
      "API_KEY_IDENTITY_TOKEN",
      // A key description counts only at the end of a name: anything after it is not described.
      "SIGNING_KEY_IDS",
      "S3_KEY_PREFIXES",
      "DB_PASS",
      "KV_PASSWORD",
      "STRIPE_SECRET_KEY",
      "AUTH_TOTP",
    ]
  ) {
    expect({ name, secret: isSecretName(name) }).toEqual({ name, secret: true })
  }
  const example = await readEnvFile(EXAMPLE_ENV_FILE)
  const values = { ...await safeValues(), PASSKEY_SECRET: "app", S3_KEY: example.KV_PASSWORD }

  expect(unsafeSecretsIn(values, example)).toEqual([
    { name: "PASSKEY_SECRET", reason: "example" },
    { name: "S3_KEY", reason: "example" },
  ])
})

/** The example file with a value in every empty line, and secrets of its own. */
async function filledExample(): Promise<Record<string, string>> {
  const example = await readEnvFile(EXAMPLE_ENV_FILE)
  const filled = Object.fromEntries(
    Object.entries(example).map(([name, value]) => [name, value === "" ? `filled-${name}` : value]),
  )
  for (const name of EXAMPLE_SECRETS) filled[name] = `real-${name}`
  return filled
}

Deno.test("a copy of the example file with its values filled in deploys: no name is missing", async () => {
  const files = {
    [EXAMPLE_ENV_FILE]: await readEnvFile(EXAMPLE_ENV_FILE),
    [ENV_FILE]: await filledExample(),
  }

  const steps = await planFromEnvFile(ENV_FILE, reader(files))

  expect(steps.at(0)?.args.at(-1)).toBe("filled-SSH_TO_SERVER:filled-PATH_ON_SERVER")
})

Deno.test("the example file holds every name the deploy reads, the optional ones too", async () => {
  const read = new Set<string>()
  const recording = new Proxy(await filledExample(), {
    get(values, name) {
      if (typeof name === "string") read.add(name)
      return Reflect.get(values, name)
    },
  })
  planDeploy(recording, ENV_FILE)

  const example = Object.keys(await readEnvFile(EXAMPLE_ENV_FILE))
  expect(read.size).toBeGreaterThanOrEqual(3)
  expect([...read].filter((name) => !example.includes(name))).toEqual([])
})

Deno.test("the example file names the host port of every service the stack publishes", async () => {
  const example = await readEnvFile(EXAMPLE_ENV_FILE)
  // The same three names tests/compose-exposure.test.ts finds in the Compose files.
  for (const name of ["DB_HOST_PORT", "KV_HOST_PORT", "GRAFANA_HOST_PORT"]) {
    expect({ name, value: example[name] }).toEqual({
      name,
      value: expect.stringMatching(/^127\.0\.0\.1:\d+$/),
    })
  }
})

Deno.test("the example file does not turn on the proxy's per-request debug log", async () => {
  const example = await readEnvFile(EXAMPLE_ENV_FILE)
  // The same level infra/compose/compose.proxy.yml falls back to (tests/compose-exposure.test.ts).
  expect(example["PROXY_LOG_LEVEL"]).toBe("info")
})

Deno.test("a deploy from a working tree with uncommitted changes stops and names the flag", () => {
  const status = " M apps/api/+main.ts\n?? libs/new-module.ts\n"
  expect(() => refuseDirtyTree(status, false)).toThrow(ALLOW_DIRTY_FLAG)
  expect(() => refuseDirtyTree(status, false)).toThrow("apps/api/+main.ts")
  expect(() => refuseDirtyTree(status, false)).toThrow("libs/new-module.ts")
})

Deno.test("a deploy from a clean working tree goes ahead", () => {
  expect(() => refuseDirtyTree("", false)).not.toThrow()
  expect(() => refuseDirtyTree("\n", false)).not.toThrow()
})

Deno.test("the flag lets a deploy send uncommitted changes", () => {
  expect(() => refuseDirtyTree(" M apps/api/+main.ts\n", true)).not.toThrow()
})

Deno.test("a long list of uncommitted changes names the first five and counts the rest", () => {
  const status = Array.from({ length: 8 }, (_, i) => ` M file-${i}.ts`).join("\n")
  expect(() => refuseDirtyTree(status, false)).toThrow("file-4.ts")
  expect(() => refuseDirtyTree(status, false)).toThrow("and 3 more")
  expect(() => refuseDirtyTree(status, false)).not.toThrow("file-5.ts")
})

Deno.test("the deploy command line takes the flag and an env file in either order", () => {
  expect(parseDeployArgs([])).toEqual({ envFilePath: DEFAULT_ENV_FILE, allowDirty: false })
  expect(parseDeployArgs([ENV_FILE])).toEqual({ envFilePath: ENV_FILE, allowDirty: false })
  expect(parseDeployArgs([ALLOW_DIRTY_FLAG, ENV_FILE])).toEqual({
    envFilePath: ENV_FILE,
    allowDirty: true,
  })
  expect(parseDeployArgs([ENV_FILE, ALLOW_DIRTY_FLAG])).toEqual({
    envFilePath: ENV_FILE,
    allowDirty: true,
  })
})

Deno.test("the deploy command line refuses a mistyped flag and a second env file", () => {
  expect(() => parseDeployArgs(["--allow-dirt"])).toThrow("Unknown option --allow-dirt")
  expect(() => parseDeployArgs([ENV_FILE, "infra/envs/.env.prod"])).toThrow("at most one env file")
})
