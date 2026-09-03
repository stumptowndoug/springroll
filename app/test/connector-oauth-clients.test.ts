import { describe, expect, test } from "bun:test";
import { connectorOAuthClientsFromEnvironment } from "../src/server/connector-oauth-clients.ts";

describe("connector OAuth clients from the environment", () => {
  test("registers Gmail, Calendar, and Drive on the shared Google client", () => {
    const clients = connectorOAuthClientsFromEnvironment({
      SPRINGROLL_GOOGLE_OAUTH_CLIENT_ID:
        "google-client.apps.googleusercontent.com",
      SPRINGROLL_GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
    });
    expect(clients?.gmail).toMatchObject({
      clientId: "google-client.apps.googleusercontent.com",
      authorization: {
        authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        accountIdentity: {
          endpoint: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
          field: "emailAddress",
        },
      },
    });
    expect(
      clients?.["google-calendar"]?.authorization?.accountIdentity,
    ).toEqual({
      endpoint: "https://www.googleapis.com/oauth2/v2/userinfo",
      field: "email",
    });
    expect(clients?.["google-drive"]?.clientId).toBe(
      "google-client.apps.googleusercontent.com",
    );
    expect(clients?.gmail?.clientSecret).toBe("google-secret");
    expect(clients?.slack).toBeUndefined();
  });

  test("does not register Google without its desktop credential secret", () => {
    const clients = connectorOAuthClientsFromEnvironment({
      SPRINGROLL_GOOGLE_OAUTH_CLIENT_ID:
        "google-client.apps.googleusercontent.com",
    });

    expect(clients).toBeUndefined();
  });

  test("registers Slack's confidential client without Google", () => {
    const clients = connectorOAuthClientsFromEnvironment({
      SPRINGROLL_SLACK_OAUTH_CLIENT_ID: "slack-client-id",
      SPRINGROLL_SLACK_OAUTH_CLIENT_SECRET: "slack-secret",
    });
    expect(clients).toEqual({
      slack: {
        clientId: "slack-client-id",
        clientSecret: "slack-secret",
      },
    });
  });

  test("registers all Microsoft 365 connectors on one Entra app", () => {
    const clients = connectorOAuthClientsFromEnvironment({
      SPRINGROLL_MICROSOFT_OAUTH_CLIENT_ID: "entra-client-id",
      SPRINGROLL_MICROSOFT_OAUTH_CLIENT_SECRET: "entra-secret",
      SPRINGROLL_MICROSOFT_OAUTH_TENANT: "organizations",
    });
    expect(Object.keys(clients ?? {})).toEqual([
      "outlook",
      "onedrive",
      "microsoft-teams",
      "sharepoint",
    ]);
    for (const id of Object.keys(clients ?? {})) {
      expect(clients?.[id]?.clientId).toBe("entra-client-id");
      expect(clients?.[id]?.authorization).toMatchObject({
        authorizationEndpoint:
          "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize",
        tokenEndpoint:
          "https://login.microsoftonline.com/organizations/oauth2/v2.0/token",
        accountIdentity: {
          endpoint:
            "https://graph.microsoft.com/v1.0/me?$select=userPrincipalName",
          field: "userPrincipalName",
        },
      });
    }
  });

  test("rejects unsafe Microsoft tenant path values", () => {
    expect(() =>
      connectorOAuthClientsFromEnvironment({
        SPRINGROLL_MICROSOFT_OAUTH_CLIENT_ID: "entra-client-id",
        SPRINGROLL_MICROSOFT_OAUTH_CLIENT_SECRET: "entra-secret",
        SPRINGROLL_MICROSOFT_OAUTH_TENANT: "../common",
      }),
    ).toThrow("SPRINGROLL_MICROSOFT_OAUTH_TENANT");
  });
});
