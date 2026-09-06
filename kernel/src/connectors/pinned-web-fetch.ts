import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { checkServerIdentity } from "node:tls";

/** Internal transport: address MUST come from the public-address policy check. */
export function fetchAtValidatedAddress(
  target: string,
  address: string,
  init: RequestInit,
): Promise<Response> {
  const url = new URL(target);
  if (!isIP(address)) throw new Error("Expected a validated IP address");
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("Expected HTTP or HTTPS");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const headers = new Headers(init.headers);
  headers.set("host", url.host);
  // Readable text is bounded by the caller. Avoid compressed-body expansion.
  headers.set("accept-encoding", "identity");
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      {
        protocol: url.protocol,
        hostname: address,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: Object.fromEntries(headers),
        agent: false,
        // Never resolve the hostname again or reuse a differently validated socket.
        ...(url.protocol === "https:"
          ? {
              servername: isIP(hostname) ? "" : hostname,
              rejectUnauthorized: true,
              checkServerIdentity: (
                _name: string,
                cert: Parameters<typeof checkServerIdentity>[1],
              ) => checkServerIdentity(hostname, cert),
            }
          : {}),
        ...(init.signal ? { signal: init.signal } : {}),
      },
      (incoming) => {
        const responseHeaders = new Headers();
        for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
          const name = incoming.rawHeaders[i];
          const value = incoming.rawHeaders[i + 1];
          if (name !== undefined && value !== undefined)
            responseHeaders.append(name, value);
        }
        const encoding = responseHeaders.get("content-encoding");
        if (encoding && encoding.toLowerCase() !== "identity") {
          incoming.destroy();
          reject(
            new Error("Public URL ignored the uncompressed response request"),
          );
          return;
        }
        const status = incoming.statusCode ?? 502;
        const bodyless = status === 204 || status === 205 || status === 304;
        const body = bodyless
          ? null
          : (Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>);
        if (bodyless) incoming.resume();
        resolve(new Response(body, { status, headers: responseHeaders }));
      },
    );
    request.once("error", reject);
    request.end();
  });
}
