#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

// ── CLI argument parsing ──────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let input = "performance.json";
let topN = 30;
let mainThreadOnly = false;
let filterTid = null;

const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--main-thread-only") {
    mainThreadOnly = true;
  } else if (argv[i] === "--tid") {
    filterTid = Number(argv[++i]);
  } else {
    positional.push(argv[i]);
  }
}
if (positional[0]) input = positional[0];
if (positional[1]) topN = Number(positional[1]);

if (!fs.existsSync(input)) {
  console.error(`File not found: ${input}`);
  process.exit(1);
}

// ── Load and parse trace ──────────────────────────────────────────────────────
const raw = JSON.parse(fs.readFileSync(input, "utf8"));
const events = Array.isArray(raw) ? raw : raw.traceEvents || [];

// ── Build thread name map (pid:tid → name) ────────────────────────────────────
const threadNames = new Map();
for (const e of events) {
  if (e.ph === "M" && e.name === "thread_name") {
    const key = `${e.pid}:${e.tid}`;
    if (e.args && e.args.name) threadNames.set(key, e.args.name);
  }
}

// Main renderer thread is named "CrRendererMain" or "main".
const mainThreadKeys = new Set(
  [...threadNames.entries()]
    .filter(([, name]) => name === "CrRendererMain" || name === "main")
    .map(([key]) => key)
);

if (mainThreadOnly && mainThreadKeys.size === 0) {
  console.warn(
    "Warning: --main-thread-only specified but no CrRendererMain/main thread found in trace; showing all threads."
  );
}

// ── Filter complete events (ph === "X") ───────────────────────────────────────
function isIncluded(e) {
  if (e.ph !== "X") return false;
  if (filterTid !== null && e.tid !== filterTid) return false;
  if (mainThreadOnly && mainThreadKeys.size > 0) {
    if (!mainThreadKeys.has(`${e.pid}:${e.tid}`)) return false;
  }
  return true;
}

const completeEvents = events.filter(isIncluded);

// ── Self-time computation ─────────────────────────────────────────────────────
// Group complete events by pid:tid, then for each thread use a stack-based
// algorithm: self time = total duration − duration of direct children.
const byThread = new Map();
for (const e of completeEvents) {
  const key = `${e.pid}:${e.tid}`;
  if (!byThread.has(key)) byThread.set(key, []);
  byThread.get(key).push(e);
}

const selfTimeMap = new Map(); // event object → self duration (µs)

for (const threadEvents of byThread.values()) {
  // Sort by start timestamp asc; ties broken by duration desc so a parent
  // (larger span) comes before a child that starts at the same µs.
  threadEvents.sort((a, b) =>
    a.ts !== b.ts ? a.ts - b.ts : (b.dur || 0) - (a.dur || 0)
  );

  for (const e of threadEvents) {
    selfTimeMap.set(e, e.dur || 0);
  }

  const stack = []; // { end: number, event: object }
  for (const e of threadEvents) {
    const start = e.ts || 0;
    const dur = e.dur || 0;

    // Pop events that have already ended.
    while (stack.length && stack[stack.length - 1].end <= start) {
      stack.pop();
    }

    // Subtract this child's duration from the direct parent's self time.
    if (stack.length) {
      const parent = stack[stack.length - 1].event;
      selfTimeMap.set(parent, Math.max(0, selfTimeMap.get(parent) - dur));
    }

    stack.push({ end: start + dur, event: e });
  }
}

// ── Aggregate stats ───────────────────────────────────────────────────────────
// Each map value: { count, total (µs), self (µs), max (µs) }
function makeStats() {
  return { count: 0, total: 0, self: 0, max: 0 };
}

function addStats(map, key, totalUs, selfUs) {
  if (!key) return;
  const s = map.get(key) || makeStats();
  s.count += 1;
  s.total += totalUs;
  s.self += selfUs;
  if (totalUs > s.max) s.max = totalUs;
  map.set(key, s);
}

const byEventName = new Map();
const byCallFrame = new Map();
const byCategory = new Map();
const scrollRelated = new Map();

