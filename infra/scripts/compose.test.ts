/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { type ComposeHost, runCompose } from "./compose.ts"
import type { PostgresDataFacts } from "./postgres-data.ts"

const ENV = { ENV: "prod", PROJECT: "app" }

/** What the fake engine answers, beside the Postgres facts. */
interface Answers {
  /** `compose config --format json`; left out, Compose does not describe the project. */
  config?: string;
  /** `compose ps -a --format json`. */
  ps?: string;
  /** `compose --dry-run up -d`. */
  dryRun?: string;
  /** The TCP ports something listens on. */
  listening?: number[];
  /** The exit code of a command, by what follows the env file; 0 when it gives none. */
  exit?: (line: string) => number | undefined;
}

/** A project with the product, one optional service and one published port. */
const CONFIG = JSON.stringify({
  services: {
    db: {},
    migrate: {},
    api: {},
    spa: {},
    grafana: { ports: [{ host_ip: "127.0.0.1", target: 3000, published: "3000" }] },
  },
});
const RAW_CONFIG = JSON.stringify({
  services: { grafana: { ports: ["${GRAFANA_HOST_PORT:-127.0.0.1:3000}:3000"] } },
});
const row = (service: string, state: string, port = 0) =>
  JSON.stringify({ Service: service, State: state, Publishers: [{ PublishedPort: port }] });

/** A host that records what reaches the container engine; `asked` holds the read-only commands. */
function host(
  facts: Partial<PostgresDataFacts>,
  answers: Answers = {},
): ComposeHost & { ran: string[]; asked: string[]; probed: string[]; errors: string[] } {
  const ran: string[] = [];
  const asked: string[] = [];
  const probed: string[] = [];
  const errors: string[] = [];
  const tail = (args: string[]) => args.slice(args.indexOf("./infra/envs/.env") + 1).join(" ");
  return {
    ran,
    asked,
    probed,
    errors,
    readEnv: () => Promise.resolve(ENV),
    facts: () =>
      Promise.resolve({
        oldDataExists: false,
        newDataExists: false,
        upgradeMarked: false,
        oldDataChangedSinceUpgrade: false,
        ...facts,
      }),
    ensureProxyNetwork: () => {
      ran.push("proxy network");
      return Promise.resolve(false);
    },
    run: (_engine, args) => {
      ran.push(tail(args));
      return Promise.resolve(answers.exit?.(tail(args)) ?? 0);
    },
    ask: (_engine, args) => {
      const line = tail(args);
      asked.push(line);
      const stdout = line === "config --format json"
        ? answers.config
        : line === "config --no-interpolate --format json"
        ? RAW_CONFIG
        : line.includes("ps -a")
        ? answers.ps ?? ""
        : undefined;
      const fail = { code: 1, stdout: "", stderr: "unknown command" };
      if (line === "--dry-run up -d") {
        return Promise.resolve(
          answers.dryRun === undefined ? fail : { code: 0, stdout: "", stderr: answers.dryRun },
        );
      }
      return Promise.resolve(stdout === undefined ? fail : { code: 0, stdout, stderr: "" });
    },
    portInUse: (hostIp, port) => {
      probed.push(`${hostIp}:${port}`);
      return Promise.resolve(answers.listening?.includes(port) ?? false);
    },
    log: () => {},
    error: (message) => errors.push(message),
  };
}

Deno.test("deno task compose up beside unmoved Postgres 16 data exits 1 and runs nothing", async () => {
  const h = host({ oldDataExists: true })
  expect(await runCompose(["up", "-d", "--build"], h)).toBe(1)
  expect(h.ran).toEqual([])
  expect(h.errors.join("\n")).toContain("deno task db:upgrade-18")
})

Deno.test("deno task compose up on a machine with no Postgres 16 data builds the base image, then runs", async () => {
  const h = host({})
  expect(await runCompose(["up", "-d", "--build"], h)).toBe(0)
  expect(h.ran).toEqual(["proxy network", "build deno-base", "up -d --build"])
  expect(h.errors).toEqual([])
})

const PRODUCT = "up -d --build db migrate api spa";

Deno.test("a deploy whose published port is taken by something else exits 1 before anything is built or started", async () => {
  const h = host({}, { config: CONFIG, listening: [3000] });
  expect(await runCompose(["up", "-d", "--build"], h)).toBe(1);
  expect(h.ran).toEqual([]);
  expect(h.probed).toEqual(["127.0.0.1:3000"]);
  expect(h.errors.join("\n")).toContain("127.0.0.1:3000 (service grafana): set GRAFANA_HOST_PORT");
  expect(h.errors.join("\n")).toContain("No container was created, stopped or started");
});

