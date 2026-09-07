import { cp, mkdir, readdir, readlink, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";

/** Keep runtime code and built browser assets, without optional engines or build artifacts. */
export async function pruneOptionalRuntimes(runtime: string): Promise<void> {
  const modules = join(runtime, "node_modules");
  const store = join(modules, ".bun");
  const removed: string[] = [];
  const browserPackages = [
    "mermaid",
    "@mermaid-js/parser",
    "cytoscape",
    "cytoscape-fcose",
    "cytoscape-cose-bilkent",
    "react-dom",
    "react-router",
    "react-router-dom",
  ];
  for (const entry of await readdir(store)) {
    // These browser-only packages are already compiled into app/dist chunks.
    const frontendPackage = browserPackages.find((name) =>
      entry.startsWith(`${name.replace("/", "+")}@`),
    );
    if (entry.startsWith("simple-icons@")) {
      // Server logo resolution reads icons.json and individual SVGs, never
      // these full-catalog JavaScript exports. Keep metadata, SVGs and notices.
      for (const file of ["index.js", "index.mjs"])
        await rm(join(store, entry, "node_modules/simple-icons", file));
    }
    if (
      frontendPackage ||
      /^@anthropic-ai\+claude-agent-sdk-(darwin|linux|win32)-/.test(entry) ||
      /^@openai\+codex@[^/]+-(darwin|linux|win32)-(arm64|x64)/.test(entry)
    ) {
      const path = join(store, entry);
      if (frontendPackage) {
        const packageRoot = join(path, "node_modules", frontendPackage);
        const notices = join(runtime, "third-party-licenses", entry);
        await mkdir(notices, { recursive: true });
        for (const file of await readdir(packageRoot)) {
          if (/^(licen[cs]e|copying|notice)([.-]|$)/i.test(file))
            await cp(join(packageRoot, file), join(notices, file), {
              recursive: true,
            });
        }
      }
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
  // Workspace node_modules directories also link into the shared package store.
  await removeNativeLinks(runtime);
  // Debug maps stay in the source checkout/build output, outside the shipped app.
  // Match known source-map extensions rather than deleting arbitrary .map data.
  async function removeSourceMaps(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await removeSourceMaps(path);
      else if (
        entry.isFile() &&
        /\.(?:[cm]?[jt]sx?|css)\.map$/.test(entry.name)
      )
        await rm(path);
    }
  }
  await removeSourceMaps(runtime);
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
