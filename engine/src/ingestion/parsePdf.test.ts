// Tests for real PDF text extraction (parsePdf.ts).
//
// REGRESSION CONTEXT (audit bugs 1 and 3). Until this module existed there was
// no PDF parser anywhere in this codebase: resolveEvidence.ts fetched a PDF,
// hashed the raw bytes, left resolved_text NULL — and still marked the row
// `retrieved`, which the review flow counted as an addressable, check-completing
// source. Every PDF therefore produced UNSUPPORTED ("the evidence did not
// support the claim") when the truth was INDETERMINATE ("Notary could not
// inspect the evidence"). These tests prove text really comes out, that page
// boundaries are real, and — the part that keeps bug 3 closed — that an
// unreadable PDF reports a FAILURE rather than an empty success.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCorruptPdf, buildTextPdf } from "./fixtures/textPdf.ts";
import { extractPdfText, PDF_PAGE_SEPARATOR, PDF_PARSE_TIMEOUT_ERROR, raceWithTimeout } from "./parsePdf.ts";

const PAGE_ONE = "Acme revenue increased 17% in FY25 versus the prior year.";
const PAGE_TWO = "Company-wide actual figures for the fiscal period.";

test("a real PDF's text is actually extracted", async () => {
  const result = await extractPdfText(buildTextPdf([PAGE_ONE]));
  assert.equal(result.ok, true, `expected extraction to succeed: ${JSON.stringify(result)}`);
  assert.ok(result.ok && result.canonicalText.includes("Acme"));
  assert.ok(result.ok && result.canonicalText.includes("17%"));
  assert.ok(result.ok && result.canonicalText.includes("FY25"));
});

test("multi-page canonical text is the pages joined by a blank line, with correct page ranges", async () => {
  const result = await extractPdfText(buildTextPdf([PAGE_ONE, PAGE_TWO]));
  assert.ok(result.ok);
  if (!result.ok) return;

  assert.equal(result.pageCount, 2);
  assert.equal(result.pageRanges.length, 2);

  // Each recorded range must slice out exactly that page's text from the
  // canonical text — that identity is what makes a character offset map back to
  // a page at all.
  const page1 = result.canonicalText.slice(result.pageRanges[0].start, result.pageRanges[0].end);
  const page2 = result.canonicalText.slice(result.pageRanges[1].start, result.pageRanges[1].end);
  assert.ok(page1.includes("Acme"), `page 1 slice: ${page1}`);
  assert.ok(page2.includes("Company-wide"), `page 2 slice: ${page2}`);
  assert.equal(result.pageRanges[0].num, 1);
  assert.equal(result.pageRanges[1].num, 2);
  assert.equal(
    result.canonicalText.slice(result.pageRanges[0].end, result.pageRanges[1].start),
    PDF_PAGE_SEPARATOR,
  );
});

test("the canonical text contains NO synthetic page-separator wording", async () => {
  // pdf-parse's own TextResult.text interleaves "-- 1 of 2 --" markers between
  // pages. Those strings are not in the document, so any canonical text
  // containing them would be locatable text that no source ever wrote — a
  // direct false-quotation risk. The canonical text is built from the per-page
  // texts here for exactly this reason.
  const result = await extractPdfText(buildTextPdf([PAGE_ONE, PAGE_TWO]));
  assert.ok(result.ok);
  assert.ok(result.ok && !/--\s*\d+\s+of\s+\d+\s*--/.test(result.canonicalText), result.ok ? result.canonicalText : "");
});

test("a corrupt PDF reports a failure — it does NOT come back as empty success", async () => {
  // The whole of bug 3 in one assertion: an unreadable payload must be
  // distinguishable from a readable one that says nothing, because the first is
  // "could not inspect" and the second is "inspected and found nothing".
  const result = await extractPdfText(buildCorruptPdf());
  assert.equal(result.ok, false);
  assert.ok(
    !result.ok && (result.reason === "parse_failed" || result.reason === "no_extractable_text"),
    `unexpected reason: ${JSON.stringify(result)}`,
  );
});

test("extractPdfText never throws, whatever bytes it is handed", async () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from("not a pdf at all"), Buffer.from([0x00, 0xff, 0x00, 0xff])]) {
    const result = await extractPdfText(bytes);
    assert.equal(result.ok, false, "garbage must be a result, not an exception");
  }
});

test("a parse that outruns its wall-clock cap rejects with the timeout sentinel", async () => {
  // Driven through the extracted helper with a promise that never settles.
  // Racing a REAL parse against a real clock would be the classic test that
  // passes on a fast machine and fails in CI; this asserts the mechanism
  // deterministically instead. safeFetch already caps the bytes that reach the
  // parser, but bytes are not the only cost a malformed PDF can impose.
  await assert.rejects(
    () => raceWithTimeout(new Promise(() => {}), 1),
    (err: Error) => err.message === PDF_PARSE_TIMEOUT_ERROR,
  );
});

test("raceWithTimeout passes a value through untouched when the work wins", async () => {
  assert.equal(await raceWithTimeout(Promise.resolve("parsed"), 10_000), "parsed");
});
