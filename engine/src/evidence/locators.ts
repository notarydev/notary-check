// Canonical evidence locators — the coordinate systems in which a claim's
// relation to a passage of evidence is recorded, and the pure functions that
// build and RE-DEREFERENCE them.
//
// WHY THIS MODULE EXISTS. Before it, `evidence_match.locator` held a URL or an
// `inline:<hash>` string. Neither identifies a PASSAGE. That is not an
// interface detail: it removes the thing that makes a claim-evidence relation
// inspectable at all, and it means a source that later changes cannot be
// checked against the text that was actually assessed. § Verification pipeline
// step 5 requires every candidate to "resolve to exact displayed text or
// structured value in the preserved evidence" — a URL does not do that.
//
// SCOPE BOUNDARY, load-bearing: everything here is PURE. No database, no I/O,
// no model calls, no clock. Orchestration (which locator a row gets, what
// happens when one fails to resolve) lives in ../review/reviewFlow.ts; this
// module only defines the coordinate systems and the exact arithmetic. That
// separation is what makes the re-dereference step testable without a DB.
//
// THE COORDINATE SYSTEMS, one per evidence class:
//
//   text_offsets  — HTML, plaintext, PDF-extracted text, and caller-supplied
//                   excerpts. The canonical retained text, its sha256, and a
//                   half-open [start, end) character range into THAT text,
//                   plus the exact substring found there. Half-open so that
//                   end - start === quote.length, and so a zero-length range
//                   is representable and rejectable.
//   json_path     — structured payloads. The canonical (key-sorted) JSON, its
//                   sha256, a restricted JSONPath, and the resolved SCALAR at
//                   that path. See the honest-status note on this kind below.
//   unresolvable  — no exact coordinate could be established. This is a
//                   FIRST-CLASS locator value, not an error to swallow: it is
//                   what lets the review flow distinguish "could not inspect"
//                   from "inspected and found nothing", which is exactly the
//                   distinction the UNSUPPORTED / INDETERMINATE split turns on.
//
// PROVENANCE IS PART OF THE COORDINATE, NOT A DECORATION. `provenance` says
// whether the canonical text was FETCHED by this system or SUPPLIED BY THE
// CALLER. A caller-supplied excerpt is perfectly legitimate evidence — it is
// often the only checkable text there is (a paywalled page, a transcript) —
// but the system has NOT proved it came from any URL, and a locator must never
// imply otherwise. When a row carries both a pasted excerpt and a URL, the URL
// is recorded as `associatedUrl` with `provenance: "caller_supplied"`, never as
// the thing the offsets index into. The inverse bug (dropping a supplied
// excerpt in favour of an unresolved URL) is recorded in HANDOFF.md; this
// module must not reintroduce that class of bug in either direction.

import { createHash } from "node:crypto";

/** Which canonical text/coordinate system a locator indexes into. */
export type LocatorContentKind = "html" | "plaintext" | "pdf" | "json" | "inline_excerpt";

/**
 * Whether the canonical text was retrieved by this system from the row's URL,
 * or handed to this system by the caller. Never inferred — always recorded.
 */
export type LocatorProvenance = "fetched" | "caller_supplied";

/** An exact character range into a named canonical text. */
export interface TextOffsetsLocator {
  kind: "text_offsets";
  contentKind: Exclude<LocatorContentKind, "json">;
  provenance: LocatorProvenance;
  /** sha256 of the canonical text the offsets index into. */
  canonicalTextHash: string;
  /** Half-open [start, end) character offsets into that canonical text. */
  start: number;
  end: number;
  /** The exact substring at [start, end), preserving the source's own casing. */
  quote: string;
  /**
   * 1-based page number, for contentKind "pdf" only. A PDF's canonical text is
   * the concatenation of its per-page extracted text, so a character offset
   * maps deterministically to exactly one page (see pageForOffset). This is
   * page-level, NOT bounding-box, resolution: the text extractor returns a
   * page's text as a string with no per-glyph geometry, so an (x, y) rectangle
   * is not derivable here and is deliberately not faked.
   */
  page?: number;
  /**
   * The row's URL when one exists. For provenance "fetched" this is the URL the
   * text came FROM. For "caller_supplied" it is provenance metadata only — the
   * system did not fetch it and makes no claim that the quote appears there.
   */
  associatedUrl: string | null;
}

