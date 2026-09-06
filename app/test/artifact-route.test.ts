import { describe, expect, test } from "bun:test";
import { type AppApi, createHttpApp } from "../src/server/http-app.ts";

describe("artifact HTTP route", () => {
  test("serves stored bytes with locked-down image headers", async () => {
    const application = {
      readArtifact: async (id: string) =>
        id === "image-1"
          ? {
              bytes: new Uint8Array([1, 2, 3]),
              mediaType: "image/png",
              sha256: "a".repeat(64),
              title: "A Spring Garden",
            }
          : undefined,
    } as unknown as AppApi;
    const http = createHttpApp(application);

    const response = await http.request("/api/artifacts/image-1");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain(
      "sandbox;",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );

    const download = await http.request("/api/artifacts/image-1?download=1");
    expect(download.headers.get("content-disposition")).toBe(
      'attachment; filename="A-Spring-Garden.png"',
    );
  });

  test("returns 404 when metadata or bytes are missing", async () => {
    const application = {
      readArtifact: async () => undefined,
    } as unknown as AppApi;
    const response = await createHttpApp(application).request(
      "/api/artifacts/missing",
    );
    expect(response.status).toBe(404);
  });
});
