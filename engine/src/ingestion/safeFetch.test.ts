// Real, runnable tests for every safeFetch defense (a)-(i). Every network test
// here spins up a REAL Node http server on 127.0.0.1 and tears it down — no
// external hosts, no mocked-away connection behavior. Only DNS resolution is
// mocked (as the task explicitly permits), and only in the tests that need to
// prove pinning deterministically.
//
// Address-policy note: production `isPrivateIp` rejects loopback, so local test
// servers use the `allowLoopback` policy below, which is identical to the real
// policy for every address EXCEPT 127.0.0.1. The tests that exercise the
// DEFAULT policy (private-address denial, defense b) use IP-literal URLs and a
// real local server and assert the handler is never reached.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import * as net from "node:net";
import * as zlib from "node:zlib";
import { fetchSource, isPrivateIp } from "./safeFetch.ts";
import type { SafeFetchOptions, SafeFetchResult } from "./safeFetch.ts";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

async function startServer(handler: Handler) {
  const server = http.createServer((req, res) => {
    res.on("error", () => {}); // swallow EPIPE on client-aborted connections
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
    },
  };
}

// Same as the production policy except that 127.0.0.1 is treated as reachable
// so a real local test server can be used. Every other address still goes
// through the real default check.
const allowLoopback = (ip: string): boolean => (ip === "127.0.0.1" ? false : isPrivateIp(ip));

function assertUnavailable(result: SafeFetchResult, reasonPrefix: string): void {
  assert.equal(result.status, "unavailable");
  if (result.status === "unavailable") {
    assert.ok(result.reason.startsWith(reasonPrefix), `expected reason to start with "${reasonPrefix}", got "${result.reason}"`);
  }
}

test("(a) scheme allowlist: non-http(s) schemes are rejected before any DNS or socket I/O", async () => {
  for (const bad of [
    "file:///etc/passwd",
    "ftp://example.com/file.txt",
    "data:text/plain,hello",
    "javascript:alert(1)",
    "gopher://example.com/x",
    "telnet://example.com:23/",
  ]) {
    // If DNS were consulted for any of these, the injected resolver throws and
    // the test fails — proving the scheme check runs before any resolution.
    const result = await fetchSource(bad, {
      resolve: async () => {
        throw new Error("resolve() must never be called for a rejected scheme");
      },
    });
    assertUnavailable(result, "scheme_not_allowed");
  }
});

test("happy path: a real local server returns a resolved source", async () => {
  const s = await startServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html>ok</html>");
  });
  try {
    const result = await fetchSource(`${s.baseUrl}/ok`, { isPrivateIp: allowLoopback });
    assert.equal(result.status, "resolved");
    if (result.status === "resolved") {
      assert.equal(result.body.toString(), "<html>ok</html>");
      assert.equal(result.mimeType, "text/html");
    }
  } finally {
    await s.close();
  }
});

test("(b) default policy: private/reserved IP literals are rejected", async () => {
  const privates = [
    "http://10.0.0.1/",
    "http://172.16.0.1/",
    "http://172.31.255.254/",
    "http://192.168.1.1/",
    "http://127.0.0.1/",
    "http://0.0.0.0/",
    "http://169.254.169.254/latest/meta-data/", // cloud metadata endpoint
    "http://169.254.0.5/",
    "http://100.64.0.1/",
    "http://[::1]/",
  ];
  for (const url of privates) {
    const result = await fetchSource(url);
    assertUnavailable(result, "private_or_reserved_address");
  }
});

test("(b) default policy: a REAL loopback server is never contacted — rejection happens before connect", async () => {
  let handlerHit = false;
  const s = await startServer((_req, res) => {
    handlerHit = true;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("you should never see this");
  });
  try {
    const result = await fetchSource(`${s.baseUrl}/secret`);
    assertUnavailable(result, "private_or_reserved_address");
    assert.equal(handlerHit, false, "the private-address fetch must not reach the server");
  } finally {
    await s.close();
  }
});