/** A restricted JSONPath into a canonical, key-sorted JSON payload. */
export interface JsonPathLocator {
  kind: "json_path";
  contentKind: "json";
  provenance: LocatorProvenance;
  /** sha256 of the canonical (key-sorted, no-whitespace) JSON serialization. */
  canonicalTextHash: string;
  /** Restricted JSONPath: `$`, `.key`, and `[index]` segments only. */
  path: string;
  /** The scalar found at `path`, stringified. */
  resolvedValue: string;
  associatedUrl: string | null;
}

/**
 * No exact coordinate could be established. Carried forward deliberately so the
 * caller must handle it, rather than being represented as a null locator that a
 * later reader could mistake for "not looked at yet".
 */
export interface UnresolvableLocator {
  kind: "unresolvable";
  contentKind: LocatorContentKind | null;
  provenance: LocatorProvenance | null;
  reason: UnresolvableReason;
  associatedUrl: string | null;
}

export type UnresolvableReason =
  | "no_canonical_text"
  | "quote_not_found_in_canonical_text"
  | "payload_not_parseable"
  | "payload_revoked"
  | "derived_value_has_no_literal_span";

export type Locator = TextOffsetsLocator | JsonPathLocator | UnresolvableLocator;

/** sha256 hex digest of a string, the one hash function this module uses. */
export function canonicalTextHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Finds the first exact occurrence of `needle` in `haystack`, case-insensitively
 * — the SAME matching rule the deterministic field pass in reviewFlow.ts already
 * uses, so a field that pass resolves is always locatable by this function.
 *
 * Returns half-open [start, end) offsets into `haystack`, or null. The returned
 * offsets index the ORIGINAL string, so the quote sliced from them preserves the
 * source's own casing — case-insensitivity is a matching rule here, never a
 * rewrite of what is recorded.
 *
 * Case folding uses toLowerCase() on both sides. Note the deliberate limit: a
 * character whose lowercase form has a different LENGTH than the original (a
 * handful exist in Unicode, e.g. U+0130) would shift offsets. Guarded below by
 * refusing any match whose sliced quote does not case-insensitively equal the
 * needle, which makes a length-shifted fold a miss rather than a wrong offset.
 */
export function findExactSpan(haystack: string, needle: string): { start: number; end: number } | null {
  if (needle.length === 0) return null;
  const start = haystack.toLowerCase().indexOf(needle.toLowerCase());
  if (start === -1) return null;
  const end = start + needle.length;
  if (end > haystack.length) return null;
  // Guard against a case-fold that changed length: the slice at these offsets
  // must itself be a case-insensitive match for the needle, or this is not a
  // usable coordinate.
  if (haystack.slice(start, end).toLowerCase() !== needle.toLowerCase()) return null;
  return { start, end };
}

/**
 * A page's half-open [start, end) character range within a PDF's canonical
 * text. Produced by the PDF extractor (../ingestion/parsePdf.ts), consumed here
 * only as arithmetic.
 */
export interface PageRange {
  num: number;
  start: number;
  end: number;
}

/**
 * The 1-based page containing `offset`, or undefined when no range covers it.
 * Ranges are half-open, so an offset exactly on a boundary belongs to the page
 * that STARTS there — the same convention as the offsets themselves.
 */
export function pageForOffset(pageRanges: readonly PageRange[], offset: number): number | undefined {
  for (const range of pageRanges) {
    if (offset >= range.start && offset < range.end) return range.num;
  }
  return undefined;
}

export interface BuildTextLocatorInput {
  canonicalText: string | null;
  contentKind: Exclude<LocatorContentKind, "json">;
  provenance: LocatorProvenance;
  /** The literal passage to locate — a claim's own field value, or a judge's source span. */
  needle: string;
  associatedUrl?: string | null;
  /** Precomputed hash of canonicalText; recomputed when omitted. */
  hash?: string;
  /** PDF page boundaries, when the canonical text came from a PDF. */
  pageRanges?: readonly PageRange[];
}

/**
 * Builds a text_offsets locator by actually finding `needle` in `canonicalText`.
 * Returns an `unresolvable` locator — never throws, never guesses an offset —
 * when there is no canonical text or the needle is not in it.
 */
