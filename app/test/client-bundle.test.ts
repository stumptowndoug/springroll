import { expect, test } from "bun:test";
import { join } from "node:path";

test("reports are lazy chunks rather than part of the initial entry", async () => {
  // Keep the bundler separate from bun:test's module resolver/mocks.
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `
    const result = await Bun.build({ entrypoints: ["./src/client/main.tsx"], target: "browser", minify: true, splitting: true });
    const entry = result.outputs.find(output => output.kind === "entry-point");
    console.log(JSON.stringify({ success: result.success, size: entry?.size, chunks: result.outputs.filter(output => output.kind === "chunk").length, dynamic: (await entry?.text())?.includes("import(") }));
  `,
    ],
    { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" },
  );
  const [output, errors, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(errors).toBe("");
  expect(code).toBe(0);
  const result = JSON.parse(output);
  expect(result.success).toBe(true);
  // Generous regression ceiling: the former monolithic entry was 4.95 MB.
  expect(result.size).toBeLessThan(2_000_000);
  expect(result.chunks).toBeGreaterThan(0);
  expect(result.dynamic).toBe(true);
});
