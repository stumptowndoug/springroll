import { readFile } from "node:fs/promises";

export async function notarizeArchive(archive: string, resultPath: string) {
  const keys = ["APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"] as const;
  for (const key of keys) {
    if (!process.env[key]) throw new Error(`Missing ${key}`);
  }
  const submission = Bun.spawn(
    [
      "xcrun",
      "notarytool",
      "submit",
      archive,
      "--apple-id",
      process.env.APPLE_ID ?? "",
      "--password",
      process.env.APPLE_PASSWORD ?? "",
      "--team-id",
      process.env.APPLE_TEAM_ID ?? "",
      "--wait",
      "--output-format",
      "json",
    ],
    { stdout: Bun.file(resultPath), stderr: "inherit" },
  );
  if ((await submission.exited) !== 0)
    throw new Error(`Notarization failed; inspect ${resultPath}`);
  const result = JSON.parse(await readFile(resultPath, "utf8"));
  if (result.status !== "Accepted")
    throw new Error(`Notarization ${result.status}; submission ${result.id}`);
}
