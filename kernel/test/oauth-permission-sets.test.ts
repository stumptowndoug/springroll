import { describe, expect, test } from "bun:test";
import { parseConnectorManifest } from "../src/connector-manifest.ts";
import {
  grantedOAuthPermissionSetIds,
  nextOAuthPermissionSetIds,
  oauthScopeForPermissionSets,
  operationAllowedForGrantedPermissions,
} from "../src/oauth-permission-sets.ts";

const gmail = parseConnectorManifest({
  id: "gmail",
  name: "Gmail",
  blurb: "Mail.",
  transport: {
    kind: "http-api",
    baseUrl: "https://gmail.googleapis.com/gmail/v1",
    operations: [
      {
        name: "list_labels",
        description: "List labels.",
        method: "GET",
        path: "/users/me/labels",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        effect: "read",
      },
      {
        name: "send_message",
        description: "Send mail.",
        method: "POST",
        path: "/users/me/messages/send",
        inputSchema: {
          type: "object",
          properties: {
            to: { type: "string" },
            subject: { type: "string" },
            body: { type: "string" },
          },
          required: ["to", "subject", "body"],
          additionalProperties: false,
        },
        bodyEncoding: "gmail-rfc822",
        effect: "write",
        permissionSet: "send",
      },
    ],
  },
  credential: {
    kind: "oauth",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    permissionSets: [
      {
        id: "read",
        label: "Read mail",
        summary: "Search and read.",
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        required: true,
      },
      {
        id: "organize",
        label: "Drafts and organize",
        summary: "Drafts and trash.",
        scopes: ["https://www.googleapis.com/auth/gmail.modify"],
        supersedes: ["read"],
      },
      {
        id: "send",
        label: "Send mail",
        summary: "Send as you.",
        scopes: ["https://www.googleapis.com/auth/gmail.send"],
      },
    ],
  },
});

describe("OAuth permission sets", () => {
  test("defaults a connected Gmail account to read-only", () => {
    expect(grantedOAuthPermissionSetIds({}, gmail)).toEqual(["read"]);
    expect(oauthScopeForPermissionSets(gmail, ["read"])).toBe(
      "https://www.googleapis.com/auth/gmail.readonly",
    );
    expect(
      operationAllowedForGrantedPermissions(
        { name: "send_message", permissionSet: "send" },
        ["read"],
      ),
    ).toBe(false);
  });

  test("adds send without replacing read, and drops readonly when organize supersedes it", () => {
    expect(nextOAuthPermissionSetIds(gmail, {}, "send")).toEqual([
      "read",
      "send",
    ]);
    expect(oauthScopeForPermissionSets(gmail, ["read", "send"])).toBe(
      "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
    );
    expect(
      oauthScopeForPermissionSets(gmail, ["read", "organize", "send"]),
    ).toBe(
      "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send",
    );
  });
});
