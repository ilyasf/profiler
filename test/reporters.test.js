"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { parseTrace } = require("../src/parser");
const { aggregate } = require("../src/aggregators");
const { fmt, topEntries, formatSection, formatRenderingBuckets, RENDERING_BUCKETS } = require("../src/reporters");
const { getHints, formatHints } = require("../src/heuristics");

const FIXTURE = path.join(__dirname, "fixtures", "simple-trace.json");

// ---------------------------------------------------------------------------
// fmt()
// ---------------------------------------------------------------------------

test("fmt formats a number with 2 decimal places and trailing 'ms'", () => {
  assert.ok(fmt(1.5).endsWith(" ms"));
  assert.ok(fmt(1.5).includes("1.50"));
});

test("fmt right-pads with spaces to align columns", () => {
  const short = fmt(1);
  const longer = fmt(10000);
  assert.equal(short.length, longer.length);
});

// ---------------------------------------------------------------------------
// topEntries()
// ---------------------------------------------------------------------------

test("topEntries returns entries sorted descending by value", () => {
  const map = new Map([["a", 10], ["b", 50], ["c", 25]]);
  const result = topEntries(map, 3);
  assert.deepEqual(result, [["b", 50], ["c", 25], ["a", 10]]);
});

test("topEntries respects the limit", () => {
  const map = new Map([["a", 10], ["b", 50], ["c", 25]]);
  const result = topEntries(map, 2);
  assert.equal(result.length, 2);
  assert.equal(result[0][0], "b");
});

// ---------------------------------------------------------------------------
// formatSection()
// ---------------------------------------------------------------------------

test("formatSection includes the title", () => {
  const map = new Map([["Event", 100]]);
  const output = formatSection("My Title", map, 5);
  assert.ok(output.includes("My Title"));
});

test("formatSection shows (none) for empty map", () => {
  const output = formatSection("Empty Section", new Map(), 5);
  assert.ok(output.includes("(none)"));
});

test("formatSection limits output to topN entries", () => {
  const map = new Map();
  for (let i = 0; i < 10; i++) map.set(`event${i}`, i);
  const output = formatSection("Test", map, 3);
  const lines = output.split("\n").filter((l) => l.includes(" ms "));
  assert.equal(lines.length, 3);
});

// ---------------------------------------------------------------------------
// formatRenderingBuckets()
// ---------------------------------------------------------------------------

test("formatRenderingBuckets includes '=== Important rendering buckets ==='", () => {
  const map = new Map([["Paint", 500]]);
  const output = formatRenderingBuckets(map);
  assert.ok(output.includes("Important rendering buckets"));
});

test("formatRenderingBuckets only shows buckets with value > 0", () => {
  const map = new Map([["Paint", 500], ["Layout", 0]]);
  const output = formatRenderingBuckets(map);
  assert.ok(output.includes("Paint"));
  // Layout with value 0 should NOT appear as a data line
  const lines = output.split("\n").filter((l) => l.includes("Layout"));
  assert.equal(lines.length, 0);
});

test("formatRenderingBuckets shows (none) when all buckets are 0", () => {
  const output = formatRenderingBuckets(new Map());
  assert.ok(output.includes("(none)"));
});

test("RENDERING_BUCKETS includes known keys", () => {
  assert.ok(RENDERING_BUCKETS.includes("Layout"));
  assert.ok(RENDERING_BUCKETS.includes("Paint"));
  assert.ok(RENDERING_BUCKETS.includes("FunctionCall"));
});

// ---------------------------------------------------------------------------
// getHints()
// ---------------------------------------------------------------------------

test("getHints returns empty array when no relevant events", () => {
  const hints = getHints(new Map());
  assert.equal(hints.length, 0);
});

test("getHints fires JS hint when EventDispatch > 0 and FunctionCall > Layout", () => {
  const map = new Map([["EventDispatch", 100], ["FunctionCall", 500], ["Layout", 10]]);
  const hints = getHints(map);
  assert.ok(hints.some((h) => h.includes("Heavy JS")));
});

test("getHints fires layout hint when Layout > 0", () => {
  const map = new Map([["Layout", 100]]);
  const hints = getHints(map);
  assert.ok(hints.some((h) => h.includes("Layout/style")));
});

test("getHints fires layout hint when RecalculateStyles > 0", () => {
  const map = new Map([["RecalculateStyles", 50]]);
  const hints = getHints(map);
  assert.ok(hints.some((h) => h.includes("Layout/style")));
});

test("getHints fires paint hint when Paint > 0", () => {
  const map = new Map([["Paint", 200]]);
  const hints = getHints(map);
  assert.ok(hints.some((h) => h.includes("Paint cost")));
});

test("getHints fires EventDispatch hint when EventDispatch > 0", () => {
  const map = new Map([["EventDispatch", 300]]);
  const hints = getHints(map);
  assert.ok(hints.some((h) => h.includes("EventDispatch")));
});

// ---------------------------------------------------------------------------
// formatHints()
// ---------------------------------------------------------------------------

test("formatHints includes the section header", () => {
  const output = formatHints(new Map());
  assert.ok(output.includes("Heuristic hints"));
});

test("formatHints shows 'no hints' message when map is empty", () => {
  const output = formatHints(new Map());
  assert.ok(output.includes("no hints"));
});

test("formatHints includes dash-prefixed hint lines", () => {
  const map = new Map([["Layout", 100]]);
  const output = formatHints(map);
  assert.ok(output.includes("- Layout/style"));
});

// ---------------------------------------------------------------------------
// Snapshot-style integration test using the fixture
// ---------------------------------------------------------------------------

test("full pipeline produces expected sections from simple-trace.json", () => {
  const events = parseTrace(FIXTURE);
  const aggregates = aggregate(events);
  const { byEventName, byCallFrame, byCategory, scrollRelated } = aggregates;

  const sectionNames = formatSection("Top trace events by CPU time", byEventName, 30);
  assert.ok(sectionNames.includes("FunctionCall"));
  assert.ok(sectionNames.includes("Layout"));

  const sectionFrames = formatSection("Top JS call frames / URLs", byCallFrame, 30);
  assert.ok(sectionFrames.includes("handleScroll"));

  const sectionCat = formatSection("Top categories", byCategory, 30);
  assert.ok(sectionCat.includes("devtools.timeline"));

  const sectionScroll = formatSection("Scroll / rendering related", scrollRelated, 30);
  assert.ok(sectionScroll.includes("Layout") || sectionScroll.includes("EventDispatch"));

  const buckets = formatRenderingBuckets(byEventName);
  assert.ok(buckets.includes("Layout"));
  assert.ok(buckets.includes("Paint"));

  const hints = formatHints(byEventName);
  assert.ok(hints.includes("Layout/style"));
  assert.ok(hints.includes("Paint cost"));
});
