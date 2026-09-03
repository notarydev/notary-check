// PDF text extraction (§ Document-class scope for v1 — "HTML/PDF corporate and
// financial reports").
//
// WHY THIS MODULE EXISTS. Until now there was NO PDF parser anywhere in this
// codebase. resolveEvidence.ts fetched a PDF, hashed its raw bytes, left
// resolved_text NULL — and then marked the row `retrieved`. The review flow
// counted a `retrieved` row as an addressable, check-completing source, so a
// PDF nobody could read produced UNSUPPORTED ("the evidence did not support the
// claim") rather than INDETERMINATE ("Notary could not inspect the evidence").
// A locator into a NULL text is not a locator at all, so bug 1 and bug 3 both
// bottom out here: without real extracted text there is nothing to be exact
// ABOUT.
//
// DEPENDENCY NOTE, stated because the brief assumed otherwise: `pdf-parse` at
// v2 is a wrapper around `pdfjs-dist` (plus @napi-rs/canvas), so it is NOT the
// lighter-weight alternative to pdfjs-dist it once was — it IS pdfjs-dist with
// a smaller API. It was still the right pick (a maintained, typed wrapper whose
// per-page text output is exactly the granularity a page-level locator needs),
// but "lighter than pdfjs-dist" is not a true statement about what landed.
//
// CANONICAL TEXT IS BUILT HERE, NOT TAKEN FROM THE LIBRARY. pdf-parse's own
// `TextResult.text` interleaves synthetic page separators ("-- 1 of 2 --")
// between pages. Those strings are NOT in the document, and any canonical text
// containing them would be locatable text that no source ever said — a direct
// false-quotation risk. So the canonical text here is the per-page texts joined
// with a plain blank line, and the page boundaries are returned alongside so a
// character offset maps back to exactly one page.
//
// RESOLUTION HONESTY: this yields page-level coordinates, not bounding boxes.
// The text API returns each page's text as a string with no per-glyph geometry,
// so an (x, y, w, h) rectangle is not derivable from it and is not invented.

import { Buffer } from "node:buffer";
import type { PageRange } from "../evidence/locators.ts";

/** Separator between page texts in the canonical text. Two newlines: a blank
 * line reads as a page break to both a human and the judge's prompt, and adds
 * no word that could be mistaken for document content. */
export const PDF_PAGE_SEPARATOR = "\n\n";

/** Wall-clock cap on a single parse. A malformed or adversarial PDF can make a
 * parser spin; safeFetch already caps the BYTES that get here, but bytes are not
 * the only cost. Matches safeFetch's own 10s default order of magnitude. */
export const DEFAULT_PDF_PARSE_TIMEOUT_MS = 10_000;

export type PdfExtractionResult =
  | {
      ok: true;
      /** Per-page text joined by PDF_PAGE_SEPARATOR — the canonical coordinate space. */
      canonicalText: string;
      /** Half-open [start, end) character ranges, one per page, into canonicalText. */
      pageRanges: PageRange[];
      pageCount: number;
    }
  | { ok: false; reason: PdfExtractionFailure; detail?: string };

export type PdfExtractionFailure =
  | "parse_failed"
  | "parse_timeout"
  | "no_extractable_text";

export interface ParsePdfOptions {
  timeoutMs?: number;
}

/** The sentinel a timed-out parse rejects with. */
export const PDF_PARSE_TIMEOUT_ERROR = "pdf_parse_timeout";

/**
 * Races a promise against a wall-clock cap, rejecting with
 * PDF_PARSE_TIMEOUT_ERROR if the cap wins, and always clearing the timer.
 *
 * Extracted so the timeout is testable deterministically. Asserting it through
 * extractPdfText would mean racing a real parse against a real clock, which is
 * exactly the kind of test that passes on a fast machine and fails in CI —
 * whereas this can be driven with a promise that never settles.
 */
export async function raceWithTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        // Deliberately NOT unref'd. An unref'd timer does not keep the event
        // loop alive, so if the parse promise never settles and nothing else is
        // pending, the loop drains and the race resolves to NOTHING — the timeout
        // silently fails to fire in exactly the situation it exists for. The
        // timer is always cleared in the finally below, so a ref'd timer cannot
        // outlive the call either way.
        timer = setTimeout(() => reject(new Error(PDF_PARSE_TIMEOUT_ERROR)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Extracts a PDF's text into a canonical coordinate space.
 *
 * Never throws: an encrypted, corrupt, or image-only PDF is a RESULT
 * (`ok: false` with a reason), not an exception — because the caller's job is
 * to record "could not parse" as a first-class evidence status, and an
 * exception would tempt a caller into the exact conflation this work exists to
 * remove ("the fetch worked, so the evidence is addressable").
 *
 * `no_extractable_text` is its own reason and NOT an error: a scanned,
 * image-only report is a perfectly well-formed PDF with zero text. It is
 * unusable as locatable evidence all the same, and the distinction matters to
 * whoever has to explain the result.
 */
export async function extractPdfText(bytes: Buffer, options: ParsePdfOptions = {}): Promise<PdfExtractionResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PDF_PARSE_TIMEOUT_MS;
  // Imported lazily so that neither the HTML path nor a process that never sees
  // a PDF pays pdfjs-dist's module-load cost.
  const { PDFParse } = await import("pdf-parse");

  // The narrow surface actually used, so this module does not take a hard
  // structural dependency on the whole pdfjs-backed class.
  interface TextParser {
    getText(): Promise<{ pages: Array<{ num: number; text: string }> }>;
    destroy(): Promise<void>;
  }

  let parser: TextParser | null = null;
  try {
    parser = new PDFParse({ data: new Uint8Array(bytes) }) as unknown as TextParser;
    const result = await raceWithTimeout(parser.getText(), timeoutMs);

    const pages = result.pages ?? [];
    const pageRanges: PageRange[] = [];
    let canonicalText = "";
    for (const page of pages) {
      const text = page.text ?? "";
      if (canonicalText.length > 0) canonicalText += PDF_PAGE_SEPARATOR;
      const start = canonicalText.length;
      canonicalText += text;
      pageRanges.push({ num: page.num, start, end: canonicalText.length });
    }

    if (canonicalText.trim().length === 0) {
      return { ok: false, reason: "no_extractable_text" };
    }
    return { ok: true, canonicalText, pageRanges, pageCount: pages.length };
  } catch (err) {
    const message = (err as Error).message;
    if (message === PDF_PARSE_TIMEOUT_ERROR) {
      return { ok: false, reason: "parse_timeout" };
    }
    return { ok: false, reason: "parse_failed", detail: message };
  } finally {
    // Always release pdfjs's worker/document handles, including on the timeout
    // path where getText() is still running — a leaked worker would outlive the
    // request.
    try {
      await parser?.destroy();
    } catch {
      // best-effort teardown; a destroy failure must not mask the parse result
    }
  }
}
