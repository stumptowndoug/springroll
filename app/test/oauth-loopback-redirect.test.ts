import { expect, test } from "bun:test";
import { oauthLoopbackRedirect } from "../src/server/oauth-loopback-redirect.ts";

test("keeps the registered OAuth redirect when only the loopback hostname changes", () => {
  const saved =
    "http://127.0.0.1:59783/api/connectors/neon-default/oauth/callback";
  expect(
    oauthLoopbackRedirect(saved, saved.replace("127.0.0.1", "localhost")),
  ).toBe(saved);
  expect(
    oauthLoopbackRedirect(saved, saved.replace("127.0.0.1", "[::1]")),
  ).toBe(saved);
  for (const incoming of [
    saved.replace("59783", "59784"),
    saved.replace("neon-default", "another-account"),
    saved.replace("127.0.0.1", "example.com"),
    saved.replace("http:", "https:"),
    `${saved}?different=true`,
    saved.replace("127.0.0.1", "user@localhost"),
  ])
    expect(oauthLoopbackRedirect(saved, incoming)).toBe(incoming);
  expect(oauthLoopbackRedirect(undefined, saved)).toBe(saved);
});
