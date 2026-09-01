// Hostile PDF/office fixtures for § Locked test suite case 16 (adversarial
// source ingestion: "...and a hostile PDF/office file crafted to crash or hang
// the parser are all rejected as unavailable, never as a resolved (even if
// empty) source").
//
// SCOPE HONESTY, stated plainly: no PDF/office PARSER is wired into the engine
// yet (parsing is a later step once a parser library is chosen), so it is not
// possible in this task to craft a real parser-crashing exploit and prove it is
// rejected. What these fixtures DO prove, with real tests, is that the
// INGESTION-LAYER size and timeout caps from safeFetch.ts catch hostile files
// that are OVERSIZED or SLOW TO TRANSFER — the two properties a "crafted to
// crash or hang" file must have to actually deny service at the fetch boundary.
//
// Deep malicious-parser hardening (fuzzed or malformed-structure PDF/office
// parsing, parser crashes, parser hangs, decompression bombs inside the object
// graph, malicious post-script, etc.) is a SEPARATE, LATER concern once an
// actual PDF/office parser is chosen and wired in (not yet built). Do not claim
// more than what the tests in hostilePdf.test.ts actually exercise.
//
// These are BUILDERS, not checked-in binary blobs: they produce a byte-accurate
// hostile payload on demand so a test server can serve the exact byte count the
// test needs without committing multi-megabyte files to the repo.

import * as zlib from "node:zlib";

// A minimal structurally-plausible PDF header + catalog/page objects, so the
// payload "looks like" a PDF at the byte level while the bulk is filler.
const PDF_PREFIX = Buffer.from(
  "%PDF-1.7\n" +
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
    "2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n",
  "utf8",
);

/** A fake PDF whose total byte size is exactly `byteCount` (mostly zeros). */
export function buildOversizedPdf(byteCount: number): Buffer {
  const filler = Buffer.alloc(Math.max(0, byteCount - PDF_PREFIX.length), 0);
  return Buffer.concat([PDF_PREFIX, filler]);
}

/**
 * A gzip-encoded fake PDF that decompresses to `targetDecompressedBytes` bytes.
 * Zero runs compress to roughly 1/1000 of their size, so the wire payload is
 * tiny while the decompressed payload is huge — the classic gzip-bomb shape.
 */
export function buildPdfGzipBomb(targetDecompressedBytes: number): Buffer {
  return zlib.gzipSync(buildOversizedPdf(targetDecompressedBytes));
}
