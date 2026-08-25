export interface OAuthAccountIdentityLookup {
  readonly endpoint: string;
  readonly field: string;
}

export type OAuthAccountFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const displayClaimKeys = [
  "email",
  "preferred_username",
  "login",
  "username",
  "name",
] as const;

const maxAccountLabelLength = 120;

export function oauthAccountLabelFromClaims(
  value: unknown,
  field?: string,
): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (field) return normalizeAccountLabel(record[field]);
  for (const key of displayClaimKeys) {
    const label = normalizeAccountLabel(record[key]);
    if (label) return label;
  }
  return undefined;
}

export function oauthAccountLabelFromIdToken(
  idToken: string | undefined,
): string | undefined {
  return oauthAccountLabelFromClaims(decodeJwtPayload(idToken));
}

export async function fetchOAuthAccountIdentity(
  lookup: OAuthAccountIdentityLookup,
  accessToken: string,
  fetchFn: OAuthAccountFetch,
): Promise<string | undefined> {
  const endpoint = new URL(lookup.endpoint);
  if (endpoint.protocol !== "https:") return undefined;
  if (!lookup.field.trim() || !accessToken.trim()) return undefined;
  try {
    const response = await fetchFn(endpoint, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        "user-agent": "Springroll",
      },
      redirect: "manual",
    });
    if (!response.ok) return undefined;
    return oauthAccountLabelFromClaims(await response.json(), lookup.field);
  } catch {
    return undefined;
  }
}

function decodeJwtPayload(token: string | undefined): unknown {
  if (!token) return undefined;
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1] || parts[1].length > 8_192) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

function normalizeAccountLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const label = value.trim();
  if (!label) return undefined;
  return label.slice(0, maxAccountLabelLength);
}
