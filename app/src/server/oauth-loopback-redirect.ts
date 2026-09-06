/** Preserve the registered redirect URI when a callback arrives via a loopback alias. */
export function oauthLoopbackRedirect(
  saved: unknown,
  incoming: string,
): string {
  if (typeof saved !== "string") return incoming;
  try {
    const registered = new URL(saved);
    const received = new URL(incoming);
    const hosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    if (
      registered.protocol !== "http:" ||
      received.protocol !== "http:" ||
      !hosts.has(registered.hostname) ||
      !hosts.has(received.hostname) ||
      registered.username ||
      registered.password ||
      received.username ||
      received.password
    )
      return incoming;
    registered.hostname = received.hostname;
    return registered.href === received.href ? saved : incoming;
  } catch {
    return incoming;
  }
}
