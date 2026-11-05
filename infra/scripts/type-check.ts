const sourceRoots = ["apps", "e2e", "libs", "tests"]
const sourceFiles: string[] = []

async function collectSourceFiles(path: string): Promise<void> {
  for await (const entry of Deno.readDir(path)) {
    const entryPath = `${path}/${entry.name}`
    if (entry.isDirectory) {
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
