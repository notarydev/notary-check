// Real HTML → canonical text (E9, 2026-09-05).
//
// Replaces resolveEvidence.ts's regex `stripHtml`, which had two production
// defects:
//
//  1. It never decoded HTML character references. An escaped tag like
//     `&lt;style&gt;` is literal text to a regex, so script/style REMOVAL did
//     not fire on pages whose markup was entity-encoded, and the escaped
//     markup leaked into the "text" (seen in production on a fetched CIA
//     page).
//  2. It flattened tables to one blob. Pricing facts live in tables; without
//     row structure there is no way to match a claim against one tier's row.
//
// This module parses with parse5 (a real, spec-compliant HTML parser): it
// decodes character references per the spec, removes non-content subtrees,
// keeps block structure, and emits TABLE rows so each row's cells stay
// adjacent ("$0.09/GB | first 10 TB") instead of being scattered through
// page boilerplate.
//
// The output is still one string (the canonical text a locator's offsets are
// anchored to). Row boundaries are single newlines; everything else collapses
// to single spaces, matching findExactSpan's whitespace-normalised matching.

import { parse } from "parse5";

type Node = {
  nodeName: string;
  value?: string;
  childNodes?: Node[];
  attrs?: Array<{ name: string; value: string }>;
};

const SKIP_TAGS = new Set([
  "script", "style", "noscript", "template", "svg", "head", "link", "meta",
  "iframe", "object", "embed", "textarea", "title",
]);

// Elements that begin a new visual block in the canonical text.
const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "header", "footer", "aside", "nav", "main",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote",
  "pre", "figure", "figcaption", "form", "table", "tr", "caption",
  "br", "hr", "details", "summary",
]);

function nodeName(n: unknown): string {
  const any = n as { nodeName?: string; tagName?: string };
  return (any.nodeName ?? any.tagName ?? "#text").toLowerCase();
}

function isText(n: unknown): boolean {
  return nodeName(n) === "#text";
}

function isComment(n: unknown): boolean {
  return nodeName(n) === "#comment";
}

/** Remove literal (possibly entity-escaped-then-decoded) tag blocks that
 * survived parsing as TEXT — e.g. a page serving `&lt;style&gt;…&lt;/style&gt;`
 * as escaped markup. The parser correctly treats those as text; we scrub the
 * tag-shaped ones so their CSS/JS never becomes canonical text. */
const TAG_BLOCK_RE = /<(style|script|svg|template|noscript|textarea)\b[\s\S]*?<\/\1\s*>/gi;

function scrubTagBlocks(value: string): string {
  const scrubbed = value.replace(TAG_BLOCK_RE, " ");
  return scrubbed.replace(/\s+/g, " ");
}

/** Collapse whitespace runs in a raw concatenation. */
function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Collects canonical text for a subtree into `blocks` (one string per block). */
function collect(node: unknown, blocks: string[], row: string[]): void {
  const name = nodeName(node);
  const any = node as Node;

  if (isComment(node)) return;

  if (isText(node)) {
    const value = scrubTagBlocks(any.value ?? "");
    if (value.trim().length > 0) row.push(value);
    return;
  }

  if (SKIP_TAGS.has(name)) return;

  const childNodes = any.childNodes ?? [];
  if (name === "tr" || name === "td" || name === "th") {
    // A table row: collect cells, join with " | ", and close the row as its
    // own block so a pricing row stays adjacent and matchable.
    const cells: string[] = [];
    let cellBuf: string[] = [];
    const flush = () => {
      const text = collapse(cellBuf.join(""));
      if (text.length > 0) cells.push(text);
      cellBuf = [];
    };
    for (const child of childNodes) {
      const childName = nodeName(child);
      if (childName === "td" || childName === "th") {
        flush();
        const buf: string[] = [];
        collectInline(child, buf);
        const t = collapse(buf.join(""));
        if (t.length > 0) cells.push(t);
      } else {
        collectInline(child, cellBuf);
      }
    }
    flush();
    const rowText = cells.join(" | ");
    if (rowText.length > 0) blocks.push(rowText);
    return;
  }

  if (BLOCK_TAGS.has(name)) {
    const before = row.length;
    for (const child of childNodes) collect(child, blocks, row);
    if (row.length > before || name === "br" || name === "hr") {
      const text = collapse(row.join(""));
      if (text.length > 0) blocks.push(text);
      row.length = 0;
    }
    return;
  }

  for (const child of childNodes) collect(child, blocks, row);
}

/** Inline (no block splitting) collection of a subtree's text. */
function collectInline(node: unknown, out: string[]): void {
  const name = nodeName(node);
  const any = node as Node;
  if (isComment(node)) return;
  if (isText(node)) {
    const value = scrubTagBlocks(any.value ?? "");
    if (value.trim().length > 0) out.push(value);
    return;
  }
  if (SKIP_TAGS.has(name)) return;
  for (const child of any.childNodes ?? []) collectInline(child, out);
}

/**
 * Converts an HTML document (as a utf8 Buffer or string) to canonical text:
 * character references decoded, non-content subtrees removed, blocks on their
 * own lines, table rows as "cell | cell | cell". Returns "" when nothing
 * readable remains.
 */
export function htmlToText(body: Buffer | string): string {
  const raw = typeof body === "string" ? body : body.toString("utf8");
  const document = parse(raw) as unknown;
  const blocks: string[] = [];
  const row: string[] = [];
  const html = (document as { childNodes?: unknown[] }).childNodes ?? [];
  for (const child of html) collect(child, blocks, row);
  const text = collapse(row.join(""));
  if (text.length > 0) blocks.push(text);
  return blocks.join("\n").replace(/[ \t]+\n/g, "\n").trim();
}