for (const e of completeEvents) {
  const totalUs = e.dur || 0;
  const selfUs = selfTimeMap.get(e);
  const name = e.name || "(unnamed)";
  const cat = e.cat || "(no-category)";
  const args = e.args || {};
  const data = args.data || {};
  const beginData = args.beginData || {};

  addStats(byEventName, name, totalUs, selfUs);
  addStats(byCategory, cat, totalUs, selfUs);

  // Try to extract JS function / frame info
  const frame =
    data.url || data.functionName || data.scriptName || beginData.url || beginData.frame;

  let frameLabel = null;
  if (data.functionName || data.url) {
    frameLabel = `${data.functionName || "(anonymous)"} @ ${data.url || data.scriptName || "(inline)"}`;
  } else if (args.callFrame) {
    const cf = args.callFrame;
    frameLabel = `${cf.functionName || "(anonymous)"} @ ${cf.url || "(inline)"}:${cf.lineNumber ?? "?"}`;
  } else if (frame) {
    frameLabel = String(frame);
  }

  if (frameLabel) addStats(byCallFrame, frameLabel, totalUs, selfUs);

  const lower =
    `${name} ${cat} ${JSON.stringify(args).slice(0, 1000)}`.toLowerCase();

  if (
    lower.includes("scroll") ||
    lower.includes("wheel") ||
    lower.includes("touchmove") ||
    lower.includes("animationframe") ||
    lower.includes("zone") ||
    lower.includes("detectchanges") ||
    lower.includes("layout") ||
    lower.includes("recalculate") ||
    lower.includes("paint")
  ) {
    addStats(scrollRelated, name, totalUs, selfUs);
  }
}

// ── Formatting ────────────────────────────────────────────────────────────────
function fmtMs(us) {
  return (us / 1000).toFixed(2).padStart(10);
}

const HEADER = `${"count".padStart(7)}  ${"total ms".padStart(10)}  ${"self ms".padStart(10)}  ${"max ms".padStart(10)}  name`;

function fmtRow(name, s) {
  return `${String(s.count).padStart(7)}  ${fmtMs(s.total)} ms  ${fmtMs(s.self)} ms  ${fmtMs(s.max)} ms  ${name}`;
}

function printTop(title, map, limit = topN) {
  console.log(`\n=== ${title} ===`);
  const sorted = [...map.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, limit);
  if (!sorted.length) {
    console.log("(none)");
    return;
  }
  console.log(HEADER);
  for (const [name, s] of sorted) {
    console.log(fmtRow(name, s));
  }
}

// ── Reports ───────────────────────────────────────────────────────────────────
printTop("Top trace events by CPU time", byEventName);
printTop("Top JS call frames / URLs", byCallFrame);
printTop("Top categories", byCategory);
printTop("Scroll / rendering related", scrollRelated);

// Helpful grouped summary for UI perf
const interesting = [
  "EventDispatch",
  "FunctionCall",
  "TimerFire",
  "FireAnimationFrame",
  "Layout",
  "RecalculateStyles",
  "UpdateLayoutTree",
  "Paint",
  "RasterTask",
  "CompositeLayers",
];

console.log("\n=== Important rendering buckets ===");
console.log(HEADER);
let anyBucket = false;
for (const key of interesting) {
  const s = byEventName.get(key);
  if (s) {
    console.log(fmtRow(key, s));
    anyBucket = true;
  }
}
if (!anyBucket) console.log("(none)");

// Angular/zone-ish hints
const emptyStats = makeStats();
const totalFunctionCall = (byEventName.get("FunctionCall") || emptyStats).total;
const totalLayout = (byEventName.get("Layout") || emptyStats).total;
const totalStyles = (byEventName.get("RecalculateStyles") || emptyStats).total;
const totalPaint = (byEventName.get("Paint") || emptyStats).total;
const totalEventDispatch = (byEventName.get("EventDispatch") || emptyStats).total;

console.log("\n=== Heuristic hints ===");
if (totalEventDispatch > 0 && totalFunctionCall > totalLayout) {
  console.log(
    "- Heavy JS/event-handler cost. In Angular this often means scroll listeners, zone.js-triggered change detection, or repeated component work."
  );
}
if (totalLayout > 0 || totalStyles > 0) {
  console.log(
    "- Layout/style cost is significant. Look for forced reflow, getBoundingClientRect/offsetHeight/clientHeight reads after DOM writes, sticky/fixed elements, or large DOM."
  );
}
if (totalPaint > 0) {
  console.log(
    "- Paint cost is visible. Check paint flashing, large repaints, box-shadows, blur/backdrop-filter, gradients, and large images."
  );
}
if (totalEventDispatch > 0) {
  console.log(
    "- EventDispatch shows user/input handling overhead. For scroll jank, inspect wheel/scroll/touchmove handlers and whether they trigger Angular change detection."
  );
}