import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin")
  throw new Error("The prototype targets macOS only");
const root = fileURLToPath(new URL("../", import.meta.url));
const desktop = join(root, "desktop");
const outputRoot = join(desktop, "dist");
await mkdir(outputRoot, { recursive: true });
// Every build has its own directory: never overwrite a running app or user data.
const output = await mkdtemp(join(outputRoot, "prototype-"));
const app = join(output, "Springroll Prototype.app");
const contents = join(app, "Contents");
const runtime = join(contents, "Resources", "runtime");
await mkdir(join(contents, "MacOS"), { recursive: true });
await mkdir(join(runtime, "bin"), { recursive: true });

async function run(command: string[], cwd = root) {
  const child = Bun.spawn(command, {
    cwd,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await child.exited) !== 0)
    throw new Error(`Build step failed: ${command[0]}`);
}

await run([process.execPath, "run", "build"]);
await run(["cargo", "build", "--manifest-path", join(desktop, "Cargo.toml")]);
// Explicit allowlist: never copy .env, .local, Git history, or design mockups.
for (const path of [
  "package.json",
  "bun.lock",
  "LICENSE",
  "app/package.json",
  "app/src",
  "app/dist",
  "kernel/package.json",
  "kernel/src",
  "cli/package.json",
  "spikes/rivet-r0/package.json",
  "drizzle",
]) {
  await cp(join(root, path), join(runtime, path), { recursive: true });
}
await run(
  [
    process.execPath,
    "install",
    "--frozen-lockfile",
    "--production",
    "--ignore-scripts",
  ],
  runtime,
);
await copyFile(process.execPath, join(runtime, "bin/bun"));
const require = createRequire(join(root, "kernel/package.json"));
const { getEnginePath } = require("@rivetkit/engine-cli") as {
  getEnginePath(): string;
};
await copyFile(getEnginePath(), join(runtime, "bin/rivet-engine"));
await chmod(join(runtime, "bin/bun"), 0o755);
await chmod(join(runtime, "bin/rivet-engine"), 0o755);
await copyFile(
  join(desktop, "target/debug/springroll-desktop"),
  join(contents, "MacOS/springroll-desktop"),
);
await chmod(join(contents, "MacOS/springroll-desktop"), 0o755);
await copyFile(
  join(desktop, "icons/icon.icns"),
  join(contents, "Resources/icon.icns"),
);
await writeFile(
  join(contents, "Info.plist"),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>springroll-desktop</string>
<key>CFBundleIdentifier</key><string>com.springroll.desktop.prototype</string>
<key>CFBundleName</key><string>Springroll Prototype</string>
<key>CFBundleDisplayName</key><string>Springroll Prototype</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleIconFile</key><string>icon.icns</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>`,
);
console.log(`Unsigned development app: ${app}`);
