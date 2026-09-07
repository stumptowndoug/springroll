import { mkdtemp, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

/** Wrap an already signed/stapled app; never modify the published app bundle. */
export async function createInstallerDmg(app: string): Promise<string> {
  if (!Bun.which("create-dmg"))
    throw new Error(
      "Install the packaging tool first: brew install create-dmg",
    );
  app = resolve(app);
  const name = basename(app);
  const plist = Bun.spawnSync([
    "/usr/libexec/PlistBuddy",
    "-c",
    "Print :CFBundleShortVersionString",
    join(app, "Contents/Info.plist"),
  ]);
  if (plist.exitCode !== 0) throw new Error("Cannot read app version");
  const version = plist.stdout.toString().trim();
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("Unexpected app version");
  const output = join(
    dirname(app),
    `Springroll-${version}-${process.arch}.dmg`,
  );
  if (await Bun.file(output).exists())
    throw new Error(`Installer already exists: ${output}`);
  const stage = await mkdtemp(join(dirname(app), ".dmg-stage-"));
  try {
    const copy = Bun.spawn(["ditto", app, join(stage, name)], {
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await copy.exited) !== 0)
      throw new Error("Cannot stage the signed app");
    const child = Bun.spawn(
      [
        "create-dmg",
        "--volname",
        "Install Springroll",
        "--volicon",
        join(app, "Contents/Resources/icon.icns"),
        "--window-pos",
        "200",
        "150",
        "--window-size",
        "560",
        "360",
        "--icon-size",
        "112",
        "--text-size",
        "14",
        "--icon",
        name,
        "150",
        "150",
        "--hide-extension",
        name,
        "--app-drop-link",
        "410",
        "150",
        "--no-internet-enable",
        output,
        stage,
      ],
      { stdout: "inherit", stderr: "inherit" },
    );
    if ((await child.exited) !== 0) throw new Error("DMG creation failed");
    return output;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const app = process.argv[2];
  if (!app)
    throw new Error("Usage: bun desktop/dmg.ts /path/to/Springroll.app");
  console.log(await createInstallerDmg(app));
}
