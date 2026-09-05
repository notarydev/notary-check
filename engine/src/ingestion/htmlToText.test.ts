// E9 — htmlToText (parse5-based canonical text).
// Pure tests; no DB, no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { htmlToText } from "./htmlToText.ts";

test("entity-encoded markup is decoded then removed — the production CIA-page defect", () => {
  // This exact shape leaked into a fetched page in production: markup served
  // as escaped text so the old regex never matched it as a tag.
  const html =
    "<html><body>&lt;style type=&quot;text/css&quot;&gt;.x{color:red}&lt;/style&gt;" +
    "<p>The Pacific Ocean contains 714 million cubic kilometers.</p></body></html>";
  const text = htmlToText(html);
  assert.ok(!text.includes("style"), "escaped style markup must not survive: " + text);
  assert.ok(!text.includes("color"), "style body must not survive");
  assert.ok(text.includes("Pacific Ocean contains 714 million cubic kilometers"), "real text must survive");
});

test("plain paragraphs collapse to one trimmed line (existing fixture shape)", () => {
  const text = htmlToText(
    "<html><head><style>.x { color: red }</style></head><body>" +
      "<p>Acme's revenue growth was 12% in FY25.</p>" +
      "<script>window.bad = true</script></body></html>",
  );
  assert.equal(text, "Acme's revenue growth was 12% in FY25.");
});

test("character references are decoded to real characters", () => {
  const text = htmlToText("<p>Cost &amp; volume &mdash; $0.09/GB</p>");
  assert.equal(text, "Cost & volume — $0.09/GB");
});

test("table rows stay matchable: cells of one row adjacent, rows separated", () => {
  const html =
    "<table>" +
    "<tr><td>AWS</td><td>$0.09/GB</td><td>first 10 TB</td></tr>" +
    "<tr><td>Azure</td><td>$0.087/GB</td><td>first 10 TB</td></tr>" +
    "</table>";
  const text = htmlToText(html);
  const lines = text.split("\n");
  assert.equal(lines.length, 2, "each row is its own line: " + text);
  assert.ok(lines[0].includes("$0.09/GB"), "row 1 has the rate: " + lines[0]);
  assert.ok(lines[0].includes("first 10 TB"), "rate and tier stay adjacent: " + lines[0]);
  assert.ok(lines[1].includes("Azure") && lines[1].includes("0.087"), "row 2 is separate");
  assert.ok(!lines[0].includes("Azure"), "rows must not bleed into each other");
});

test("blocks are separated onto lines but a plain page stays one line", () => {
  const one = htmlToText("<div>Hello <span>world</span>.</div>");
  assert.equal(one, "Hello world.");
  const two = htmlToText("<p>First claim.</p><p>Second claim.</p>");
  assert.equal(two, "First claim.\nSecond claim.");
});

test("head/title are dropped; real article content survives", () => {
  const html =
    "<html><head><title>Prices</title></head><body>" +
    "<article><h1>Prices</h1><p>Egress is $0.09/GB.</p></article>" +
    "</body></html>";
  const text = htmlToText(html);
  assert.ok(text.includes("Egress is $0.09/GB"));
  assert.equal(text.split("Prices").length - 1, 1, "only the article heading survives, not <title>");
});

test("empty / script-only pages yield empty text", () => {
  assert.equal(htmlToText("<html><body><script>alert(1)</script><style>x{}</style></body></html>"), "");
});
