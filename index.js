#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const input = process.argv[2] || "performance.json";
const topN = Number(process.argv[3] || 30);

if (!fs.existsSync(input)) {
  console.error(`File not found: ${input}`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(input, "utf8"));
const events = Array.isArray(raw) ? raw : raw.traceEvents || [];

const byEventName = new Map();
const byCallFrame = new Map();
const byCategory = new Map();
const scrollRelated = new Map();

function add(map, key, durMs) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + durMs);
}

function fmt(ms) {
  return `${ms.toFixed(2).padStart(10)} ms`;
}

function printTop(title, map, limit = topN) {
  console.log(`\n=== ${title} ===`);
  const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  if (!sorted.length) {
    console.log("(none)");
    return;
  }
  for (const [name, dur] of sorted) {
    console.log(`${fmt(dur)}  ${name}`);
  }
}

for (const e of events) {
  // Chrome trace "complete event"
  if (e.ph !== "X") continue;

  const durMs = (e.dur || 0) / 1000;
  const name = e.name || "(unnamed)";
  const cat = e.cat || "(no-category)";
  const args = e.args || {};
  const data = args.data || {};
  const beginData = args.beginData || {};

  add(byEventName, name, durMs);
  add(byCategory, cat, durMs);

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

  if (frameLabel) add(byCallFrame, frameLabel, durMs);

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
    add(scrollRelated, name, durMs);
  }
}

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
for (const key of interesting) {
  const value = byEventName.get(key) || 0;
  if (value > 0) {
    console.log(`${fmt(value)}  ${key}`);
  }
}

// Angular/zone-ish hints
const totalFunctionCall = byEventName.get("FunctionCall") || 0;
const totalLayout = byEventName.get("Layout") || 0;
const totalStyles = byEventName.get("RecalculateStyles") || 0;
const totalPaint = byEventName.get("Paint") || 0;
const totalEventDispatch = byEventName.get("EventDispatch") || 0;

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