// Safe source fetching for Notary Check (§ Verification pipeline, step 3,
// "Resolve evidence safely"; § Locked test suite, case 16).
//
// This module is the adversarial-safe front door of the source resolver: every
// source that reaches the pipeline is fetched through here, and EVERY failure
// mode below produces the same result shape — `{ status: "unavailable" }` —
// never a resolved-but-empty or partially-resolved source. Nothing downstream
// may treat an unavailable source as evidence.
//
// Defenses implemented here (each independently testable; see safeFetch.test.ts):
//   (a) scheme allowlist — http/https only, rejected before any DNS or socket I/O;
//   (b) private/reserved address denial — the hostname is resolved ONCE and the
//       resolved address is checked against private/loopback/link-local/reserved
//       ranges (including the 169.254.169.254 cloud-metadata endpoint) BEFORE
//       connecting;
//   (c) DNS-rebinding defense — the connection is PINNED to the exact address
//       validated in (b) by overriding Node's `lookup`, so the hostname is never
//       re-resolved between validation and connection (a second lookup is exactly
//       the rebinding attack surface). The Host header (and TLS servername/SNI)
//       still carry the ORIGINAL hostname, so name-based virtual hosting works
//       while the socket targets the validated IP.
//   (d) manual redirect following, capped at `maxRedirects`, re-running (a)-(c)
//       on EVERY hop — a URL that is safe at hop 1 but redirects to a private
//       address at hop 2 is rejected;
//   (e) byte cap — Content-Length (when present) AND actual streamed bytes are
//       both checked; a server that lies about or omits Content-Length is caught
//       by the streaming check;
//   (f) decompression-bomb protection — the DECOMPRESSED size is capped
//       independently of the compressed size, and the stream is aborted
//       mid-flight if it exceeds the cap;
//   (g) an overall wall-clock timeout on the whole fetch (across all redirect
//       hops) — aborting the request when exceeded;
//   (h) MIME allowlist matching § Document-class scope for v1 (HTML and PDF
//       corporate/financial reports): text/html and application/pdf only; an
//       executable/octet-stream response is rejected even if the URL looks like
//       a .pdf;
//   (i) a single result union (`SafeFetchResult`): unavailable vs resolved, used
//       consistently for every branch.
//
// Cap defaults chosen and why:
//   - MAX_BYTES = 10 MiB and MAX_DECOMPRESSED_BYTES = 10 MiB. The v1 document
//     classes are HTML/PDF corporate/financial reports; a typical financial
//     report PDF is 1-5 MB, so 10 MiB is generous headroom for a legitimate
//     report while still bounding an oversized/hostile payload. Keeping the
//     decompressed cap equal to the wire cap ensures a small gzip payload that
//     decompresses to many times its size (a zip/gzip bomb) is rejected.
//   - TIMEOUT_MS = 10 s. The deterministic verification path targets <2 s and
//     the judge path <4 s (§ Monitoring), so a 10 s ceiling on fetching one
//     source leaves ample slack for a slow-but-legit report on a modest network
//     while bounding a server that never responds or dribbles bytes.
//   - MAX_REDIRECTS = 5. Enough for real-world CDN/preview links (which often
//     redirect 1-3 times), small enough that a redirect loop terminates.
//
// NOTE on test seams: `resolve` (the DNS resolution step), `isPrivateIp` (the
// address policy) and `createConnection` (the socket factory) are injectable so
// the tests can exercise the real connection path against real local servers
// while mocking only DNS. The DEFAULT implementations are the production ones;
// the injection exists to make the attack tests deterministic, not to weaken
// anything.
//
// What this module does NOT do, on purpose: it does not parse HTML or PDF (no
// parser is wired in yet), it does not canonicalize text, and it does not hash
// or persist anything. Deep hardening of a real PDF/office parser (fuzzed /
// malformed-structure payloads) is a SEPARATE, LATER concern once a parser is
// chosen — see fixtures/hostilePdf.ts. This module only fetches bytes safely.

