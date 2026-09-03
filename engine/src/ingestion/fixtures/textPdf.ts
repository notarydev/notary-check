// Minimal, dependency-free PDF builders for tests.
//
// WHY HAND-BUILT. The alternative is checking in a binary fixture, which makes
// the test opaque: a reader cannot see what text the PDF is supposed to contain
// without opening it in a viewer. These builders emit a real, structurally
// valid PDF (catalog, page tree, uncompressed content streams, a correct xref
// table) whose text is written in the source right next to the assertion.
//
// Complementary to fixtures/hostilePdf.ts, which builds ADVERSARIAL payloads to
// exercise the fetch boundary (oversized, slow). These build WELL-FORMED ones,
// to exercise the parser now that one actually exists.

import { Buffer } from "node:buffer";

/** Escapes a string for a PDF literal-string operand. */
function escapePdfString(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/**
 * Builds a valid PDF with one page per entry in `pageTexts`, each page holding
 * that entry's text as a single Helvetica text-showing operation.
 *
 * Deliberately uncompressed (no /Filter): the bytes stay inspectable, and the
 * test is about text extraction, not about stream decoding.
 */
export function buildTextPdf(pageTexts: readonly string[]): Buffer {
  const objects: string[] = [];
  const push = (body: string): number => {
    objects.push(body);
    return objects.length;
  };

  const catalogNum = push("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesNum = push("<placeholder>"); // rewritten once the kids are known
  const fontNum = push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  const pageRefs: string[] = [];
  for (const text of pageTexts) {
    const stream = `BT /F1 12 Tf 72 720 Td (${escapePdfString(text)}) Tj ET`;
    const contentNum = push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageNum = push(
      `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${fontNum} 0 R >> >> /Contents ${contentNum} 0 R >>`,
    );
    pageRefs.push(`${pageNum} 0 R`);
  }
  objects[pagesNum - 1] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pageRefs.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNum} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  // latin1 so every byte of the source string maps 1:1 into the file, keeping
  // the xref offsets computed above correct.
  return Buffer.from(out, "latin1");
}

/**
 * Bytes that claim to be a PDF and are not — the "fetched but unparseable"
 * case. This is the payload class that used to be stored as `retrieved` with
 * NULL text and then counted as an addressable, check-completing source.
 */
export function buildCorruptPdf(): Buffer {
  return Buffer.from("%PDF-1.4\nthis is not actually a pdf body\n%%EOF\n", "latin1");
}
