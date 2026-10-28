/// <reference lib="deno.ns" />
import {
  networksToRecreate,
  parseContainers,
  parseProject,
  portRefusal,
  portsToProbe,
  PRODUCT_SERVICES,
  servicesNotUp,
  startsWholeProject,
} from "./compose-checks.ts";
import { type ComposePlan, planCompose } from "./compose-plan.ts";
import { readEnvFile } from "./env-file.ts";
import {
  type PostgresDataFacts,
  postgresUpgradeRefusal,
  readPostgresDataFacts,
} from "./postgres-data.ts";
import { ensureProxyNetwork, runContainerCli } from "./proxy-network.ts";

const envFilePath = `./infra/envs/.env`;

/** What `deno task compose` touches outside itself, replaceable so the order is tested. */
export interface ComposeHost {
  readEnv(path: string): Promise<Record<string, string>>;
  facts(): Promise<PostgresDataFacts>;
  /** Creates the shared `proxy` network when it is missing; resolves true when it did. */
  ensureProxyNetwork(plan: ComposePlan): Promise<boolean>;
  /** Runs the engine with its output on the terminal and resolves with its exit code. */
  run(engine: string, args: string[]): Promise<number>;
  /** Runs the engine and returns what it printed; a command that changes nothing. */
  ask(engine: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }>;
  /**
   * Whether something listens on that TCP port of this machine. `undefined` when it cannot be
   * told (no permission to bind the address, a port below 1024).
   */
  portInUse(hostIp: string, port: number): Promise<boolean | undefined>;
  log(message: string): void;
  error(message: string): void;
}

/**
 * Runs `deno task compose <args>` and resolves with the exit code. Nothing reaches the container
 * engine, not even the proxy network or the base image build, when the Postgres check refuses.
 *
 * A start of the whole project (`up -d`, as a deploy runs it) is checked and staged so that it
 * does not leave the product down (compose-checks.ts):
 *
 * 1. It refuses, before anything changes, when something outside the project listens on a host
 *    port the project publishes.
 * 2. When Compose would recreate the project's network, it builds first, then removes the
 *    project's containers and that network, so every container is created again with its name.
 * 3. It starts the product, then everything else. A failure in the second step leaves the product
 *    running; the run still exits non-zero and names the services that are not up.
 *
 * A check that cannot be made (Compose prints something else, the engine does not answer) is
 * skipped and the start goes on; when the project cannot be read at all, it runs as one command.
 */