test("(b) a hostname that RESOLVES to a private address is rejected (DNS result is checked)", async () => {
  const result = await fetchSource("http://evil.example/x", {
    isPrivateIp: allowLoopback,
    resolve: async () => [{ address: "192.168.0.5", family: 4 }],
  });
  assertUnavailable(result, "private_or_reserved_address");
});

test("(b) the REAL system DNS resolver is exercised: localhost resolves to loopback and is rejected, and the server is never contacted", async () => {
  // No injected resolver — this uses the production default (dns.promises.lookup),
  // which resolves "localhost" via the OS hosts file to 127.0.0.1/::1 (both
  // loopback, both private under the DEFAULT policy). No external host is
  // touched. If the default resolver or the private-address check were broken,
  // this fetch would reach the server instead of being rejected.
  let handlerHit = false;
  const s = await startServer((_req, res) => {
    handlerHit = true;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("you should never see this");
  });
  try {
    const result = await fetchSource(`http://localhost:${s.port}/`);
    assertUnavailable(result, "private_or_reserved_address");
    assert.equal(handlerHit, false, "a loopback-resolving hostname must never reach the server");
  } finally {
    await s.close();
  }
});

test("(b) isPrivateIp unit coverage of the address ranges", () => {
  const privates = [
    "10.0.0.1", "10.255.255.255",
    "172.16.0.1", "172.31.255.254",
    "192.168.0.1", "192.168.255.254",
    "127.0.0.1", "127.255.255.255",
    "169.254.0.1", "169.254.169.254",
    "0.0.0.0", "100.64.0.1", "100.127.255.255",
    "192.0.0.1", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1",
    "224.0.0.1", "240.0.0.1",
    "::1", "::", "fc00::1", "fd00::1", "fe80::1", "fec0::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1",
    "not-an-ip", "999.1.1.1",
  ];
  for (const ip of privates) {
    assert.equal(isPrivateIp(ip), true, `${ip} should be private`);
  }
  const publics = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.255.255", "172.32.0.1",
    "169.255.0.1", "11.0.0.1",
    "2606:4700:4700::1111", "::ffff:8.8.8.8", "2001:4860:4860::8888"];
  for (const ip of publics) {
    assert.equal(isPrivateIp(ip), false, `${ip} should be public`);
  }
});

test("(c) DNS-rebinding: the connection is PINNED to the validated IP and the hostname is never re-resolved", async () => {
  const s = await startServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html>pinned</html>");
  });
  try {
    let resolveCalls = 0;
    // Attack simulation: the DNS answer at validation time is 127.0.0.1 (our
    // local server, allowed by the test policy). If the code re-resolved the
    // hostname between validation and connect — the literal rebinding attack —
    // the SECOND answer would be a private IP (10.0.0.5), which would either be
    // rejected or connected to. We assert the second resolution NEVER happens.
    const resolve = async (_hostname: string) => {
      resolveCalls += 1;
      if (resolveCalls === 1) return [{ address: "127.0.0.1", family: 4 }];
      return [{ address: "10.0.0.5", family: 4 }];
    };

    // The hostname is deliberately UNRESOLVABLE in real DNS (RFC 2606 .invalid).
    // If safeFetch re-resolved it at connect time, the real DNS lookup would
    // fail and the fetch would fail — success proves the lookup was pinned.
    let recordedRemoteAddress: string | undefined;
    const createConnection = (options: net.TcpNetConnectOpts) => {
      const socket = net.connect(options);
      socket.on("connect", () => {
        recordedRemoteAddress = socket.remoteAddress;
      });
      return socket;
    };

    const result = await fetchSource(`http://unresolvable.invalid:${s.port}/`, {
      isPrivateIp: allowLoopback,
      resolve,
      createConnection,
    });

    assert.equal(result.status, "resolved");
    if (result.status === "resolved") {
      assert.equal(result.body.toString(), "<html>pinned</html>", "must connect to the real local server");
    }
    assert.equal(resolveCalls, 1, "the hostname must be resolved exactly once — a second resolution is the rebinding attack");
    assert.equal(
      recordedRemoteAddress,
      "127.0.0.1",
      "the socket must actually connect to the pinned validated IP, not a re-resolved one",
    );
  } finally {
    await s.close();
  }
});

