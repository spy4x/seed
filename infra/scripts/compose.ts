/// <reference lib="deno.ns" />
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
  log(message: string): void;
  error(message: string): void;
}

/**
 * Runs `deno task compose <args>` and resolves with the exit code. Nothing reaches the container
 * engine, not even the proxy network or the base image build, when the Postgres check refuses.
 */
export async function runCompose(args: string[], host: ComposeHost): Promise<number> {
  // What to run, and on which engine, is decided in compose-plan.ts, where it is tested.
  const plan = planCompose(await host.readEnv(envFilePath), args, envFilePath);

  // Postgres 18 has a data directory of its own; never start it empty beside unmoved 16 data.
  const refusal = postgresUpgradeRefusal(args, await host.facts());
  if (refusal) {
    host.error(refusal);
    return 1;
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

  host.log(`Compose command: ${plan.command.join(" ")}`);
  const code = await host.run(plan.engine, plan.command);
  if (code === 0) {
    host.log("Compose command executed successfully");
  } else {
    host.error("Error executing compose command");
  }
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
    log: (message) => console.log(message),
    error: (message) => console.error(message),
  });
  if (code !== 0) Deno.exit(code);
}
