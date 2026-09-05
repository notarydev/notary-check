// Unit tests for the canonical locator coordinate systems (locators.ts).
//
// These are the REGRESSION TESTS for audit bug 1's foundational half: before
// this module, `evidence_match.locator` held a URL or an `inline:<hash>`
// string, neither of which identifies a passage, and nothing ever
// re-dereferenced a stored locator against the retained text. Everything here
// is pure — no DB, no network — so it runs everywhere and needs no skip guard.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  buildJsonLocator,
  buildTextLocator,
  canonicalizeJson,
  canonicalTextHash,
  evaluateJsonPath,
  findExactSpan,
  locatorDisplayString,
  pageForOffset,
  resolveLocator,
  unresolvableLocator,
  type Locator,
  type TextOffsetsLocator,
} from "./locators.ts";

const TEXT = "Acme's revenue increased 17% in FY25, compared to the prior year.";
const HASH = createHash("sha256").update(TEXT, "utf8").digest("hex");

function textLocator(needle: string, overrides: Partial<TextOffsetsLocator> = {}): TextOffsetsLocator {
  const built = buildTextLocator({
    canonicalText: TEXT,
    contentKind: "html",
    provenance: "fetched",
    needle,
    associatedUrl: "https://example.com/report",
  });
  assert.equal(built.kind, "text_offsets", `expected ${needle} to locate`);
  return { ...(built as TextOffsetsLocator), ...overrides };
}

// ---------------------------------------------------------------------------
// findExactSpan / buildTextLocator
// ---------------------------------------------------------------------------

test("findExactSpan returns half-open offsets whose slice is the needle", () => {
  const span = findExactSpan(TEXT, "revenue");
  assert.ok(span);
  assert.equal(TEXT.slice(span.start, span.end), "revenue");
  assert.equal(span.end - span.start, "revenue".length);
});

test("findExactSpan matches case-insensitively but the offsets index the ORIGINAL casing", () => {
  const span = findExactSpan(TEXT, "ACME");
  assert.ok(span, "matching is case-insensitive, the same rule the deterministic pass uses");
  // Case-insensitivity is a MATCHING rule, never a rewrite of what is recorded:
  // the recorded quote keeps the source's own casing.
  assert.equal(TEXT.slice(span.start, span.end), "Acme");
});

test("findExactSpan returns null for an absent needle and for an empty needle", () => {
  assert.equal(findExactSpan(TEXT, "Globex"), null);
  assert.equal(findExactSpan(TEXT, ""), null, "a zero-length span is not a coordinate");
});

test("buildTextLocator produces a real coordinate: hash, offsets, and the exact quote", () => {
  const locator = textLocator("17%");
  assert.equal(locator.kind, "text_offsets");
  assert.equal(locator.canonicalTextHash, HASH);
  assert.equal(locator.quote, "17%");
  assert.equal(TEXT.slice(locator.start, locator.end), "17%");
  assert.equal(locator.provenance, "fetched");
  assert.equal(locator.associatedUrl, "https://example.com/report");
});

test("buildTextLocator returns an explicit unresolvable locator — never a guessed offset — when the needle is absent", () => {
  const locator = buildTextLocator({
    canonicalText: TEXT,
    contentKind: "html",
    provenance: "fetched",
    needle: "Globex",
  });
  assert.equal(locator.kind, "unresolvable");
  assert.equal(locator.kind === "unresolvable" && locator.reason, "quote_not_found_in_canonical_text");
});

test("buildTextLocator on null/empty canonical text reports no_canonical_text", () => {
  // This is the PDF-with-no-parser case that bug 3 turned into UNSUPPORTED: it
  // must be a first-class "could not inspect", not a silently missing locator.
  const nullText = buildTextLocator({ canonicalText: null, contentKind: "pdf", provenance: "fetched", needle: "x" });
  assert.equal(nullText.kind, "unresolvable");
  assert.equal(nullText.kind === "unresolvable" && nullText.reason, "no_canonical_text");
  const emptyText = buildTextLocator({ canonicalText: "", contentKind: "pdf", provenance: "fetched", needle: "x" });
  assert.equal(emptyText.kind === "unresolvable" && emptyText.reason, "no_canonical_text");
});

// ---------------------------------------------------------------------------
// Provenance — the inline-excerpt half of bug 1.
// ---------------------------------------------------------------------------