import * as dns from "node:dns";
import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import { PassThrough } from "node:stream";
import type { Duplex } from "node:stream";
import { createGunzip, createInflate } from "node:zlib";

/** One DNS answer, matching `dns.promises.lookup(host, { all: true })`. */
export interface ResolvedAddress {
  address: string;
  family: number;
}

/** The single result union for every branch of this module (defense i). */
export type SafeFetchResult =
  | {
      status: "resolved";
      body: Buffer;
      /** The declared media type (parameters stripped), e.g. "text/html". */
      mimeType: string;
      /** The URL actually fetched after any redirects. */
      finalUrl: string;
      /** Raw response headers, so a downstream parser can read charset etc. */
      headers: http.IncomingHttpHeaders;
    }
  | { status: "unavailable"; reason: string };

export interface SafeFetchOptions {
  /** DNS resolution. Default: `dns.promises.lookup(host, { all: true })`. */
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  /** Address policy. Default: the exported `isPrivateIp`. */
  isPrivateIp?: (ip: string) => boolean;
  /** Socket factory. Default: the http/https agent default. Test-only. */
  createConnection?: (options: net.TcpNetConnectOpts, callback?: () => void) => net.Socket;
  maxRedirects?: number;
  maxBytes?: number;
  maxDecompressedBytes?: number;
  timeoutMs?: number;
}

export const DEFAULT_MAX_REDIRECTS = 5;
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_DECOMPRESSED_BYTES = 10 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 10_000;

const MIME_ALLOWLIST = new Set(["text/html", "application/pdf"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Internal error that carries a machine-readable `reason` string; the public
 * function converts it (and only it) into `{ status: "unavailable", reason }`.
 * Unknown/internal errors map to `fetch_failed` — never to a partial success.
 */
class FetchError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "FetchError";
    this.reason = reason;
  }
}

/**
 * Address policy (defense b). True for any address that is not publicly
 * routable: RFC1918 private, loopback, link-local (including the
 * 169.254.169.254 cloud-metadata endpoint), CGNAT, documentation/reserved
 * ranges, multicast, and IPv6 loopback/ULA/link-local/multicast.
 */
export function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) return isPrivateIpv6(ip);

  const octets = ip.split(".").map(Number);
  if (octets.length !== 4 || octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) {
    // Malformed IPv4 — treat as non-public rather than risk routing to it.
    return true;
  }
  const [a, b, c, d] = octets;
  void d;
  if (a === 10) return true; // RFC1918 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918 172.16.0.0/12
  if (a === 192 && b === 168) return true; // RFC1918 192.168.0.0/16
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16 (incl. 169.254.169.254)
  if (a === 0) return true; // "this host" 0.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments 192.0.0.0/24
  if (a === 192 && b === 0 && c === 2) return true; // documentation 192.0.2.0/24
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18.0.0/15
  if (a === 198 && b === 51 && c === 100) return true; // documentation 198.51.100.0/24
  if (a === 203 && b === 0 && c === 113) return true; // documentation 203.0.113.0/24
  if (a >= 224) return true; // multicast 224.0.0.0/4 and reserved 240.0.0.0/4
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase().split("%")[0]; // strip zone id if present
  // IPv4-mapped addresses: ::ffff:a.b.c.d — re-check as IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isPrivateIp(mapped[1]);

  if (lower === "::1") return true; // loopback
  if (lower === "::") return true; // unspecified
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
    return true; // link-local fe80::/10
  }
  if (lower.startsWith("fec") || lower.startsWith("fed") || lower.startsWith("fee") || lower.startsWith("fef")) {
    return true; // deprecated site-local fec0::/10 — still non-public
  }
  if (lower.startsWith("ff")) return true; // multicast ff00::/8
  return false;
}

/** Default DNS resolver. Only ever called for hostnames, never IP literals. */
async function defaultResolve(hostname: string): Promise<ResolvedAddress[]> {
  return dns.promises.lookup(hostname, { all: true });
}

