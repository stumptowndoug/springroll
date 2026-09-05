import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const app = Bun.argv[2];
if (!app)
  throw new Error(
    "Usage: bun desktop/smoke.ts '/path/Springroll Prototype.app'",
  );
const data = await mkdtemp(join(tmpdir(), "springroll-desktop-smoke-"));
const executable = join(resolve(app), "Contents/MacOS/springroll-desktop");
for (let launch = 0; launch < 2; launch++) {
  const child = Bun.spawn([executable], {
    cwd: tmpdir(),
    env: {
      ...process.env,
      PATH: "/usr/bin:/bin",
      SPRINGROLL_DESKTOP_TEST_DATA_DIR: data,
    },
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  let base: string | undefined;
  let engine: string | undefined;
  let drainTimedOut = false;
  try {
    const deadline = Date.now() + 65_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null)
        throw new Error(`App exited early: ${child.exitCode}`);
      const log = await readFile(join(data, "runtime.log"), "utf8").catch(
        () => "",
      );
      const candidate = log.match(
        /Springroll is ready at (http:\/\/127\.0\.0\.1:\d+\/)/,
      )?.[1];
      engine = log.match(/Endpoint:\s+(http:\/\/127\.0\.0\.1:\d+\/)/)?.[1];
      if (
        candidate &&
        (await fetch(candidate)
          .then((r) => r.ok)
          .catch(() => false))
      ) {
        base = candidate;
        break;
      }
      await Bun.sleep(200);
    }
    if (!base) throw new Error(`Runtime never became ready. Inspect ${data}`);
    for (const path of ["", "assets/main.js", "assets/main.css", "api/tasks"]) {
      const response = await fetch(new URL(path, base));
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      if (path === "api/tasks" && (await response.json()).length !== 0)
        throw new Error("Smoke workspace was not empty");
    }
    const callback = await fetch(
      new URL(
        "api/connectors/smoke-missing/oauth/callback?error=access_denied",
        base,
      ),
      { redirect: "manual" },
    );
    if (
      callback.status !== 200 ||
      callback.headers.has("location") ||
      !(await callback.text()).includes("Return to Springroll")
    ) {
      throw new Error(
        "Desktop OAuth returned the browser application instead of its completion page",
      );
    }
    console.log(
      `Launch ${launch + 1}: packaged runtime and assets respond from an isolated workspace`,
    );
  } finally {
    child.kill("SIGTERM");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      child.exited,
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), 25_000);
      }),
    ]).finally(() => clearTimeout(timer));
    if (result === "timeout") {
      child.kill("SIGKILL");
      drainTimedOut = true;
    }
  }
  if (drainTimedOut) throw new Error("App did not drain on termination");
  if (
    engine &&
    (await fetch(new URL("health", engine))
      .then(() => true)
      .catch(() => false))
  ) {
    throw new Error("Scheduler remained alive after app exit");
  }
  if (
    base &&
    (await fetch(base)
      .then(() => true)
      .catch(() => false))
  )
    throw new Error("Runtime remained alive after app exit");
}
console.log(
  `Packaged launch/relaunch/termination smoke passed. Test data retained at ${data}`,
);