export async function runCompose(args: string[], host: ComposeHost): Promise<number> {
  // What to run, and on which engine, is decided in compose-plan.ts, where it is tested.
  const env = await host.readEnv(envFilePath);
  const plan = planCompose(env, args, envFilePath);
  const compose = (...rest: string[]) => planCompose(env, rest, envFilePath).command;
  /** What a read-only command printed, or `undefined` when it failed or could not run. */
  const ask = async (...rest: string[]) => {
    try {
      const result = await host.ask(plan.engine, compose(...rest));
      return result.code === 0 ? result : undefined;
    } catch {
      return undefined;
    }
  };

  // Postgres 18 has a data directory of its own; never start it empty beside unmoved 16 data.
  const refusal = postgresUpgradeRefusal(args, await host.facts());
  if (refusal) {
    host.error(refusal);
    return 1;
  }

  const described = startsWholeProject(args)
    ? parseProject(
      (await ask("config", "--format", "json"))?.stdout,
      (await ask("config", "--no-interpolate", "--format", "json"))?.stdout,
    )
    : undefined;
  // A service kept off (`SPA=false`) is neither started first nor reported as not up.
  const project = described && {
    ...described,
    services: described.services.filter((service) => !plan.off.includes(service)),
  };

  // A taken port fails the start after Compose has recreated the product's containers.
  const containers = project &&
    parseContainers((await ask("--profile", "*", "ps", "-a", "--format", "json"))?.stdout);
  if (project && containers) {
    const taken = [];
    for (const port of portsToProbe(project.ports, containers)) {
      if (await host.portInUse(port.hostIp, port.port)) taken.push(port);
    }
    if (taken.length > 0) {
      host.error(portRefusal(taken, envFilePath));
      return 1;
    }
  }

  // Every compose file joins the external "proxy" network; create it on a fresh machine.
  if (plan.ensureProxyNetwork && await host.ensureProxyNetwork(plan)) {
    host.log("Created the proxy network");
  }

  // Build base image first if we're doing "up" or "build"
  if (plan.buildBase) {
    host.log("Building base Deno image first...");
    const buildCode = await host.run(plan.engine, plan.buildBase);
    if (buildCode !== 0) {
      host.error("Error building base image");
      return buildCode;
    }
    host.log("Base image built successfully");
  }

  const run = async (command: string[]) => {
    host.log(`Compose command: ${command.join(" ")}`);
    return await host.run(plan.engine, command);
  };

  if (!project) {
    const code = await run(plan.command);
    if (code === 0) {
      host.log("Compose command executed successfully");
    } else {
      host.error("Error executing compose command");
    }
    return code;
  }

  // Compose removes a network whose definition changed and starts the containers it does not
  // recreate without their service names. Nothing is left to restart once they are all removed.
  // A project with no container yet has no network to recreate, and on a fresh machine its dry
  // run never returns (seen with Compose 2.40: it waits on services that a dry run never starts).
  const dryRun = containers?.length === 0 ? undefined : await ask("--dry-run", "up", "-d");
  const networks = networksToRecreate(`${dryRun?.stdout ?? ""}\n${dryRun?.stderr ?? ""}`);
  if (networks.length > 0) {
    host.log(
      `The network ${networks.join(", ")} was made from an older definition, and Compose would ` +
        `recreate it. Removing this project's containers so that each is created again on the ` +
        `new network: every service is down until it starts below.`,
    );
    if (args.includes("--build")) {
      // Before anything stops, so the outage is not as long as the build.
      const buildCode = await run(compose("build"));
      if (buildCode !== 0) {
        host.error("Error building the images. No container was stopped: what ran still runs.");
        return buildCode;
      }
    }
    const downCode = await run(compose("--profile", "*", "down", "--remove-orphans"));
    if (downCode !== 0) {
      host.error(
        "Could not remove the project's containers and network, so some may be stopped. " +
          "Fix the cause above and run: deno task compose up -d --force-recreate",
      );
      return downCode;
    }
  }

  const product = PRODUCT_SERVICES.filter((service) => project.services.includes(service));
  const optional = project.services.filter((service) => !product.includes(service));
  if (product.length > 0 && optional.length > 0) {
    host.log(`Starting the product first: ${product.join(", ")}`);
    const productCode = await run([...plan.command, ...product]);
    if (productCode !== 0) {
      host.error("Error starting the product. The other services were not started.");
      return productCode;
    }
    host.log("The product runs. Starting the other services...");
  }
  const code = await run(plan.command);
  if (code === 0) {
    host.log("Compose command executed successfully");
    return 0;
  }
  const after = parseContainers((await ask("ps", "-a", "--format", "json"))?.stdout);
  const down = after ? servicesNotUp(project.services, after) : [];
  host.error(
    [
      "Error executing compose command.",
      down.length > 0
        ? `Not up: ${down.join(", ")}.`
        : "deno task compose ps -a shows which service is not up.",
      product.length > 0 && optional.length > 0
        ? `The product (${product.join(", ")}) was started before this step and is not ` +
          `stopped by its failure. Fix the cause above and start again.`
        : "",
    ].filter(Boolean).join(" "),
  );
  return code;
}

if (import.meta.main) {
  const code = await runCompose(Deno.args, {
    readEnv: readEnvFile,
    facts: () => readPostgresDataFacts(),
    ensureProxyNetwork: (plan) => ensureProxyNetwork(plan.engine, runContainerCli),
    run: async (engine, args) =>
      (await new Deno.Command(engine, { args, stdout: "inherit", stderr: "inherit" }).output())
        .code,
    ask: async (engine, args) => {
      const text = new TextDecoder();
      const { code, stdout, stderr } = await new Deno.Command(engine, { args }).output();
      return { code, stdout: text.decode(stdout), stderr: text.decode(stderr) };
    },
    portInUse: async (hostname, port) => {
      try {
        // Asked first, so a host address the task was not allowed never opens a prompt.
        const host = hostname.includes(":") ? `[${hostname}]:${port}` : `${hostname}:${port}`;
        if ((await Deno.permissions.query({ name: "net", host })).state !== "granted") {
          return undefined;
        }
        Deno.listen({ hostname, port }).close();
        return false;
      } catch (error) {
        return error instanceof Deno.errors.AddrInUse ? true : undefined;
      }
    },
    log: (message) => console.log(message),
    error: (message) => console.error(message),
  });
  if (code !== 0) Deno.exit(code);
}
