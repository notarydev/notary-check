// Locked test case 16 (adversarial source ingestion), hostile PDF/office part.
//
// See fixtures/hostilePdf.ts for the explicit scope statement: deep malicious-
// PARSER hardening (fuzzed/malformed-structure PDF/office payloads that crash
// or hang a real parser) is NOT possible yet because no PDF/office parser is
// wired into the engine. What these tests prove is that the INGESTION-LAYER
// caps — the byte cap and the wall-clock timeout from safeFetch.ts — reject a
// hostile file that is OVERSIZED or SLOW TO TRANSFER, which is the fetch-boundary
// half of "crafted to crash or hang". The parser half is a separate, later
// concern, explicitly deferred in the fixture file.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import * as net from "node:net";
import { fetchSource, isPrivateIp } from "./safeFetch.ts";
import type { SafeFetchResult } from "./safeFetch.ts";
import { buildOversizedPdf, buildPdfGzipBomb } from "./fixtures/hostilePdf.ts";

async function startServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
  const server = http.createServer((req, res) => {
    res.on("error", () => {});
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
    },
  };
}

const allowLoopback = (ip: string): boolean => (ip === "127.0.0.1" ? false : isPrivateIp(ip));

function assertUnavailable(result: SafeFetchResult, prefix: string): void {
  assert.equal(result.status, "unavailable");
  if (result.status === "unavailable") {
    assert.ok(result.reason.startsWith(prefix), `expected "${prefix}"*, got "${result.reason}"`);
  }
}

test("case 16: an oversized PDF (streamed, no Content-Length) is rejected as unavailable, never resolved", async () => {
  const pdf = buildOversizedPdf(256 * 1024);
  const s = await startServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/pdf" });
    res.end(pdf);
  });
  try {
    const result = await fetchSource(`${s.baseUrl}/report.pdf`, {
      isPrivateIp: allowLoopback,
      maxBytes: 64 * 1024,
    });
    assertUnavailable(result, "response_size_exceeded");
  } finally {
    await s.close();
  }
});

test("case 16: an oversized PDF with a lying/declared Content-Length is rejected at the header check", async () => {
  const pdf = buildOversizedPdf(128 * 1024);
  const s = await startServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": String(pdf.length) });
    res.end(pdf);
  });
  try {
    const result = await fetchSource(`${s.baseUrl}/report.pdf`, {
      isPrivateIp: allowLoopback,
      maxBytes: 32 * 1024,
    });
    assertUnavailable(result, "content_length_exceeded");
  } finally {
    await s.close();
  }
});

test("case 16: a gzip-encoded oversized PDF (zip-bomb shape) is rejected by the DECOMPRESSED cap", async () => {
  const bomb = buildPdfGzipBomb(64 * 1024 * 1024); // ~64 MB decompressed, tiny on the wire
  const s = await startServer((_req, res) => {
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Encoding": "gzip",
      "Content-Length": String(bomb.length),
    });
    res.end(bomb);
  });
  try {
    const result = await fetchSource(`${s.baseUrl}/report.pdf.gz`, {
      isPrivateIp: allowLoopback,
      maxBytes: 1024 * 1024,
      maxDecompressedBytes: 1024 * 1024,
    });
    assertUnavailable(result, "decompressed_size_exceeded");
  } finally {
    await s.close();
  }
});

test("case 16: a slow-to-transfer PDF is rejected by the wall-clock timeout, not left hanging", async () => {
  const prefix = buildOversizedPdf(256);
  const s = await startServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/pdf" });
    res.write(prefix);
    const t = setTimeout(() => res.end(Buffer.alloc(1024 * 1024, 0)), 5000); // would exceed caps if it ever arrived
    res.on("close", () => clearTimeout(t));
  });
  try {
    const started = Date.now();
    const result = await fetchSource(`${s.baseUrl}/slow.pdf`, {
      isPrivateIp: allowLoopback,
      maxBytes: 10 * 1024 * 1024,
      timeoutMs: 400,
    });
    const elapsed = Date.now() - started;
    assertUnavailable(result, "timeout");
    assert.ok(elapsed < 3000, `timeout should fire promptly, took ${elapsed}ms`);
  } finally {
    await s.close();
  }
});