test("a caller-supplied excerpt is labelled caller_supplied EVEN WHEN a URL is also present", () => {
  // The MCP layer sends a pasted excerpt AND a URL on one registration, and the
  // engine marks the row retrieved from the excerpt without ever fetching the
  // URL. The locator must not imply the quote was proved to appear at that URL.
  const locator = buildTextLocator({
    canonicalText: TEXT,
    contentKind: "inline_excerpt",
    provenance: "caller_supplied",
    needle: "revenue",
    associatedUrl: "https://example.com/paywalled",
  }) as TextOffsetsLocator;
  assert.equal(locator.provenance, "caller_supplied");
  assert.equal(locator.associatedUrl, "https://example.com/paywalled", "the URL is kept as provenance metadata");
  // And the human-readable form says so too, so a reader of the flat `locator`
  // column alone still cannot mistake it for a fetched-and-verified passage.
  const display = locatorDisplayString(locator);
  assert.ok(display.startsWith("caller-excerpt:"), `expected a caller-excerpt label, got ${display}`);
  assert.ok(!display.includes("example.com"), "a caller-supplied quote must not be displayed under a URL");
});

test("a fetched locator's display string names the URL and the character range", () => {
  assert.equal(locatorDisplayString(textLocator("revenue")), "https://example.com/report#chars=7-14");
});

// ---------------------------------------------------------------------------
// resolveLocator — the re-dereference whose ABSENCE was the bug.
// ---------------------------------------------------------------------------

test("resolveLocator dereferences a good locator against the retained text", () => {
  const result = resolveLocator(textLocator("prior year"), TEXT);
  assert.equal(result.resolved, true);
  assert.equal(result.resolved && result.quote, "prior year");
});

test("resolveLocator REFUSES a locator whose canonical text changed under it", () => {
  // The exact scenario a URL-as-locator could never detect: the source is still
  // there, still fetches, but no longer says what was assessed.
  const locator = textLocator("17%");
  const edited = TEXT.replace("17%", "12%");
  const result = resolveLocator(locator, edited);
  assert.equal(result.resolved, false);
  assert.equal(result.resolved === false && result.reason, "canonical_text_hash_mismatch");
});

test("resolveLocator REFUSES out-of-range offsets and a quote that no longer sits at them", () => {
  // Distinct reasons on purpose: truncation and relocation mean different
  // things to whoever has to explain the result.
  const truncated = textLocator("prior year", { start: 1000, end: 1010 });
  assert.equal(resolveLocator(truncated, TEXT).resolved, false);
  const outOfRange = resolveLocator(truncated, TEXT);
  assert.equal(outOfRange.resolved === false && outOfRange.reason, "offsets_out_of_range");

  const moved = textLocator("prior year", { quote: "prior year", start: 0, end: 10 });
  const wrongQuote = resolveLocator(moved, TEXT);
  assert.equal(wrongQuote.resolved, false);
  assert.equal(wrongQuote.resolved === false && wrongQuote.reason, "quote_does_not_match_offsets");

  const inverted = textLocator("prior year", { start: 10, end: 10 });
  const zeroLength = resolveLocator(inverted, TEXT);
  assert.equal(zeroLength.resolved, false);
  assert.equal(zeroLength.resolved === false && zeroLength.reason, "offsets_out_of_range");
});

test("resolveLocator never resolves an unresolvable locator, and never resolves against absent text", () => {
  const un = unresolvableLocator("payload_revoked", "html", "fetched", null);
  const r1 = resolveLocator(un, TEXT);
  assert.equal(r1.resolved, false);
  assert.equal(r1.resolved === false && r1.reason, "locator_is_unresolvable");

  // Bug 4's read-side guarantee expressed as arithmetic: once the payload is
  // shredded there is no canonical text, so no stored locator can resolve.
  const r2 = resolveLocator(textLocator("revenue"), null);
  assert.equal(r2.resolved, false);
  assert.equal(r2.resolved === false && r2.reason, "no_canonical_text");
});

// ---------------------------------------------------------------------------
// PDF page coordinates.
// ---------------------------------------------------------------------------

test("pageForOffset maps a character offset to exactly one page, half-open at the boundary", () => {
  const ranges = [
    { num: 1, start: 0, end: 10 },
    { num: 2, start: 12, end: 20 },
  ];
  assert.equal(pageForOffset(ranges, 0), 1);
  assert.equal(pageForOffset(ranges, 9), 1);
  assert.equal(pageForOffset(ranges, 12), 2, "an offset on a boundary belongs to the page that STARTS there");
  assert.equal(pageForOffset(ranges, 11), undefined, "the separator between pages belongs to no page");
  assert.equal(pageForOffset(ranges, 99), undefined);
});

test("a PDF locator carries a page number and shows it in the display string", () => {
  const pdfText = "page one text\n\npage two text";
  const locator = buildTextLocator({
    canonicalText: pdfText,
    contentKind: "pdf",
    provenance: "fetched",
    needle: "page two text",
    associatedUrl: "https://example.com/report.pdf",
    pageRanges: [
      { num: 1, start: 0, end: 13 },
      { num: 2, start: 15, end: 28 },
    ],
  }) as TextOffsetsLocator;
  assert.equal(locator.page, 2);
  assert.equal(locatorDisplayString(locator), "https://example.com/report.pdf#page=2&chars=15-28");
});

