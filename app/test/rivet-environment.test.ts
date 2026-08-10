import { describe, expect, test } from "bun:test";
import { configureLocalRivetEnvironment } from "../src/server/rivet-environment.ts";

describe("local Rivet environment", () => {
  test("isolates the engine storage root from pre-isolation engines", () => {
    const environment = configureLocalRivetEnvironment(
      {},
      "/tmp/springroll/springroll.sqlite",
    );

    expect(environment).toEqual({
      RIVETKIT_STORAGE_PATH: "/tmp/springroll/rivet-engine",
      RIVET_RUN_ENGINE_HOST: "127.0.0.1",
      RIVET_RUN_ENGINE_PORT: "16441",
      RIVET_ENDPOINT: "http://127.0.0.1:16441",
    });
  });

  test("preserves explicit engine and storage overrides", () => {
    const environment = configureLocalRivetEnvironment(
      {
        RIVETKIT_STORAGE_PATH: "/var/lib/springroll/rivet",
        RIVET_RUN_ENGINE_HOST: "localhost",
        RIVET_RUN_ENGINE_PORT: "26421",
        RIVET_ENDPOINT: "http://localhost:26421",
      },
      "/ignored/springroll.sqlite",
    );

    expect(environment.RIVET_ENDPOINT).toBe("http://localhost:26421");
    expect(environment.RIVETKIT_STORAGE_PATH).toBe("/var/lib/springroll/rivet");
  });
});
