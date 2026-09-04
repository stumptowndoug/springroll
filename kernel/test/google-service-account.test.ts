import { describe, expect, test } from "bun:test";
import { createVerify, generateKeyPairSync } from "node:crypto";
import {
  createGoogleServiceAccountTokenExchange,
  parseGoogleServiceAccountKey,
} from "../src/google-service-account.ts";
import type { FetchApi } from "../src/model-connections/openai.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const privateKeyPem = privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();

const serviceAccountJson = JSON.stringify({
  type: "service_account",
  client_email: "springroll@project.iam.gserviceaccount.com",
  private_key: privateKeyPem,
  token_uri: "https://oauth2.googleapis.com/token",
});

const scopes = ["https://www.googleapis.com/auth/webmasters.readonly"];

describe("Google service-account token exchange", () => {
  test("signs a verifiable JWT-bearer grant and caches the token", async () => {
    let tokenRequests = 0;
    const request: FetchApi = async (input, init) => {
      expect(String(input)).toBe("https://oauth2.googleapis.com/token");
      tokenRequests += 1;
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe(
        "urn:ietf:params:oauth:grant-type:jwt-bearer",
      );
      const assertion = body.get("assertion") ?? "";
      const [header = "", claims = "", signature = ""] = assertion.split(".");
      expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
        alg: "RS256",
        typ: "JWT",
      });
      const decodedClaims = JSON.parse(
        Buffer.from(claims, "base64url").toString(),
      );
      expect(decodedClaims).toMatchObject({
        iss: "springroll@project.iam.gserviceaccount.com",
        scope: scopes[0],
        aud: "https://oauth2.googleapis.com/token",
      });
      expect(decodedClaims.exp - decodedClaims.iat).toBe(3600);
      const verifier = createVerify("RSA-SHA256");
      verifier.update(`${header}.${claims}`);
      expect(
        verifier.verify(publicKey, Buffer.from(signature, "base64url")),
      ).toBe(true);
      return Response.json({ access_token: "ya29.token", expires_in: 3599 });
    };

    const exchange = createGoogleServiceAccountTokenExchange({
      fetch: request,
    });
    const first = await exchange.bearerToken(serviceAccountJson, scopes);
    expect(first.token).toBe("ya29.token");
    expect(first.redact).toContain("ya29.token");

    const second = await exchange.bearerToken(serviceAccountJson, scopes);
    expect(second.token).toBe("ya29.token");
    expect(tokenRequests).toBe(1);
  });

  test("refreshes once the cached token nears expiry", async () => {
    let tokenRequests = 0;
    const request: FetchApi = async () => {
      tokenRequests += 1;
      return Response.json({
        access_token: `ya29.token-${tokenRequests}`,
        expires_in: 3599,
      });
    };
    let nowMs = 1_786_000_000_000;
    const exchange = createGoogleServiceAccountTokenExchange({
      fetch: request,
      now: () => new Date(nowMs),
    });
    await exchange.bearerToken(serviceAccountJson, scopes);
    nowMs += 3_580_000;
    const refreshed = await exchange.bearerToken(serviceAccountJson, scopes);
    expect(refreshed.token).toBe("ya29.token-2");
    expect(tokenRequests).toBe(2);
  });

  test("redacts the signed assertion from Google's error responses", async () => {
    let sentAssertion = "";
    const request: FetchApi = async (_input, init) => {
      sentAssertion = new URLSearchParams(String(init?.body)).get(
        "assertion",
      ) as string;
      return new Response(`invalid_grant for ${sentAssertion}`, {
        status: 400,
      });
    };
    const exchange = createGoogleServiceAccountTokenExchange({
      fetch: request,
    });
    const failure = exchange.bearerToken(serviceAccountJson, scopes);
    expect(failure).rejects.toThrow(/400/);
    await failure.catch((error: Error) => {
      expect(sentAssertion.length).toBeGreaterThan(0);
      expect(error.message).not.toContain(sentAssertion);
      expect(error.message).toContain("Confirm the API is enabled");
    });
  });

  test("rejects pasted values that are not a service account key", () => {
    expect(() => parseGoogleServiceAccountKey("AIzaSyExampleApiKey")).toThrow(
      /entire service account JSON key/,
    );
    expect(() =>
      parseGoogleServiceAccountKey(
        JSON.stringify({ type: "authorized_user", client_id: "x" }),
      ),
    ).toThrow(/not a service account key/);
    expect(() =>
      parseGoogleServiceAccountKey(
        JSON.stringify({
          type: "service_account",
          client_email: "a@b.iam.gserviceaccount.com",
        }),
      ),
    ).toThrow(/missing its client_email or private_key/);
    expect(() =>
      parseGoogleServiceAccountKey(
        JSON.stringify({
          type: "service_account",
          client_email: "a@b.iam.gserviceaccount.com",
          private_key: privateKeyPem,
          token_uri: "http://oauth2.googleapis.com/token",
        }),
      ),
    ).toThrow(/must use HTTPS/);
  });
});
