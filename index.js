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

// Angular / zone.js detection
let zoneDetected = false;

// Event counts (for frequency-based heuristics)
const countByEventName = new Map();

// Forced-reflow call-frame tracking
const forcedReflowFrames = new Map();

// Known forced-reflow property/method reads that invalidate layout
const FORCED_REFLOW_PATTERNS = [
  "getboundingclientrect",
  "offsetheight",
  "offsetwidth",
  "offsettop",
  "offsetleft",
  "offsetparent",
  "clientheight",
  "clientwidth",
  "clienttop",
  "clientleft",
  "scrolltop",
  "scrollleft",
  "scrollwidth",
  "scrollheight",
  "getcomputedstyle",
  "innertext",
  "scrollintoview",
  "focus",
];

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
  countByEventName.set(name, (countByEventName.get(name) || 0) + 1);

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

  if (frameLabel) {
    add(byCallFrame, frameLabel, durMs);

    // Zone.js detection
    const labelLower = frameLabel.toLowerCase();
    if (!zoneDetected && labelLower.includes("zone.js")) {
      zoneDetected = true;
    }

    // Forced-reflow detection: flag call frames whose name matches known
    // property reads that force layout synchronously
    for (const pattern of FORCED_REFLOW_PATTERNS) {
      if (labelLower.includes(pattern)) {
        add(forcedReflowFrames, frameLabel, durMs);
        break;
      }
    }
  }

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
const countLayout = countByEventName.get("Layout") || 0;
const countStyles = countByEventName.get("RecalculateStyles") || 0;

// ─── Angular-specific heuristics (Task 7) ────────────────────────────────────

console.log("\n=== Angular heuristics ===");

if (zoneDetected) {
  console.log(
    "- zone.js detected in call frames. Every async operation (setTimeout, Promises, " +
    "XHR, event listeners) triggers a full change-detection pass. " +
    "Move work that does not need UI updates outside Angular's zone with " +
    "NgZone.runOutsideAngular() to avoid unnecessary re-renders."
  );
} else {
  console.log(
    "- zone.js not detected in sampled call frames. If this is an Angular app you " +
    "may be running zoneless (Angular 17+) or the relevant frames were not sampled."
  );
}

// EventDispatch → FunctionCall heavy pattern
if (totalEventDispatch > 0) {
  const dispatchToCallRatio = totalFunctionCall > 0
    ? (totalEventDispatch / totalFunctionCall).toFixed(2)
    : "N/A";
  console.log(
    `- EventDispatch → FunctionCall pattern: EventDispatch=${fmt(totalEventDispatch)}, ` +
    `FunctionCall=${fmt(totalFunctionCall)} (ratio ${dispatchToCallRatio}). ` +
    "High EventDispatch cost means user/input events are directly driving expensive JS. " +
    "In Angular: wrap scroll/mousemove/resize handlers with NgZone.runOutsideAngular() and " +
    "manually call NgZone.run() only when the UI must update."
  );
}

if (totalEventDispatch > 0 && totalFunctionCall > totalLayout) {
  console.log(
    "- Heavy JS/event-handler cost detected (FunctionCall > Layout). " +
    "Common Angular causes: zone.js-triggered change detection on every event, " +
    "Default (CheckAlways) change-detection strategy on large component trees, " +
    "or scroll/timer callbacks running inside the zone.\n" +
    "  Suggestions:\n" +
    "  • Switch leaf components to ChangeDetectionStrategy.OnPush.\n" +
    "  • Wrap read-heavy scroll/resize handlers with NgZone.runOutsideAngular().\n" +
    "  • Throttle or debounce high-frequency event streams (RxJS throttleTime / debounceTime).\n" +
    "  • Use CDK virtual scrolling (<cdk-virtual-scroll-viewport>) for long lists."
  );
}

// ─── Layout thrash hints (Task 8) ────────────────────────────────────────────

console.log("\n=== Layout thrash hints ===");

// Frequent layout / style recalculations
const LAYOUT_THRASH_COUNT_THRESHOLD = 50;
if (countLayout >= LAYOUT_THRASH_COUNT_THRESHOLD || countStyles >= LAYOUT_THRASH_COUNT_THRESHOLD) {
  console.log(
    `- High layout/style-recalculation frequency detected: ` +
    `Layout×${countLayout}, RecalculateStyles×${countStyles}. ` +
    "This often means a DOM read/write loop is forcing the browser to flush layout " +
    "repeatedly (layout thrashing).\n" +
    "  Suggestions:\n" +
    "  • Batch all DOM reads first, then apply all DOM writes (e.g. use FastDOM).\n" +
    "  • Replace synchronous reads like getBoundingClientRect() inside loops with " +
    "values cached before the loop.\n" +
    "  • Use ResizeObserver instead of polling offsetWidth/offsetHeight.\n" +
    "  • Schedule write-heavy work in requestAnimationFrame callbacks."
  );
} else if (totalLayout > 0 || totalStyles > 0) {
  console.log(
    "- Layout/style cost is significant. Look for forced reflow, " +
    "getBoundingClientRect/offsetHeight/clientHeight reads after DOM writes, " +
    "sticky/fixed elements, or large DOM."
  );
}

// Forced-reflow frame report
if (forcedReflowFrames.size > 0) {
  console.log(
    "- Likely forced-reflow call sites detected (property reads that flush layout):"
  );
  const topReflow = [...forcedReflowFrames.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  for (const [frame, dur] of topReflow) {
    console.log(`    ${fmt(dur)}  ${frame}`);
  }
  console.log(
    "  Move these reads before any DOM writes in the same frame to avoid " +
    "synchronous layout. Reading a layout property after writing to the DOM forces " +
    "the browser to recalculate layout immediately."
  );
}

if (totalPaint > 0) {
  console.log(
    "- Paint cost is visible. Check paint flashing, large repaints, box-shadows, " +
    "blur/backdrop-filter, gradients, and large images."
  );
}

// Show the basic scroll/event hint only when zone.js was not detected (to avoid
// duplicating the more specific zone.js hint) and layout thrashing is not the
// dominant problem (which has its own dedicated hint above).
const showBasicEventDispatchHint =
  totalEventDispatch > 0 &&
  !zoneDetected &&
  countLayout < LAYOUT_THRASH_COUNT_THRESHOLD;
if (showBasicEventDispatchHint) {
  console.log(
    "- EventDispatch shows user/input handling overhead. For scroll jank, inspect " +
    "wheel/scroll/touchmove handlers and whether they trigger Angular change detection."
  );
}