import { expect, test } from "bun:test";
import { fetchAtValidatedAddress } from "../src/connectors/pinned-web-fetch.ts";

test("connects to the checked address without resolving the URL hostname", async () => {
  let received: { headers: Headers; url: string } | undefined;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      received = { headers: new Headers(request.headers), url: request.url };
      return new Response("checked connection", {
        headers: { "content-type": "text/plain" },
      });
    },
  });
  try {
    // .invalid cannot resolve: success proves no second hostname lookup occurred.
    const result = await fetchAtValidatedAddress(
      `http://rebinding.invalid:${server.port}/read?q=1`,
      "127.0.0.1",
      {},
    );
    expect(await result.text()).toBe("checked connection");
    expect(received?.headers.get("host")).toBe(
      `rebinding.invalid:${server.port}`,
    );
    expect(received?.headers.get("accept-encoding")).toBe("identity");
    expect(received?.url).toContain("/read?q=1");
  } finally {
    await server.stop(true);
  }
});

test("does not follow redirects outside the caller's address checks", async () => {
  let requests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      requests++;
      return new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private" },
      });
    },
  });
  try {
    const result = await fetchAtValidatedAddress(
      `http://redirect.invalid:${server.port}`,
      "127.0.0.1",
      {},
    );
    expect(result.status).toBe(302);
    await result.body?.cancel();
    expect(requests).toBe(1);
  } finally {
    await server.stop(true);
  }
});

test("aborts a pending connection and rejects compressed responses", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/compressed")
        return new Response("compressed", {
          headers: { "content-encoding": "gzip" },
        });
      return new Promise<Response>(() => {});
    },
  });
  try {
    const url = `http://cancel.invalid:${server.port}`;
    const controller = new AbortController();
    const pending = fetchAtValidatedAddress(url, "127.0.0.1", {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow();
    await expect(
      fetchAtValidatedAddress(`${url}/compressed`, "127.0.0.1", {}),
    ).rejects.toThrow("uncompressed");
  } finally {
    await server.stop(true);
  }
});

test("TLS preserves hostname verification when connecting to a checked IP", async () => {
  const { mkdtemp, rm, readFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "springroll-tls-test-"));
  try {
    const key = join(dir, "key.pem");
    const cert = join(dir, "cert.pem");
    const create = Bun.spawn(
      [
        "openssl",
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "1",
        "-subj",
        "/CN=checked.invalid",
        "-addext",
        "subjectAltName=DNS:checked.invalid",
      ],
      { stdout: "ignore", stderr: "pipe" },
    );
    expect(await create.exited).toBe(0);
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      tls: { key: await readFile(key), cert: await readFile(cert) },
      fetch: () => new Response("verified"),
    });
    try {
      const module = new URL(
        "../src/connectors/pinned-web-fetch.ts",
        import.meta.url,
      ).pathname;
      const script = `import {fetchAtValidatedAddress} from ${JSON.stringify(module)};
        const good = await fetchAtValidatedAddress("https://checked.invalid:${server.port}", "127.0.0.1", {});
        if (await good.text() !== "verified") process.exit(1);
        for (const host of ["wrong.invalid", "127.0.0.1"]) {
          try { await fetchAtValidatedAddress("https://"+host+":${server.port}", "127.0.0.1", {}); process.exit(2); }
          catch {}
        }`;
      const child = Bun.spawn([process.execPath, "-e", script], {
        env: { ...process.env, NODE_EXTRA_CA_CERTS: cert },
        stdout: "pipe",
        stderr: "pipe",
      });
      const stderr = await new Response(child.stderr).text();
      expect({ exit: await child.exited, stderr }).toEqual({
        exit: 0,
        stderr: "",
      });
      await expect(
        fetchAtValidatedAddress(
          `https://checked.invalid:${server.port}`,
          "127.0.0.1",
          {},
        ),
      ).rejects.toThrow();
    } finally {
      await server.stop(true);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("supports a checked IPv6 address", async () => {
  const server = Bun.serve({
    hostname: "::1",
    port: 0,
    fetch: () => new Response("ipv6"),
  });
  try {
    const response = await fetchAtValidatedAddress(
      `http://ipv6.invalid:${server.port}`,
      "::1",
      {},
    );
    expect(await response.text()).toBe("ipv6");
  } finally {
    await server.stop(true);
  }
});