export function buildTextLocator(input: BuildTextLocatorInput): Locator {
  const { canonicalText, contentKind, provenance, needle } = input;
  const associatedUrl = input.associatedUrl ?? null;
  if (canonicalText === null || canonicalText.length === 0) {
    return { kind: "unresolvable", contentKind, provenance, reason: "no_canonical_text", associatedUrl };
  }
  const span = findExactSpan(canonicalText, needle);
  if (span === null) {
    return {
      kind: "unresolvable",
      contentKind,
      provenance,
      reason: "quote_not_found_in_canonical_text",
      associatedUrl,
    };
  }
  const page = input.pageRanges !== undefined ? pageForOffset(input.pageRanges, span.start) : undefined;
  const locator: TextOffsetsLocator = {
    kind: "text_offsets",
    contentKind,
    provenance,
    canonicalTextHash: input.hash ?? canonicalTextHash(canonicalText),
    start: span.start,
    end: span.end,
    quote: canonicalText.slice(span.start, span.end),
    associatedUrl,
  };
  if (page !== undefined) locator.page = page;
  return locator;
}

/** An unresolvable locator with an explicit reason — the honest empty value. */
export function unresolvableLocator(
  reason: UnresolvableReason,
  contentKind: LocatorContentKind | null = null,
  provenance: LocatorProvenance | null = null,
  associatedUrl: string | null = null,
): UnresolvableLocator {
  return { kind: "unresolvable", contentKind, provenance, reason, associatedUrl };
}

// ---------------------------------------------------------------------------
// Structured (JSON) evidence.
//
// HONEST STATUS: no evidence source in this codebase currently produces
// JSON-shaped evidence. resolveEvidence.ts's MIME allowlist admits text/html
// and application/pdf only, and an inline `payload` is registered as text. The
// coordinate system is defined and tested here anyway, because the alternative
// — inventing one ad hoc the first time a structured source appears — is how a
// second locator bug gets written. It is deliberately NOT wired into the review
// flow, and that is stated rather than implied.
// ---------------------------------------------------------------------------

/**
 * Canonical JSON serialization: object keys sorted at every depth, no
 * whitespace. Two payloads that differ only in key order or formatting produce
 * the same canonical text and therefore the same hash, so a path recorded
 * against one still dereferences against the other.
 */
export function canonicalizeJson(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        out[key] = canonical((v as Record<string, unknown>)[key]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(canonical(value));
}

/**
 * Evaluates a RESTRICTED JSONPath against a parsed payload: `$` for the root,
 * `.key` for an object member, `[n]` for an array index. Deliberately no
 * wildcards, filters, recursive descent, or expressions — a locator must
 * identify exactly ONE value, and an expression language is both ambiguous and
 * an evaluation-surface risk on caller-influenced input.
 *
 * Returns undefined for any malformed path or missing member.
 */
export function evaluateJsonPath(root: unknown, path: string): unknown {
  if (path !== "$" && !path.startsWith("$.") && !path.startsWith("$[")) return undefined;
  let current: unknown = root;
  const rest = path.slice(1);
  const tokens = rest.match(/\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\]/g) ?? [];
  // Reject a path with trailing junk the tokenizer did not consume.
  if (tokens.join("") !== rest) return undefined;
  for (const token of tokens) {
    if (current === null || current === undefined) return undefined;
    if (token.startsWith("[")) {
      const index = Number(token.slice(1, -1));
      if (!Array.isArray(current) || index >= current.length) return undefined;
      current = current[index];
    } else {
      if (typeof current !== "object" || Array.isArray(current)) return undefined;
      const key = token.slice(1);
      if (!Object.prototype.hasOwnProperty.call(current as object, key)) return undefined;
      current = (current as Record<string, unknown>)[key];
    }
  }
  return current;
}

export interface BuildJsonLocatorInput {
  payload: unknown;
  path: string;
  provenance: LocatorProvenance;
  associatedUrl?: string | null;
}

/**
 * Builds a json_path locator by actually evaluating `path` against `payload`.
 * Only a SCALAR (string/number/boolean) is a valid locator target: a locator
 * must resolve to a displayable value, and an object or array is a subtree, not
 * a value. Anything else returns an unresolvable locator.
 */