/** Strip parameters from a Content-Type header: "text/html; charset=utf-8" -> "text/html". */
function parseMediaType(header: string | string[] | undefined): string | undefined {
  if (header === undefined) return undefined;
  const value = Array.isArray(header) ? header[0] : header;
  const mediaType = value.split(";", 1)[0].trim().toLowerCase();
  return mediaType.length > 0 ? mediaType : undefined;
}

/**
 * Resolves and validates ONE URL (defenses a-c): scheme allowlist, single DNS
 * resolution, private-address denial. Returns the validated address to pin.
 */
async function validateTarget(
  currentUrl: URL,
  resolve: (hostname: string) => Promise<ResolvedAddress[]>,
  privateIpCheck: (ip: string) => boolean,
): Promise<{ ip: string; family: number; hostname: string }> {
  const protocol = currentUrl.protocol;
  if (protocol !== "http:" && protocol !== "https:") {
    throw new FetchError(`scheme_not_allowed_${protocol.replace(":", "") || "unknown"}`);
  }

  // URL.hostname wraps IPv6 literals in brackets; strip them for net.isIP.
  const hostname = currentUrl.hostname.startsWith("[") ? currentUrl.hostname.slice(1, -1) : currentUrl.hostname;
  if (hostname.length === 0) throw new FetchError("empty_host");

  const ipLiteral = net.isIP(hostname);
  if (ipLiteral !== 0) {
    // IP literal: no DNS needed, but the address policy STILL applies.
    const ip = hostname;
    const family = ipLiteral === 6 ? 6 : 4;
    if (privateIpCheck(ip)) throw new FetchError(`private_or_reserved_address_${ip}`);
    return { ip, family, hostname };
  }

  // Hostname: resolve exactly once. If ANY resolved address is non-public we
  // reject the whole resolution — with attacker-controlled DNS we cannot assume
  // which answer the OS would pick, so a single private answer fails the fetch.
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolve(hostname);
  } catch {
    throw new FetchError("dns_resolution_failed");
  }
  if (!addresses || addresses.length === 0) throw new FetchError("dns_resolution_failed");
  const privateOne = addresses.find((a) => privateIpCheck(a.address));
  if (privateOne) throw new FetchError(`private_or_reserved_address_${privateOne.address}`);
  const ip = addresses[0].address;
  const family = addresses[0].family === 6 ? 6 : 4;
  return { ip, family, hostname };
}

interface SingleHopInput {
  currentUrl: URL;
  maxBytes: number;
  maxDecompressedBytes: number;
  resolve: NonNullable<SafeFetchOptions["resolve"]>;
  privateIpCheck: (ip: string) => boolean;
  createConnection: SafeFetchOptions["createConnection"];
  signal: AbortSignal;
}

type HopOutcome =
  | { type: "final"; result: SafeFetchResult }
  | { type: "redirect"; nextUrl: URL };

