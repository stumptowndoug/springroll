import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createInstallerDmg } from "./dmg.ts";
import { notarizeArchive } from "./notarize.ts";

export async function releaseInstallerDmg(app: string, existingDmg?: string) {
  for (const key of [
    "APPLE_SIGNING_IDENTITY",
    "APPLE_ID",
    "APPLE_PASSWORD",
    "APPLE_TEAM_ID",
  ]) {
    if (!process.env[key]) throw new Error(`Missing ${key}`);
  }
  async function run(command: string[]) {
    const child = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
    if ((await child.exited) !== 0)
      throw new Error(`Installer step failed: ${command[0]}`);
  }
  await run(["codesign", "--verify", "--deep", "--strict", app]);
  await run(["xcrun", "stapler", "validate", app]);
  const dmg = existingDmg ?? (await createInstallerDmg(app));
  await run([
    "codesign",
    "--timestamp",
    "--sign",
    process.env.APPLE_SIGNING_IDENTITY ?? "",
    dmg,
  ]);
  await notarizeArchive(dmg, join(dirname(dmg), "dmg-notarization.json"));
  await run(["xcrun", "stapler", "staple", dmg]);
  await run(["xcrun", "stapler", "validate", dmg]);
  await run([
    "spctl",
    "--assess",
    "--type",
    "open",
    "--context",
    "context:primary-signature",
    "--verbose=2",
    dmg,
  ]);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(dmg)) hash.update(chunk);
  await writeFile(`${dmg}.sha256`, `${hash.digest("hex")}  ${basename(dmg)}\n`);
  console.log(`Signed and notarized installer: ${dmg}`);
  return dmg;
}

if (import.meta.main) {
  const app = process.argv[2];
  if (!app)
    throw new Error(
      "Usage: bun desktop/release-dmg.ts /path/to/Springroll.app [existing.dmg]",
    );
  await releaseInstallerDmg(app, process.argv[3]);
}
