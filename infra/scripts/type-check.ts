const sourceRoots = ["apps", "e2e", "libs", "tests"]
// Git-ignored output no check owns: a nested app's packages (`deno task e2e` in apps/mpa) and
// Playwright's results and report, where e2e-local.sh also copies its configuration.
const skippedNames = new Set(["node_modules"])
const skippedPaths = new Set(["e2e/results", "e2e/report"])
const sourceFiles: string[] = []

async function collectSourceFiles(path: string): Promise<void> {
  for await (const entry of Deno.readDir(path)) {
    const entryPath = `${path}/${entry.name}`
    if (entry.isDirectory) {
      if (skippedNames.has(entry.name) || skippedPaths.has(entryPath)) continue
      await collectSourceFiles(entryPath)
    } else if (entry.isFile && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      sourceFiles.push(entryPath)
    }
  }
}

for (const sourceRoot of sourceRoots) {
  await collectSourceFiles(sourceRoot)
}

for await (const entry of Deno.readDir(".")) {
  if (entry.isFile && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
    sourceFiles.push(entry.name)
  }
}

sourceFiles.sort()

const command = new Deno.Command("deno", {
  // --quiet drops the "Check <file>" line of every file; errors still print.
  args: ["check", "--quiet", ...sourceFiles],
  stdin: "null",
  stdout: "inherit",
  stderr: "inherit",
})
const status = await command.spawn().status

if (!status.success) {
  Deno.exit(status.code)
}