test("(d) a redirect to a private address is rejected at hop 2 (re-validation on every hop)", async () => {
  let privateHandlerHit = false;
  const s = await startServer((req, res) => {
    if (req.url === "/start") {
      res.writeHead(302, { Location: "http://10.0.0.5/secret" });
      res.end();
      return;
    }
    privateHandlerHit = true;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("you should never see this");
  });
  try {
    const result = await fetchSource(`${s.baseUrl}/start`, { isPrivateIp: allowLoopback });
    assertUnavailable(result, "private_or_reserved_address");
    assert.equal(privateHandlerHit, false, "hop-2 target must never be reached");
  } finally {
    await s.close();
  }
});

test("(d) a redirect to a non-http scheme is rejected at hop 2 (scheme re-checked per hop)", async () => {
  const s = await startServer((req, res) => {
    if (req.url === "/start") {
      res.writeHead(302, { Location: "file:///etc/passwd" });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end();
  });
  try {
    const result = await fetchSource(`${s.baseUrl}/start`, { isPrivateIp: allowLoopback });
    assertUnavailable(result, "scheme_not_allowed_file");
  } finally {
    await s.close();
  }
});

test("(d) redirect chains are capped at maxRedirects", async () => {
  const s = await startServer((req, res) => {
    const n = Number(req.url?.slice("/r/".length));
    if (Number.isInteger(n) && n >= 0 && n <= 5) {
      res.writeHead(302, { Location: `/r/${n + 1}` });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end();
  });
  try {
    const result = await fetchSource(`${s.baseUrl}/r/0`, { isPrivateIp: allowLoopback, maxRedirects: 5 });
    assertUnavailable(result, "redirect_limit_exceeded");
  } finally {
    await s.close();
  }
});

test("(d) a bounded same-origin redirect chain resolves (manual following works)", async () => {
  const s = await startServer((req, res) => {
    if (req.url === "/a") {
      res.writeHead(302, { Location: "/b" });
      res.end();
      return;
    }
    if (req.url === "/b") {
      res.writeHead(302, { Location: "/c" });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html>final</html>");
  });
  try {
    const result = await fetchSource(`${s.baseUrl}/a`, { isPrivateIp: allowLoopback });
    assert.equal(result.status, "resolved");
    if (result.status === "resolved") {
      assert.equal(result.body.toString(), "<html>final</html>");
      assert.ok(result.finalUrl.endsWith("/c"), `finalUrl should be /c, got ${result.finalUrl}`);
    }
  } finally {
    await s.close();
  }
});

test("(e) a lying Content-Length header over the cap is rejected before the body is read", async () => {
  const s = await startServer((_req, res) => {
    // Claims 1 MB, sends 2 bytes — the header check must reject without
    // waiting for the body.
    res.writeHead(200, { "Content-Type": "text/html", "Content-Length": String(1024 * 1024) });
    res.end("hi");
  });
  try {
    const result = await fetchSource(`${s.baseUrl}/big`, { isPrivateIp: allowLoopback, maxBytes: 1024 });
    assertUnavailable(result, "content_length_exceeded");
  } finally {
    await s.close();
  }
});

test("(e) a chunked body streamed past the cap is aborted mid-stream (no Content-Length)", async () => {
  const s = await startServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    let i = 0;
    const pump = (): void => {
      if (res.destroyed || res.writableEnded) return;
      res.write(Buffer.alloc(1024));
      i += 1;
      if (i < 64) setTimeout(pump, 2);
      else res.end();
    };
    pump();
  });
  try {
    const result = await fetchSource(`${s.baseUrl}/flood`, { isPrivateIp: allowLoopback, maxBytes: 8192 });
    assertUnavailable(result, "response_size_exceeded");
  } finally {
    await s.close();
  }
});

test("(f) a real gzip bomb (small compressed, huge decompressed) is rejected by the DECOMPRESSED cap", async () => {
  // 64 MB of zeros gzip to ~64 KB — tiny on the wire, huge once decoded.
  const bomb = zlib.gzipSync(Buffer.alloc(64 * 1024 * 1024, 0));
  const s = await startServer((_req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/html",
      "Content-Encoding": "gzip",
      "Content-Length": String(bomb.length),
    });
    res.end(bomb);
  });
  try {
    const result = await fetchSource(`${s.baseUrl}/bomb`, {
      isPrivateIp: allowLoopback,
      maxBytes: 1024 * 1024, // compressed (~64 KB) easily passes the wire cap...
      maxDecompressedBytes: 1024 * 1024, // ...but 64 MB of decoded bytes blows this
    });
    assertUnavailable(result, "decompressed_size_exceeded");
  } finally {
    await s.close();
  }
});

