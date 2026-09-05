/** Browser boundary for the loopback-only desktop API, not remote-user auth. */
export function isAllowedLocalRequest(request: Request): boolean {
  const url = new URL(request.url);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    return false;
  const host = request.headers.get("host");
  if (host && host !== url.host) return false;

  // MCP has its own bearer-token and origin checks. OAuth redirects are
  // cross-site navigations authenticated by the existing one-use state flow.
  if (url.pathname === "/mcp") return true;
  if (
    request.method === "GET" &&
    /^\/api\/connectors\/[^/]+\/oauth\/callback$/.test(url.pathname)
  )
    return true;

  const origin = request.headers.get("origin");
  if (origin !== null && origin !== url.origin) return false;
  const site = request.headers.get("sec-fetch-site");
  if (url.pathname.startsWith("/api/")) {
    // Reject cross-site reads too, including navigations and same-site
    // requests from another local port. Headerless local CLI clients remain
    // supported; they already run with the desktop user's privileges.
    if (site !== null && site !== "same-origin") return false;
  }
  return true;
}