// ---------------------------------------------------------------------------
// Structured (JSON) evidence. Defined and tested, deliberately not yet wired
// into the review flow — no evidence source in this codebase produces JSON.
// ---------------------------------------------------------------------------

test("canonicalizeJson sorts keys at every depth so formatting differences hash the same", () => {
  const a = { b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } };
  const b = { a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 };
  assert.equal(canonicalizeJson(a), canonicalizeJson(b));
  assert.equal(canonicalTextHash(canonicalizeJson(a)), canonicalTextHash(canonicalizeJson(b)));
});

test("evaluateJsonPath handles the restricted grammar and rejects everything else", () => {
  const payload = { report: { metrics: [{ name: "revenue", value: 17 }] } };
  assert.equal(evaluateJsonPath(payload, "$.report.metrics[0].value"), 17);
  assert.equal(evaluateJsonPath(payload, "$.report.metrics[0].name"), "revenue");
  assert.equal(evaluateJsonPath(payload, "$.report.missing"), undefined);
  assert.equal(evaluateJsonPath(payload, "$.report.metrics[9]"), undefined);
  // No wildcards, filters, or recursive descent: a locator must identify
  // exactly one value, and an expression language on caller-influenced input is
  // both ambiguous and an evaluation-surface risk.
  assert.equal(evaluateJsonPath(payload, "$.report.metrics[*].value"), undefined);
  assert.equal(evaluateJsonPath(payload, "$..value"), undefined);
  assert.equal(evaluateJsonPath(payload, "report.metrics[0]"), undefined, "a path must be rooted at $");
});

test("buildJsonLocator resolves a scalar, and refuses a subtree", () => {
  const payload = { report: { metrics: [{ name: "revenue", value: 17 }] } };
  const scalar = buildJsonLocator({ payload, path: "$.report.metrics[0].value", provenance: "fetched" });
  assert.equal(scalar.kind, "json_path");
  assert.equal(scalar.kind === "json_path" && scalar.resolvedValue, "17");

  // An object is a subtree, not a displayable value.
  const subtree = buildJsonLocator({ payload, path: "$.report", provenance: "fetched" });
  assert.equal(subtree.kind, "unresolvable");
});

test("a json_path locator re-resolves, and refuses when the value at the path changed", () => {
  const payload = { report: { value: 17 } };
  const locator = buildJsonLocator({ payload, path: "$.report.value", provenance: "fetched" }) as Locator;
  const canonical = canonicalizeJson(payload);
  assert.equal(resolveLocator(locator, canonical).resolved, true);

  const changed = canonicalizeJson({ report: { value: 12 } });
  const result = resolveLocator(locator, changed);
  assert.equal(result.resolved, false);
  // The hash guard fires first — the payload as a whole is no longer the one
  // the path was recorded against.
  assert.equal(result.resolved === false && result.reason, "canonical_text_hash_mismatch");
});

// --- E-LOC: real web pages are not byte-exact -----------------------------
//
// The regression these guard: 16 claims against 8 fetched pages all came back
// INDETERMINATE / checks_did_not_complete because a multi-word value that WAS
// in the text could not be found across a line break.

test("a phrase broken across a newline is still located", () => {
  const html = "Understanding AWS\negress pricing for large transfers.";
  const span = findExactSpan(html, "AWS egress pricing");
  assert.ok(span, "a line break inside a phrase must not hide it");
  assert.equal(html.slice(span.start, span.end), "AWS\negress pricing");
});

test("collapsed and non-breaking whitespace are both tolerated", () => {
  const html = "the data egress   rate is $0.09/GB";
  const span = findExactSpan(html, "data egress rate");
  assert.ok(span, "nbsp and repeated spaces are whitespace, not different words");
  assert.equal(html.slice(span.start, span.end), "data egress   rate");
});

test("offsets are returned into the ORIGINAL text, so the quote round-trips", () => {
  const html = "prefix   ---   internet\n\negress\tcost   suffix";
  const span = findExactSpan(html, "internet egress cost");
  assert.ok(span);
  // The whole point: the stored locator must still re-dereference against the
  // canonical text. Normalised coordinates would silently drift.
  assert.equal(html.slice(span.start, span.end).replace(/\s+/g, " "), "internet egress cost");
});

test("whitespace tolerance is NOT fuzzy matching — a paraphrase must still miss", () => {
  const html = "the internet egress cost is high";
  assert.equal(findExactSpan(html, "internet egress costs"), null, "a plural is a different word");
  assert.ok(findExactSpan(html, "internet egress"), "a genuine prefix phrase still matches");
  assert.equal(findExactSpan(html, "egress internet cost"), null, "word order must still matter");
  assert.equal(findExactSpan(html, "internet-egress cost"), null, "punctuation is not whitespace");
});

test("a single token takes the exact path and is unaffected", () => {
  assert.equal(findExactSpan("value is 17%", "17%")?.start, 9);
  assert.equal(findExactSpan("value is 17%", "18%"), null);
});
