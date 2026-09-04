import { describe, expect, test } from "bun:test";
import {
  fetchOAuthAccountIdentity,
  oauthAccountLabelFromClaims,
  oauthAccountLabelFromIdToken,
} from "../src/oauth-account-identity.ts";

describe("OAuth account identity", () => {
  test("reads a declared field and otherwise prefers email-like claims", () => {
    expect(
      oauthAccountLabelFromClaims(
        { emailAddress: "work@example.com", historyId: "1" },
        "emailAddress",
      ),
    ).toBe("work@example.com");
    expect(
      oauthAccountLabelFromClaims({
        sub: "opaque-id",
        name: "Ada",
        email: "ada@example.com",
      }),
    ).toBe("ada@example.com");
    expect(oauthAccountLabelFromClaims({ login: "octocat" })).toBe("octocat");
    expect(
      oauthAccountLabelFromClaims({ emailAddress: "work@example.com" }),
    ).toBeUndefined();
  });

  test("reads display claims from an id_token payload", () => {
    const payload = Buffer.from(
      JSON.stringify({
        sub: "user-1",
        email: "personal@example.com",
        name: "Ada",
      }),
    ).toString("base64url");
    expect(
      oauthAccountLabelFromIdToken(`eyJhbGciOiJub25lIn0.${payload}.`),
    ).toBe("personal@example.com");
    expect(oauthAccountLabelFromIdToken("not-a-jwt")).toBeUndefined();
    expect(oauthAccountLabelFromIdToken(undefined)).toBeUndefined();
  });

  test("fetches a declared HTTPS identity endpoint with the access token", async () => {
    const requests: { readonly url: string; readonly authorization: string }[] =
      [];
    const label = await fetchOAuthAccountIdentity(
      {
        endpoint: "https://api.github.test/user",
        field: "login",
      },
      "access-secret",
      async (input, init) => {
        const url = new URL(String(input));
        requests.push({
          url: url.toString(),
          authorization: new Headers(init?.headers).get("authorization") ?? "",
        });
        return Response.json({ login: "octocat", id: 1 });
      },
    );
    expect(label).toBe("octocat");
    expect(requests).toEqual([
      {
        url: "https://api.github.test/user",
        authorization: "Bearer access-secret",
      },
    ]);
  });

  test("leaves identity blank when the lookup is missing, insecure, or empty", async () => {
    expect(
      await fetchOAuthAccountIdentity(
        { endpoint: "http://api.github.test/user", field: "login" },
        "access-secret",
        async () => {
          throw new Error("should not fetch insecure identity endpoints");
        },
      ),
    ).toBeUndefined();
    expect(
      await fetchOAuthAccountIdentity(
        { endpoint: "https://api.github.test/user", field: "login" },
        "access-secret",
        async () => Response.json({ name: "Ada" }),
      ),
    ).toBeUndefined();
  });
});
