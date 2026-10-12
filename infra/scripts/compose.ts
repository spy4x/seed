/// <reference lib="deno.ns" />
import { planCompose } from "./compose-plan.ts";
import { readEnvFile } from "./env-file.ts";
import { ensureProxyNetwork, runContainerCli } from "./proxy-network.ts";

const envFilePath = `./infra/envs/.env`;
// What to run, and on which engine, is decided in compose-plan.ts, where it is tested.
const plan = planCompose(await readEnvFile(envFilePath), Deno.args, envFilePath);

// Every compose file joins the external "proxy" network; create it on a fresh machine.
if (plan.ensureProxyNetwork && await ensureProxyNetwork(plan.engine, runContainerCli)) {
  console.log("Created the proxy network");
}

// Build base image first if we're doing "up" or "build"
if (plan.buildBase) {
  console.log("Building base Deno image first...");
  const buildProcess = new Deno.Command(plan.engine, {
    args: plan.buildBase,
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code: buildCode } = await buildProcess.output();
  if (buildCode !== 0) {
    console.error("Error building base image");
    Deno.exit(buildCode);
  }
  console.log("Base image built successfully");
}

console.log("Compose command:", plan.command.join(" "));
const process = new Deno.Command(plan.engine, {
  args: plan.command,
  stdout: "inherit",
  stderr: "inherit",
});
const { code } = await process.output();
if (code === 0) {
  console.log("Compose command executed successfully");
} else {
  console.error("Error executing compose command");
  Deno.exit(code);
}
