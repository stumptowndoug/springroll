import { describe, expect, test } from "bun:test";
import { type AppApi, createHttpApp } from "../src/server/http-app.ts";
import { isAllowedLocalRequest } from "../src/server/local-request-boundary.ts";

describe("local HTTP boundary", () => {
  test("rejects foreign hosts, origins, null origins and other local ports", () => {
    for (const origin of [
      "https://evil.example",
      "null",
      "http://localhost:4000",
    ]) {
      expect(
        isAllowedLocalRequest(
          new Request("http://localhost:3000/api/runs", {
            headers: { origin },
          }),
        ),
      ).toBe(false);
    }
    expect(
      isAllowedLocalRequest(new Request("http://evil.example/api/runs")),
    ).toBe(false);
    expect(
      isAllowedLocalRequest(
        new Request("http://localhost/api/runs", {
          headers: { host: "evil.example" },
        }),
      ),
    ).toBe(false);
    for (const site of ["same-site", "cross-site", "none"]) {
      expect(
        isAllowedLocalRequest(
          new Request("http://localhost/api/runs", {
            headers: { "sec-fetch-site": site },
          }),
        ),
      ).toBe(false);
    }
  });
  test("permits same-origin app traffic and headerless local clients", () => {
    expect(
      isAllowedLocalRequest(
        new Request("http://localhost:3000/api/runs", {
          headers: {
            origin: "http://localhost:3000",
            "sec-fetch-site": "same-origin",
          },
        }),
      ),
    ).toBe(true);
    expect(
      isAllowedLocalRequest(new Request("http://127.0.0.1:3000/api/runs")),
    ).toBe(true);
  });
  test("allows only GET OAuth callbacks through the navigation exception", () => {
    const url =
      "http://localhost:3000/api/connectors/slack/oauth/callback?state=test";
    expect(
      isAllowedLocalRequest(
        new Request(url, { headers: { "sec-fetch-site": "cross-site" } }),
      ),
    ).toBe(true);
    expect(
      isAllowedLocalRequest(
        new Request(url, {
          method: "POST",
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toBe(false);
  });
  test("rejects a bodyless mutation before invoking its handler", async () => {
    let called = false;
    const app = createHttpApp({
      cancelRun: async () => {
        called = true;
      },
    } as unknown as AppApi);
    const response = await app.request(
      "http://localhost/api/runs/test/cancel",
      { method: "POST", headers: { origin: "https://evil.example" } },
    );
    expect(response.status).toBe(403);
    expect(called).toBe(false);
  });
});
