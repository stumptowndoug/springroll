import type { LocalApplicationOptions } from "./application.ts";

type ConnectorOAuthClients = NonNullable<
  LocalApplicationOptions["connectorOAuthClients"]
>;

const googleAuthorization = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  revocationEndpoint: "https://oauth2.googleapis.com/revoke",
  authorizationParameters: {
    access_type: "offline",
    prompt: "select_account consent",
  },
} as const;

export function connectorOAuthClientsFromEnvironment(
  environment: NodeJS.ProcessEnv,
): ConnectorOAuthClients | undefined {
  const clients = {
    ...googleWorkspaceOAuthClients(environment),
    ...microsoft365OAuthClients(environment),
    ...slackOAuthClients(environment),
  };
  return Object.keys(clients).length > 0 ? clients : undefined;
}

export function microsoft365OAuthClients(
  environment: NodeJS.ProcessEnv,
): ConnectorOAuthClients {
  const clientId = environment.SPRINGROLL_MICROSOFT_OAUTH_CLIENT_ID?.trim();
  const clientSecret =
    environment.SPRINGROLL_MICROSOFT_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return {};
  const tenant =
    environment.SPRINGROLL_MICROSOFT_OAUTH_TENANT?.trim() || "common";
  if (!/^[A-Za-z0-9.-]+$/.test(tenant)) {
    throw new TypeError(
      "SPRINGROLL_MICROSOFT_OAUTH_TENANT must be common, organizations, consumers, a tenant ID, or a verified domain",
    );
  }
  const authority = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
  const authorization = {
    authorizationEndpoint: `${authority}/authorize`,
    tokenEndpoint: `${authority}/token`,
    authorizationParameters: { prompt: "select_account" },
    accountIdentity: {
      endpoint: "https://graph.microsoft.com/v1.0/me?$select=userPrincipalName",
      field: "userPrincipalName",
    },
  } as const;
  const registration = { clientId, clientSecret, authorization } as const;
  return {
    outlook: registration,
    onedrive: registration,
    "microsoft-teams": registration,
    sharepoint: registration,
  };
}

export function googleWorkspaceOAuthClients(
  environment: NodeJS.ProcessEnv,
): ConnectorOAuthClients {
  const clientId = environment.SPRINGROLL_GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret =
    environment.SPRINGROLL_GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId) return {};
  const registration = {
    clientId,
    ...(clientSecret ? { clientSecret } : undefined),
  } as const;
  return {
    gmail: {
      ...registration,
      authorization: {
        ...googleAuthorization,
        accountIdentity: {
          endpoint: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
          field: "emailAddress",
        },
      },
    },
    "google-calendar": {
      ...registration,
      authorization: {
        ...googleAuthorization,
        accountIdentity: {
          endpoint: "https://www.googleapis.com/oauth2/v2/userinfo",
          field: "email",
        },
      },
    },
    "google-drive": {
      ...registration,
      authorization: {
        ...googleAuthorization,
        accountIdentity: {
          endpoint: "https://www.googleapis.com/oauth2/v2/userinfo",
          field: "email",
        },
      },
    },
  };
}

export function slackOAuthClients(
  environment: NodeJS.ProcessEnv,
): ConnectorOAuthClients {
  const clientId = environment.SPRINGROLL_SLACK_OAUTH_CLIENT_ID?.trim();
  const clientSecret = environment.SPRINGROLL_SLACK_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return {};
  return {
    slack: { clientId, clientSecret },
  };
}
