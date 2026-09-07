import { readdir, readlink, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";

/** Keep SDK/control code; omit optional native payloads from every desktop build. */
export async function pruneOptionalRuntimes(runtime: string): Promise<void> {
  const modules = join(runtime, "node_modules");
  const store = join(modules, ".bun");
  const removed: string[] = [];
  for (const entry of await readdir(store)) {
    if (
      /^@anthropic-ai\+claude-agent-sdk-(darwin|linux|win32)-/.test(entry) ||
      /^@openai\+codex@[^/]+-(darwin|linux|win32)-(arm64|x64)/.test(entry)
    ) {
      const path = join(store, entry);
      await rm(path, { recursive: true });
      removed.push(path);
    }
  }
  async function removeNativeLinks(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = resolve(directory, await readlink(path));
        if (
          removed.some(
            (root) => target === root || target.startsWith(`${root}/`),
          )
        )
          await rm(path);
      } else if (entry.isDirectory()) await removeNativeLinks(path);
    }
  }
  await removeNativeLinks(modules);
  // The engine already exists in its package. Keep one signed executable.
  const require = createRequire(join(runtime, "kernel/package.json"));
  const rivetRequire = createRequire(require.resolve("rivetkit"));
  const { getEnginePath } = rivetRequire("@rivetkit/engine-cli") as {
    getEnginePath(): string;
  };
  const engine = getEnginePath();
  if (!resolve(engine).startsWith(`${resolve(modules)}/`))
    throw new Error("Engine resolved outside packaged dependencies");
  const link = join(runtime, "bin/rivet-engine");
  await rm(link, { force: true });
  await symlink(relative(dirname(link), engine), link);
}