test("(f) a gzip-encoded response under both caps resolves with the decoded body", async () => {
  const gz = zlib.gzipSync(Buffer.from("hello world", "utf8"));
  const s = await startServer((_req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/html",
      "Content-Encoding": "gzip",
      "Content-Length": String(gz.length),
    });
    res.end(gz);
  });
  try {
    const result = await fetchSource(`${s.baseUrl}/gz`, {
      isPrivateIp: allowLoopback,
      maxDecompressedBytes: 1024,
    });
    assert.equal(result.status, "resolved");
    if (result.status === "resolved") assert.equal(result.body.toString(), "hello world");
  } finally {
    await s.close();
  }
});

test("(f) an unsupported content-encoding is rejected rather than parsed as garbage", async () => {
  const s = await startServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html", "Content-Encoding": "br" });
    res.end(Buffer.from("not brotli"));
  });
  try {
    const result = await fetchSource(`${s.baseUrl}/br`, { isPrivateIp: allowLoopback });
    assertUnavailable(result, "unsupported_content_encoding");
  } finally {
    await s.close();
  }
});

test("(f) an explicit Content-Encoding: identity is treated as no encoding, not rejected", async () => {
  // RFC 7231 §3.1.2.1: "identity" is a legitimate way for a server to say
  // no transformation was applied. Found in review: this was previously
  // treated as an unsupported encoding, which would have wrongly marked a
  // real report server sending this header as unavailable.
  const s = await startServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html", "Content-Encoding": "identity" });
    res.end("<html>plain</html>");
  });
  try {
    const result = await fetchSource(`${s.baseUrl}/identity`, { isPrivateIp: allowLoopback });
    assert.equal(result.status, "resolved");
    if (result.status === "resolved") {
      assert.equal(result.body.toString(), "<html>plain</html>");
    }
  } finally {
    await s.close();
  }
});

test("(g) an overall wall-clock timeout aborts a server that never responds", async () => {
  const s = await startServer((_req, res) => {
    // Never respond at all.
    void res;
  });
  try {
    const started = Date.now();
    const result = await fetchSource(`${s.baseUrl}/hang`, { isPrivateIp: allowLoopback, timeoutMs: 300 });
    const elapsed = Date.now() - started;
    assertUnavailable(result, "timeout");
    assert.ok(elapsed < 3000, `timeout should fire promptly, took ${elapsed}ms`);
  } finally {
    await s.close();
  }
});

test("(g) the timeout also aborts a slow-drip transfer mid-body", async () => {
  const s = await startServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.write("partial");
    const t = setTimeout(() => res.end("rest"), 5000);
    res.on("close", () => clearTimeout(t));
  });
  try {
    const started = Date.now();
    const result = await fetchSource(`${s.baseUrl}/drip`, { isPrivateIp: allowLoopback, timeoutMs: 400 });
    const elapsed = Date.now() - started;
    assertUnavailable(result, "timeout");
    assert.ok(elapsed < 3000, `slow-drip timeout should fire promptly, took ${elapsed}ms`);
  } finally {
    await s.close();
  }
});