async function singleHop(input: SingleHopInput): Promise<HopOutcome> {
  const { currentUrl, maxBytes, maxDecompressedBytes } = input;

  // Defenses (a)-(c) for THIS hop. A redirect target is validated exactly like
  // the original URL — never trusted because hop 1 was safe.
  const { ip, family, hostname } = await validateTarget(currentUrl, input.resolve, input.privateIpCheck);

  const isHttps = currentUrl.protocol === "https:";
  const AgentClass = isHttps ? https.Agent : http.Agent;
  const agent = new AgentClass({ keepAlive: false });
  if (input.createConnection) {
    agent.createConnection = input.createConnection as unknown as http.Agent["createConnection"];
  }

  // Defense (c): pin the socket to the validated IP. This lookup override
  // IGNORES the hostname it is called with and always returns the validated IP,
  // so a rebinding DNS answer between validation and connect is never consulted.
  // Node 22's default autoSelectFamily invokes lookup with options.all === true
  // and expects the array form; handle both so the pin works in every mode.
  type LookupCallback = (err: Error | null, address?: string | ResolvedAddress[], family?: number) => void;
  const lookup = ((_hostname: string, options: dns.LookupOptions, callback: LookupCallback) => {
    if ((options as { all?: boolean }).all === true) {
      callback(null, [{ address: ip, family }]);
    } else {
      callback(null, ip, family);
    }
  }) as net.LookupFunction;

  const headers: http.OutgoingHttpHeaders = {
    // Original hostname in the Host header (and SNI below) while the socket
    // targets the pinned IP — name-based virtual hosting keeps working.
    Host: currentUrl.host,
    "User-Agent": "notary-check/0.1",
    Accept: "text/html,application/pdf;q=0.9,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate",
  };

  const options: http.RequestOptions = {
    protocol: currentUrl.protocol,
    method: "GET",
    hostname,
    port: currentUrl.port ? Number(currentUrl.port) : undefined,
    path: currentUrl.pathname + currentUrl.search,
    headers,
    agent,
    lookup,
    signal: input.signal,
  };

  const res = await performRequest(isHttps, hostname, options);

  const status = res.statusCode ?? 0;

  // Defense (d): manual redirect following — no library auto-follow.
  if (REDIRECT_STATUSES.has(status) && res.headers.location !== undefined) {
    let nextUrl: URL;
    try {
      nextUrl = new URL(res.headers.location, currentUrl);
    } catch {
      res.destroy();
      throw new FetchError("malformed_redirect_url");
    }
    res.resume(); // drain the redirect body so the socket is freed
    return { type: "redirect", nextUrl };
  }
  if (status >= 300 && status < 400) {
    res.destroy();
    throw new FetchError(`unexpected_redirect_status_${status}`);
  }

  // Defense (h): MIME allowlist (§ Document-class scope for v1) — reject an
  // octet-stream/exe response even if the URL looks like a .pdf. Checked before
  // any body is read.
  const mimeType = parseMediaType(res.headers["content-type"]);
  if (mimeType === undefined || !MIME_ALLOWLIST.has(mimeType)) {
    res.destroy();
    throw new FetchError(`unsupported_content_type_${mimeType ?? "missing"}`);
  }

  // Defense (e): declared Content-Length is checked before reading the body.
  const declaredLength = res.headers["content-length"];
  if (declaredLength !== undefined) {
    const declared = parseInt(String(declaredLength), 10);
    if (!Number.isNaN(declared) && declared > maxBytes) {
      res.destroy();
      throw new FetchError("content_length_exceeded");
    }
  }

  // Defenses (e), (f), (g): stream the body with independent compressed and
  // decompressed caps and the overall timeout applied upstream via the signal.
  const body = await readBody(res, maxBytes, maxDecompressedBytes, res.headers["content-encoding"]);

  return {
    type: "final",
    result: { status: "resolved", body, mimeType, finalUrl: currentUrl.href, headers: res.headers },
  };
}

function performRequest(
  isHttps: boolean,
  hostname: string,
  options: http.RequestOptions,
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const onResponse = (res: http.IncomingMessage): void => resolve(res);
    if (isHttps) {
      // SNI must carry the ORIGINAL hostname even though the socket is pinned
      // to the validated IP — TLS name checks and name-based certs depend on it.
      const req = https.request({ ...options, servername: hostname } as https.RequestOptions, onResponse);
      req.on("error", reject);
      req.end();
    } else {
      const req = http.request(options, onResponse);
      req.on("error", reject);
      req.end();
    }
  });
}

/**
 * Reads the response body, aborting if the compressed bytes exceed `maxBytes`
 * or the decompressed bytes exceed `maxDecompressedBytes` (defenses e, f).
 * content-encoding gzip/deflate is decoded inline; identity (or an absent
 * header) is passed through unchanged; anything else (br, zstd, an invalid
 * token) is rejected rather than parsed as garbage.
 */