export function buildJsonLocator(input: BuildJsonLocatorInput): Locator {
  const associatedUrl = input.associatedUrl ?? null;
  const resolved = evaluateJsonPath(input.payload, input.path);
  if (resolved === undefined || resolved === null || typeof resolved === "object") {
    return unresolvableLocator("quote_not_found_in_canonical_text", "json", input.provenance, associatedUrl);
  }
  return {
    kind: "json_path",
    contentKind: "json",
    provenance: input.provenance,
    canonicalTextHash: canonicalTextHash(canonicalizeJson(input.payload)),
    path: input.path,
    resolvedValue: String(resolved),
    associatedUrl,
  };
}

// ---------------------------------------------------------------------------
// Re-dereferencing — the half of this module the audit actually turns on.
// ---------------------------------------------------------------------------

export type LocatorResolution =
  | { resolved: true; quote: string }
  | { resolved: false; reason: LocatorResolutionFailure };

export type LocatorResolutionFailure =
  | "locator_is_unresolvable"
  | "no_canonical_text"
  | "canonical_text_hash_mismatch"
  | "offsets_out_of_range"
  | "quote_does_not_match_offsets"
  | "path_no_longer_resolves"
  | "resolved_value_changed";

/**
 * Dereferences a stored locator against the canonical text retained NOW, and
 * confirms it still resolves to the same passage.
 *
 * This is the step whose absence was the bug. Resolution used to happen once,
 * at write time, and every later consumer simply trusted that it had. A match
 * may only be treated as supports/contradicts when THIS function returns
 * resolved: true against the text the row currently holds.
 *
 * Every failure mode is a distinct reason, because they mean different things
 * to an operator: a hash mismatch means the retained text changed under the
 * locator; out-of-range offsets mean it was truncated; a quote mismatch means
 * the offsets point somewhere else now. None of them may be collapsed into a
 * silent false.
 */
export function resolveLocator(locator: Locator, canonicalText: string | null): LocatorResolution {
  if (locator.kind === "unresolvable") {
    return { resolved: false, reason: "locator_is_unresolvable" };
  }
  if (canonicalText === null) {
    return { resolved: false, reason: "no_canonical_text" };
  }

  if (locator.kind === "json_path") {
    // The canonical text for a JSON locator IS the canonical serialization.
    if (canonicalTextHash(canonicalText) !== locator.canonicalTextHash) {
      return { resolved: false, reason: "canonical_text_hash_mismatch" };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(canonicalText);
    } catch {
      return { resolved: false, reason: "path_no_longer_resolves" };
    }
    const value = evaluateJsonPath(parsed, locator.path);
    if (value === undefined || value === null || typeof value === "object") {
      return { resolved: false, reason: "path_no_longer_resolves" };
    }
    if (String(value) !== locator.resolvedValue) {
      return { resolved: false, reason: "resolved_value_changed" };
    }
    return { resolved: true, quote: locator.resolvedValue };
  }

  if (canonicalTextHash(canonicalText) !== locator.canonicalTextHash) {
    return { resolved: false, reason: "canonical_text_hash_mismatch" };
  }
  if (locator.start < 0 || locator.end > canonicalText.length || locator.end <= locator.start) {
    return { resolved: false, reason: "offsets_out_of_range" };
  }
  const actual = canonicalText.slice(locator.start, locator.end);
  // Exact, not case-insensitive: the stored quote was sliced from the canonical
  // text itself, so anything but byte-equality means the text moved.
  if (actual !== locator.quote) {
    return { resolved: false, reason: "quote_does_not_match_offsets" };
  }
  return { resolved: true, quote: actual };
}

/**
 * The human-readable one-line form, for `evidence_match.locator` (NOT NULL,
 * pre-existing). Deliberately lossy — the full locator lives in
 * `locator_json`; this is a label, and nothing may parse it back.
 *
 * A caller_supplied locator SAYS SO in its text, so a reader of the old column
 * alone cannot mistake a pasted excerpt for a fetched-and-verified passage.
 */
export function locatorDisplayString(locator: Locator): string {
  if (locator.kind === "unresolvable") {
    return `unresolvable:${locator.reason}`;
  }
  const origin =
    locator.provenance === "caller_supplied"
      ? `caller-excerpt:${locator.canonicalTextHash.slice(0, 16)}`
      : (locator.associatedUrl ?? `text:${locator.canonicalTextHash.slice(0, 16)}`);
  if (locator.kind === "json_path") {
    return `${origin}#jsonpath=${locator.path}`;
  }
  const pagePart = locator.page !== undefined ? `page=${locator.page}&` : "";
  return `${origin}#${pagePart}chars=${locator.start}-${locator.end}`;
}