test("(h) MIME allowlist: text/html and application/pdf resolve; everything else is rejected", async () => {
  const s = await startServer((req, res) => {
    const type = req.url?.slice(1) ?? "";
    if (type === "missing") {
      res.writeHead(200);
      res.end("no content type");
      return;
    }
    res.writeHead(200, { "Content-Type": decodeURIComponent(type) });
    res.end("body");
  });
  try {
    const ok = [
      { path: "text/html", expected: "text/html" },
      { path: "text/html%3B%20charset%3Dutf-8", expected: "text/html" },
      { path: "application/pdf", expected: "application/pdf" },
    ];
    for (const { path, expected } of ok) {
      const result = await fetchSource(`${s.baseUrl}/${path}`, { isPrivateIp: allowLoopback });
      assert.equal(result.status, "resolved", `expected ${path} to resolve`);
      if (result.status === "resolved") assert.equal(result.mimeType, expected);
    }

    const rejected = [
      "application/octet-stream",
      "text/plain",
      "application/javascript",
      "application/x-msdownload",
    ];
    for (const path of rejected) {
      const result = await fetchSource(`${s.baseUrl}/${path}`, { isPrivateIp: allowLoopback });
      assertUnavailable(result, "unsupported_content_type");
    }

    // A URL that LOOKS like a PDF but answers as octet-stream is still rejected.
    const pdfExe = await fetchSource(`${s.baseUrl}/report.pdf`, {
      isPrivateIp: allowLoopback,
      maxBytes: undefined,
      maxDecompressedBytes: undefined,
    });
    assert.equal(pdfExe.status, "unavailable", "octet-stream at a .pdf URL must be rejected");
    if (pdfExe.status === "unavailable") {
      assert.ok(pdfExe.reason.startsWith("unsupported_content_type"), `got ${pdfExe.reason}`);
    }

    const missing = await fetchSource(`${s.baseUrl}/missing`, { isPrivateIp: allowLoopback });
    assertUnavailable(missing, "unsupported_content_type_missing");
  } finally {
    await s.close();
  }
});

test("(i) every failure mode produces the SAME result kind: unavailable with a string reason", async () => {
  const s = await startServer((req, res) => {
    if (req.url === "/big") {
      res.writeHead(200, { "Content-Type": "text/html", "Content-Length": String(1024 * 1024) });
      res.end("hi");
      return;
    }
    if (req.url === "/exe") {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end("MZ...");
      return;
    }
    if (req.url === "/hang") return; // never respond
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html>ok</html>");
  });
  try {
    const failures: Array<[string, SafeFetchOptions, string]> = [
      ["ftp://example.com/x", {}, "scheme_not_allowed"],
      ["http://10.0.0.1/", {}, "private_or_reserved_address"],
      [`${s.baseUrl}/big`, { isPrivateIp: allowLoopback, maxBytes: 1024 }, "content_length_exceeded"],
      [`${s.baseUrl}/exe`, { isPrivateIp: allowLoopback }, "unsupported_content_type"],
      [`${s.baseUrl}/hang`, { isPrivateIp: allowLoopback, timeoutMs: 200 }, "timeout"],
    ];
    for (const [url, opts, prefix] of failures) {
      const result = await fetchSource(url, opts);
      assert.equal(result.status, "unavailable");
      if (result.status === "unavailable") {
        assert.equal(typeof result.reason, "string");
        assert.ok(result.reason.length > 0);
        assert.ok(result.reason.startsWith(prefix), `expected "${prefix}"*, got "${result.reason}"`);
      }
    }
    // And a success is a resolved — never both.
    const ok = await fetchSource(`${s.baseUrl}/ok`, { isPrivateIp: allowLoopback });
    assert.equal(ok.status, "resolved");
  } finally {
    await s.close();
  }
});