function readBody(
  res: http.IncomingMessage,
  maxBytes: number,
  maxDecompressedBytes: number,
  contentEncoding: string | string[] | undefined,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (reason: string): void => {
      if (settled) return;
      settled = true;
      reject(new FetchError(reason));
    };
    const succeed = (buf: Buffer): void => {
      if (settled) return;
      settled = true;
      resolve(buf);
    };

    let decoder: Duplex;
    const encoding = (Array.isArray(contentEncoding) ? contentEncoding[0] : contentEncoding ?? "").toLowerCase();
    // "identity" (RFC 7231 §3.1.2.1) is a legitimate, explicit way for a server
    // to say "no transformation was applied" — treat it the same as an absent
    // header, not as an unsupported encoding. A real report server sending this
    // header explicitly must not be wrongly marked unavailable.
    if (encoding === "" || encoding === "identity") {
      decoder = new PassThrough();
    } else if (encoding.includes("gzip")) {
      decoder = createGunzip();
    } else if (encoding.includes("deflate")) {
      decoder = createInflate();
    } else {
      fail(`unsupported_content_encoding_${encoding}`);
      res.destroy();
      return;
    }

    const chunks: Buffer[] = [];
    let decodedBytes = 0;
    let wireBytes = 0;

    // Compressed/wire cap — a server that omits or lies about Content-Length.
    res.on("data", (chunk: Buffer) => {
      wireBytes += chunk.length;
      if (wireBytes > maxBytes) {
        // Record the reason BEFORE destroying: res.destroy() synchronously emits
        // 'aborted', which would otherwise overwrite this with 'response_truncated'.
        fail("response_size_exceeded");
        res.destroy();
        decoder.destroy();
      }
    });
    res.on("error", () => fail("response_truncated"));
    res.on("aborted", () => fail("response_truncated"));

    // Decompressed cap — the bomb defense: the decoded size is bounded
    // independently of the wire size, and the stream is aborted mid-flight.
    decoder.on("data", (chunk: Buffer) => {
      decodedBytes += chunk.length;
      if (decodedBytes > maxDecompressedBytes) {
        fail("decompressed_size_exceeded");
        res.destroy();
        decoder.destroy();
        return;
      }
      chunks.push(chunk);
    });
    decoder.on("end", () => succeed(Buffer.concat(chunks, decodedBytes)));
    decoder.on("error", () => fail("decompression_failed"));

    res.pipe(decoder);
  });
}

/**
 * Fetches a single source with every defense (a)-(i) applied. Never throws:
 * every failure returns `{ status: "unavailable", reason }`.
 */
export async function fetchSource(url: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxDecompressedBytes = opts.maxDecompressedBytes ?? DEFAULT_MAX_DECOMPRESSED_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const resolve = opts.resolve ?? defaultResolve;
  const privateIpCheck = opts.isPrivateIp ?? isPrivateIp;

  let currentUrl: URL;
  try {
    currentUrl = new URL(url);
  } catch {
    return { status: "unavailable", reason: "malformed_url" };
  }

  // Defense (g): one wall-clock timer spans the ENTIRE operation, including all
  // redirect hops. Aborting the signal destroys whatever request is in flight.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let hop = 0; ; hop++) {
      const outcome = await singleHop({
        currentUrl,
        maxBytes,
        maxDecompressedBytes,
        resolve,
        privateIpCheck,
        createConnection: opts.createConnection,
        signal: controller.signal,
      });
      if (outcome.type === "final") return outcome.result;
      if (hop >= maxRedirects) {
        return { status: "unavailable", reason: `redirect_limit_exceeded_${maxRedirects}` };
      }
      currentUrl = outcome.nextUrl;
    }
  } catch (err) {
    if (controller.signal.aborted) {
      return { status: "unavailable", reason: "timeout" };
    }
    if (err instanceof FetchError) {
      return { status: "unavailable", reason: err.reason };
    }
    return { status: "unavailable", reason: "fetch_failed" };
  } finally {
    clearTimeout(timer);
  }
}