Deno.test("a port this project's own running container holds is not taken: the deploy goes on", async () => {
  const h = host({}, { config: CONFIG, ps: row("grafana", "running", 3000), listening: [3000] });
  expect(await runCompose(["up", "-d", "--build"], h)).toBe(0);
  expect(h.probed).toEqual([]);
  expect(h.ran).toEqual(["proxy network", "build deno-base", PRODUCT, "up -d --build"]);
});

Deno.test("the ports are not checked when the project's own containers cannot be listed", async () => {
  // Without that list a port the project itself holds would pass for a taken one.
  const h = host({}, { config: CONFIG, ps: "NAME  STATUS", listening: [3000] });
  expect(await runCompose(["up", "-d", "--build"], h)).toBe(0);
  expect(h.probed).toEqual([]);
  expect(h.errors).toEqual([]);
});

Deno.test("an optional service that fails to start fails the deploy after the product has started, and is named", async () => {
  const ps = [row("db", "running"), row("migrate", "exited"), row("api", "running")].join("\n") +
    "\n" + [row("spa", "running"), row("grafana", "created", 3000)].join("\n");
  const h = host({}, { config: CONFIG, ps, exit: (line) => line === "up -d --build" ? 17 : 0 });
  expect(await runCompose(["up", "-d", "--build"], h)).toBe(17);
  expect(h.ran).toEqual(["proxy network", "build deno-base", PRODUCT, "up -d --build"]);
  expect(h.errors).toHaveLength(1);
  expect(h.errors[0]).toContain("Not up: grafana (created).");
  expect(h.errors[0]).toContain("The product (db, migrate, api, spa) was started before this step");
});

Deno.test("a product that fails to start fails the deploy and the optional services are not started", async () => {
  const h = host({}, { config: CONFIG, exit: (line) => line === PRODUCT ? 1 : 0 });
  expect(await runCompose(["up", "-d", "--build"], h)).toBe(1);
  expect(h.ran).toEqual(["proxy network", "build deno-base", PRODUCT]);
  expect(h.errors).toEqual(["Error starting the product. The other services were not started."]);
});

Deno.test("when Compose would recreate the network, the images are built, every container is removed, then the product starts first", async () => {
  const dryRun = " Network app_default Removing \n Network app_default Removed \n";
  const h = host({}, { config: CONFIG, dryRun, ps: row("api", "running") });
  expect(await runCompose(["up", "-d", "--build"], h)).toBe(0);
  expect(h.ran).toEqual([
    "proxy network",
    "build deno-base",
    "build",
    "--profile * down --remove-orphans",
    PRODUCT,
    "up -d --build",
  ]);
});

Deno.test("when the images cannot be built for a network change, no container is removed", async () => {
  const dryRun = " Network app_default Removing \n";
  const h = host({}, {
    config: CONFIG,
    dryRun,
    ps: row("api", "running"),
    exit: (line) => line === "build" ? 2 : 0,
  });
  expect(await runCompose(["up", "-d", "--build"], h)).toBe(2);
  expect(h.ran).toEqual(["proxy network", "build deno-base", "build"]);
  expect(h.errors.join("\n")).toContain("No container was stopped");
});

Deno.test("a network that only has to be created removes nothing", async () => {
  const h = host({}, { config: CONFIG, dryRun: " Network app_default Creating \n" });
  expect(await runCompose(["up", "-d"], h)).toBe(0);
  expect(h.ran).toEqual(["proxy network", "build deno-base", "up -d db migrate api spa", "up -d"]);
});

Deno.test("a project with no container yet starts without the dry run, which never returns on a fresh machine", async () => {
  const h = host({}, { config: CONFIG, ps: "" });
  expect(await runCompose(["up", "-d"], h)).toBe(0);
  expect(h.asked).not.toContain("--dry-run up -d");
  expect(h.ran).toEqual(["proxy network", "build deno-base", "up -d db migrate api spa", "up -d"]);
});

Deno.test("a start that names a service, and any other command, asks the engine nothing first", async () => {
  for (const args of [["up", "-d", "grafana"], ["up", "-d", "--force-recreate"], ["ps"]]) {
    const h = host({}, { config: CONFIG, listening: [3000] });
    expect(await runCompose(args, h)).toBe(0);
    expect(h.asked).toEqual([]);
    expect(h.probed).toEqual([]);
    expect(h.ran.at(-1)).toBe(args.join(" "));
  }
});

Deno.test("with SPA=false a deploy starts the product without the SPA and keeps the SPA at no container", async () => {
  const base = host({}, { config: CONFIG, ps: "" });
  const h = { ...base, readEnv: () => Promise.resolve({ ...ENV, SPA: "false" }) };
  expect(await runCompose(["up", "-d", "--build"], h)).toBe(0);
  expect(base.ran).toEqual([
    "proxy network",
    "build deno-base",
    "up --scale spa=0 -d --build db migrate api",
    "up --scale spa=0 -d --build",
  ]);
});
