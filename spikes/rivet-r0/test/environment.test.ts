import { describe, expect, test } from "bun:test";
import { configureSpikeEnvironment } from "../src/environment-config.ts";

describe("Rivet spike environment", () => {
  test("defaults to isolated storage and engine coordinates", () => {
    const environment = configureSpikeEnvironment({}, "/tmp/rivet-spike");

    expect(environment).toEqual({
      RIVETKIT_STORAGE_PATH: "/tmp/rivet-spike",
      RIVET_RUN_ENGINE_HOST: "127.0.0.1",
      RIVET_RUN_ENGINE_PORT: "16420",
      RIVET_ENDPOINT: "http://127.0.0.1:16420",
    });
  });

  test("preserves explicit engine and storage overrides", () => {
    const environment = configureSpikeEnvironment(
      {
        RIVETKIT_STORAGE_PATH: "/var/lib/springroll",
        RIVET_RUN_ENGINE_HOST: "localhost",
        RIVET_RUN_ENGINE_PORT: "26420",
        RIVET_ENDPOINT: "http://localhost:26420",
      },
      "/ignored",
    );

    expect(environment.RIVETKIT_STORAGE_PATH).toBe("/var/lib/springroll");
    expect(environment.RIVET_ENDPOINT).toBe("http://localhost:26420");
  });
});
