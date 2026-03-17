#!/usr/bin/env node

"use strict";

const fs = require("fs");

// ── Constants ──────────────────────────────────────────────────────────────────

const INTERESTING = [
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

/** Chrome trace event names that carry per-frame timing information. */
const FRAME_EVENT_NAMES = new Set(["DrawFrame", "BeginFrame", "ActivateLayerTree"]);

/**
 * Property/method names whose presence in a call-frame label indicates a
 * synchronous layout-forcing read (forced reflow).
 */
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

// ── CLI argument parsing ──────────────────────────────────────────────────────

/**
 * Parse process.argv-style argument list into a structured options object.
 * Supports:
 *   node index.js [--format text|json|csv] [--top N] [--main-thread-only] [--tid N] <file>
 *   node index.js compare <file-a> <file-b> [--format text|json|csv] [--top N]
 *
 * For backward compatibility, a bare numeric second positional argument is
 * treated as the --top value (matches the original `node index.js file.json 30`
 * invocation).
 */
function parseArgs(argv) {
  const args = {
    format: "text",
    top: 30,
    compare: false,
    files: [],
    mainThreadOnly: false,
    filterTid: null,
  };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "compare") {
      args.compare = true;
    } else if (arg === "--format" || arg === "-f") {
      args.format = argv[++i];
    } else if (arg.startsWith("--format=")) {
      args.format = arg.slice("--format=".length);
    } else if (arg === "--top") {
      args.top = Number(argv[++i]);
    } else if (arg.startsWith("--top=")) {
      args.top = Number(arg.slice("--top=".length));
    } else if (arg === "--main-thread-only") {
      args.mainThreadOnly = true;
    } else if (arg === "--tid") {
      args.filterTid = Number(argv[++i]);
    } else if (!arg.startsWith("-")) {
      args.files.push(arg);
    }
    i++;
  }
  // Backward compat: node index.js <file> <topN>
  if (!args.compare && args.files.length >= 2 && /^\d+$/.test(args.files[1])) {
    args.top = Number(args.files[1]);
    args.files.splice(1, 1);
  }
  return args;
}

// ── Stats helpers ─────────────────────────────────────────────────────────────

function makeStats() {
  return { count: 0, total: 0, self: 0, max: 0 };
}

/**
 * Add a complete event's timing into a stats map.
 * @param {Map} map
 * @param {string} key
 * @param {number} totalUs - total (wall) duration in microseconds
 * @param {number} selfUs  - self (exclusive) duration in microseconds
 */
function addStats(map, key, totalUs, selfUs) {
  if (!key) return;
  const s = map.get(key) || makeStats();
  s.count += 1;
  s.total += totalUs;
  s.self += selfUs;
  if (totalUs > s.max) s.max = totalUs;
  map.set(key, s);
}

// ── Core analysis ─────────────────────────────────────────────────────────────

/**
 * Analyse an array of Chrome trace events and return structured results.
 * @param {object[]} events - Raw Chrome trace event array.
 * @param {object}   opts
 * @param {boolean}  opts.mainThreadOnly - Restrict to CrRendererMain / main thread.
 * @param {number|null} opts.filterTid  - Restrict to specific tid.
 * @returns {object}
 */
function analyzeTrace(events, { mainThreadOnly = false, filterTid = null } = {}) {
  // ── Build thread name map (pid:tid → name) ──────────────────────────────────
  const threadNames = new Map();
  for (const e of events) {
    if (e.ph === "M" && e.name === "thread_name") {
      const key = `${e.pid}:${e.tid}`;
      if (e.args && e.args.name) threadNames.set(key, e.args.name);
    }
  }

  const mainThreadKeys = new Set(
    [...threadNames.entries()]
      .filter(([, name]) => name === "CrRendererMain" || name === "main")
      .map(([key]) => key)
  );

  // ── Filter complete events (ph === "X") ────────────────────────────────────
  function isIncluded(e) {
    if (e.ph !== "X") return false;
    if (filterTid !== null && e.tid !== filterTid) return false;
    if (mainThreadOnly && mainThreadKeys.size > 0) {
      if (!mainThreadKeys.has(`${e.pid}:${e.tid}`)) return false;
    }
    return true;
  }

  const completeEvents = events.filter(isIncluded);

  // ── Self-time computation ──────────────────────────────────────────────────
  // Group by pid:tid, then for each thread use a stack-based algorithm:
  // self time = total duration − duration of direct children.
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

  // ── Aggregate stats ────────────────────────────────────────────────────────
  const byEventName = new Map();
  const byCallFrame = new Map();
  const byCategory = new Map();
  const scrollRelated = new Map();
  const frameDurationsMs = [];

  // Angular / zone.js detection
  let zoneDetected = false;
  // Forced-reflow call-site tracking (frameLabel → accumulated total µs)
  const forcedReflowFrames = new Map();

  for (const e of completeEvents) {
    const totalUs = e.dur || 0;
    const selfUs = selfTimeMap.get(e) ?? totalUs;
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

    if (frameLabel) {
      addStats(byCallFrame, frameLabel, totalUs, selfUs);

      const labelLower = frameLabel.toLowerCase();

      // Zone.js detection via call-frame URL
      if (!zoneDetected && labelLower.includes("zone.js")) {
        zoneDetected = true;
      }

      // Forced-reflow detection: accumulate duration for frames matching known
      // layout-invalidating property/method reads
      for (const pattern of FORCED_REFLOW_PATTERNS) {
        if (labelLower.includes(pattern)) {
          const prev = forcedReflowFrames.get(frameLabel) || 0;
          forcedReflowFrames.set(frameLabel, prev + totalUs);
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
      addStats(scrollRelated, name, totalUs, selfUs);
    }

    // Collect per-frame timing
    if (FRAME_EVENT_NAMES.has(name) && totalUs > 0) {
      frameDurationsMs.push(totalUs / 1000);
    }
  }

  const renderingBuckets = {};
  for (const key of INTERESTING) {
    renderingBuckets[key] = byEventName.get(key) || makeStats();
  }

  const jankSummary = computeJankSummary(frameDurationsMs);
  const { angularHints, layoutThrashHints } = computeHints(
    renderingBuckets,
    zoneDetected,
    forcedReflowFrames
  );
  const heuristicHints = [...angularHints, ...layoutThrashHints];

  return {
    byEventName,
    byCallFrame,
    byCategory,
    scrollRelated,
    renderingBuckets,
    jankSummary,
    angularHints,
    layoutThrashHints,
    heuristicHints,
  };
}

// ── Jank summary ──────────────────────────────────────────────────────────────

/**
 * Compute jank statistics from an array of frame durations in milliseconds.
 * @param {number[]} frames
 * @returns {object}
 */
function computeJankSummary(frames) {
  if (!frames.length) {
    return {
      totalFrames: 0,
      framesOver16ms: 0,
      framesOver50ms: 0,
      framesOver100ms: 0,
      worstFramesMs: [],
      jankScore: 0,
    };
  }

  const framesOver16ms = frames.filter((f) => f > 16.6).length;
  const framesOver50ms = frames.filter((f) => f > 50).length;
  const framesOver100ms = frames.filter((f) => f > 100).length;
  const worstFramesMs = [...frames]
    .sort((a, b) => b - a)
    .slice(0, 5)
    .map((f) => parseFloat(f.toFixed(2)));
  // Weighted score: mild jank +1, moderate +3, severe +10
  const jankScore = framesOver16ms + framesOver50ms * 3 + framesOver100ms * 10;

  return {
    totalFrames: frames.length,
    framesOver16ms,
    framesOver50ms,
    framesOver100ms,
    worstFramesMs,
    jankScore,
  };
}

// ── Heuristic hints ───────────────────────────────────────────────────────────

/** Threshold for "high frequency" layout/style events that suggests thrashing. */
const LAYOUT_THRASH_COUNT_THRESHOLD = 50;

/**
 * Compute Angular-specific and layout-thrash hints from analysis results.
 * @param {object} renderingBuckets - Key rendering-pipeline stats.
 * @param {boolean} zoneDetected - Whether zone.js was detected in call frames.
 * @param {Map<string,number>} forcedReflowFrames - Call frames with suspected forced-reflow reads, accumulated total µs.
 * @returns {{ angularHints: string[], layoutThrashHints: string[] }}
 */
function computeHints(renderingBuckets, zoneDetected = false, forcedReflowFrames = new Map()) {
  const getTotal = (key) => (renderingBuckets[key] || makeStats()).total;
  const getCount = (key) => (renderingBuckets[key] || makeStats()).count;
  const fmtUs = (us) => `${(us / 1000).toFixed(2).padStart(10)} ms`;

  // ── Angular hints ─────────────────────────────────────────────────────────
  const angularHints = [];

  if (zoneDetected) {
    angularHints.push(
      "zone.js detected in call frames. Every async operation (setTimeout, Promises, " +
      "XHR, event listeners) triggers a full change-detection pass. " +
      "Move work that does not need UI updates outside Angular's zone with " +
      "NgZone.runOutsideAngular() to avoid unnecessary re-renders."
    );
  }

  if (getTotal("EventDispatch") > 0) {
    const edUs = getTotal("EventDispatch");
    const fcUs = getTotal("FunctionCall");
    const dispatchToCallRatio = fcUs > 0
      ? (edUs / fcUs).toFixed(2)
      : "N/A";
    angularHints.push(
      `EventDispatch → FunctionCall pattern: EventDispatch=${fmtUs(edUs)}, ` +
      `FunctionCall=${fmtUs(fcUs)} (ratio ${dispatchToCallRatio}). ` +
      "High EventDispatch cost means user/input events are directly driving expensive JS. " +
      "In Angular: wrap scroll/mousemove/resize handlers with NgZone.runOutsideAngular() and " +
      "manually call NgZone.run() only when the UI must update."
    );
  }

  if (getTotal("EventDispatch") > 0 && getTotal("FunctionCall") > getTotal("Layout")) {
    angularHints.push(
      "Heavy JS/event-handler cost detected (FunctionCall > Layout). " +
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

  // ── Layout-thrash hints ───────────────────────────────────────────────────
  const layoutThrashHints = [];

  const countLayout = getCount("Layout");
  const countStyles = getCount("RecalculateStyles");

  if (countLayout >= LAYOUT_THRASH_COUNT_THRESHOLD || countStyles >= LAYOUT_THRASH_COUNT_THRESHOLD) {
    layoutThrashHints.push(
      `High layout/style-recalculation frequency detected: ` +
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
  } else if (getTotal("Layout") > 0 || getTotal("RecalculateStyles") > 0) {
    layoutThrashHints.push(
      "Layout/style cost is significant. Look for forced reflow, " +
      "getBoundingClientRect/offsetHeight/clientHeight reads after DOM writes, " +
      "sticky/fixed elements, or large DOM."
    );
  }

  if (forcedReflowFrames.size > 0) {
    const topReflow = [...forcedReflowFrames.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([frame, us]) => `  ${fmtUs(us)}  ${frame}`)
      .join("\n");
    layoutThrashHints.push(
      "Likely forced-reflow call sites detected (property reads that flush layout):\n" +
      topReflow + "\n" +
      "  Move these reads before any DOM writes in the same frame to avoid " +
      "synchronous layout. Reading a layout property after writing to the DOM forces " +
      "the browser to recalculate layout immediately."
    );
  }

  if (getTotal("Paint") > 0) {
    layoutThrashHints.push(
      "Paint cost is visible. Check paint flashing, large repaints, box-shadows, " +
      "blur/backdrop-filter, gradients, and large images."
    );
  }

  // Show basic EventDispatch hint only when zone.js was not detected (to avoid
  // duplicating the more specific zone.js hint above) and layout thrashing is
  // not the dominant issue already described.
  const showBasicEventDispatchHint =
    getTotal("EventDispatch") > 0 &&
    !zoneDetected &&
    countLayout < LAYOUT_THRASH_COUNT_THRESHOLD;
  if (showBasicEventDispatchHint) {
    layoutThrashHints.push(
      "EventDispatch shows user/input handling overhead. For scroll jank, inspect " +
      "wheel/scroll/touchmove handlers and whether they trigger Angular change detection."
    );
  }

  return { angularHints, layoutThrashHints };
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtMs(us) {
  return (us / 1000).toFixed(2).padStart(10);
}

const HEADER = `${"count".padStart(7)}  ${"total ms".padStart(10)}  ${"self ms".padStart(10)}  ${"max ms".padStart(10)}  name`;

function fmtRow(name, s) {
  return `${String(s.count).padStart(7)}  ${fmtMs(s.total)} ms  ${fmtMs(s.self)} ms  ${fmtMs(s.max)} ms  ${name}`;
}

function topEntries(map, limit) {
  return [...map.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, limit);
}

// ── TEXT output ───────────────────────────────────────────────────────────────

function printTop(title, map, limit) {
  console.log(`\n=== ${title} ===`);
  const sorted = topEntries(map, limit);
  if (!sorted.length) {
    console.log("(none)");
    return;
  }
  console.log(HEADER);
  for (const [name, s] of sorted) {
    console.log(fmtRow(name, s));
  }
}

function printTextReport(file, result, topN) {
  const { byEventName, byCallFrame, byCategory, scrollRelated, renderingBuckets, jankSummary, angularHints, layoutThrashHints } = result;

  printTop("Top trace events by CPU time", byEventName, topN);
  printTop("Top JS call frames / URLs", byCallFrame, topN);
  printTop("Top categories", byCategory, topN);
  printTop("Scroll / rendering related", scrollRelated, topN);

  console.log("\n=== Important rendering buckets ===");
  console.log(HEADER);
  let anyBucket = false;
  for (const key of INTERESTING) {
    const s = renderingBuckets[key];
    if (s && s.total > 0) {
      console.log(fmtRow(key, s));
      anyBucket = true;
    }
  }
  if (!anyBucket) console.log("(none)");

  console.log("\n=== Frame / jank summary ===");
  if (jankSummary.totalFrames === 0) {
    console.log("(no frame events found)");
  } else {
    console.log(`  Total frames :  ${jankSummary.totalFrames}`);
    console.log(`  Over 16.6 ms :  ${jankSummary.framesOver16ms}`);
    console.log(`  Over  50 ms  :  ${jankSummary.framesOver50ms}`);
    console.log(`  Over 100 ms  :  ${jankSummary.framesOver100ms}`);
    console.log(`  Worst frames :  ${jankSummary.worstFramesMs.map((f) => f.toFixed(2) + " ms").join("  ")}`);
    console.log(`  Jank score   :  ${jankSummary.jankScore}`);
  }

  console.log("\n=== Angular heuristics ===");
  if (!angularHints.length) {
    console.log("(none)");
  } else {
    for (const hint of angularHints) console.log(`- ${hint}`);
  }

  console.log("\n=== Layout thrash hints ===");
  if (!layoutThrashHints.length) {
    console.log("(none)");
  } else {
    for (const hint of layoutThrashHints) console.log(`- ${hint}`);
  }
}

// ── JSON output ───────────────────────────────────────────────────────────────

function statsToObj(s) {
  return {
    count: s.count,
    totalMs: parseFloat((s.total / 1000).toFixed(3)),
    selfMs: parseFloat((s.self / 1000).toFixed(3)),
    maxMs: parseFloat((s.max / 1000).toFixed(3)),
  };
}

function buildJsonReport(file, result, topN) {
  const { byEventName, byCallFrame, byCategory, scrollRelated, renderingBuckets, jankSummary, angularHints, layoutThrashHints, heuristicHints } = result;

  function toList(map, key) {
    return topEntries(map, topN).map(([name, s]) => ({
      [key]: name,
      ...statsToObj(s),
    }));
  }

  return {
    file,
    topN,
    topEventsByTime: toList(byEventName, "name"),
    topCallFrames: toList(byCallFrame, "frame"),
    topCategories: toList(byCategory, "category"),
    scrollRelated: toList(scrollRelated, "name"),
    renderingBuckets: Object.fromEntries(
      Object.entries(renderingBuckets).map(([k, s]) => [k, statsToObj(s)])
    ),
    jankSummary,
    angularHints,
    layoutThrashHints,
    heuristicHints,
  };
}

function printJsonReport(file, result, topN) {
  console.log(JSON.stringify(buildJsonReport(file, result, topN), null, 2));
}

// ── CSV output ────────────────────────────────────────────────────────────────

function csvEscape(value) {
  const str = String(value);
  return str.includes(",") || str.includes('"') || str.includes("\n")
    ? `"${str.replace(/"/g, '""')}"`
    : str;
}

/**
 * Build a single normalized CSV from an analysis result.
 *
 * Schema: section,name,count,totalMs,selfMs,maxMs
 *
 * Sections emitted:
 *   topEventsByTime  – top trace events by total CPU time
 *   topCallFrames    – top JS call frames / URLs
 *   topCategories    – top trace categories
 *   scrollRelated    – scroll / rendering related events
 *   renderingBuckets – key rendering-pipeline events
 *   jankSummary      – one row per metric; integer value in the count column
 *   jankWorstFrames  – one row per worst frame; duration in the totalMs column
 *   angularHints     – one row per Angular-specific hint; text in the name column
 *   layoutThrashHints – one row per layout-thrash hint; text in the name column
 *   heuristicHints   – one row per hint (all hints combined); text in the name column
 *
 * Returns an array of row strings (header first, no trailing newlines).
 */
function buildCsvReport(file, result, topN) {
  const { byEventName, byCallFrame, byCategory, scrollRelated, renderingBuckets, jankSummary, angularHints, layoutThrashHints, heuristicHints } = result;
  const rows = ["section,name,count,totalMs,selfMs,maxMs"];

  function statsRow(section, name, s) {
    const o = statsToObj(s);
    rows.push(`${section},${csvEscape(name)},${o.count},${o.totalMs},${o.selfMs},${o.maxMs}`);
  }

  for (const [name, s] of topEntries(byEventName, topN)) statsRow("topEventsByTime", name, s);
  for (const [name, s] of topEntries(byCallFrame, topN)) statsRow("topCallFrames", name, s);
  for (const [name, s] of topEntries(byCategory, topN)) statsRow("topCategories", name, s);
  for (const [name, s] of topEntries(scrollRelated, topN)) statsRow("scrollRelated", name, s);
  for (const key of INTERESTING) {
    const s = renderingBuckets[key];
    if (s && s.total > 0) statsRow("renderingBuckets", key, s);
  }

  // jankSummary: one row per metric; integer value in the count column
  for (const metric of ["totalFrames", "framesOver16ms", "framesOver50ms", "framesOver100ms", "jankScore"]) {
    rows.push(`jankSummary,${metric},${jankSummary[metric]},,,`);
  }

  // jankWorstFrames: one row per frame; rank in name, duration in totalMs column
  jankSummary.worstFramesMs.forEach((ms, i) => {
    rows.push(`jankWorstFrames,${i + 1},,${ms},,`);
  });

  // angularHints / layoutThrashHints: one row per hint; text in the name column
  for (const hint of angularHints) {
    rows.push(`angularHints,${csvEscape(hint)},,,,`);
  }
  for (const hint of layoutThrashHints) {
    rows.push(`layoutThrashHints,${csvEscape(hint)},,,,`);
  }

  // heuristicHints: combined list (backward compat)
  for (const hint of heuristicHints) {
    rows.push(`heuristicHints,${csvEscape(hint)},,,,`);
  }

  return rows;
}

function printCsvReport(file, result, topN) {
  console.log(buildCsvReport(file, result, topN).join("\n"));
}

// ── Compare mode ──────────────────────────────────────────────────────────────

/**
 * Diff two stats Maps by total wall time, returning entries sorted by |delta|.
 * Each entry carries the full metric set from both traces so callers have
 * count, self time, and max duration available alongside the delta.
 */
function diffMaps(mapA, mapB, limit) {
  const keys = new Set([...mapA.keys(), ...mapB.keys()]);
  const rows = [];
  for (const key of keys) {
    const sa = mapA.get(key) || makeStats();
    const sb = mapB.get(key) || makeStats();
    const totalA = sa.total / 1000; // µs → ms
    const totalB = sb.total / 1000;
    if (totalA === 0 && totalB === 0) continue;
    const deltaMs = totalB - totalA;
    const pctChange = totalA > 0 ? parseFloat((((totalB - totalA) / totalA) * 100).toFixed(1)) : null;
    rows.push({
      name: key,
      countA: sa.count,
      totalMsA: parseFloat(totalA.toFixed(3)),
      selfMsA: parseFloat((sa.self / 1000).toFixed(3)),
      maxMsA: parseFloat((sa.max / 1000).toFixed(3)),
      countB: sb.count,
      totalMsB: parseFloat(totalB.toFixed(3)),
      selfMsB: parseFloat((sb.self / 1000).toFixed(3)),
      maxMsB: parseFloat((sb.max / 1000).toFixed(3)),
      deltaMs: parseFloat(deltaMs.toFixed(3)),
      pctChange,
    });
  }
  return rows.sort((a, b) => Math.abs(b.deltaMs) - Math.abs(a.deltaMs)).slice(0, limit);
}

/**
 * Build a comparison object from two analysis results.
 */
function buildComparison(resultA, resultB, topN) {
  // Build stats maps for rendering buckets so diffMaps can work on them.
  const renderingA = new Map(
    Object.entries(resultA.renderingBuckets).map(([k, s]) => [k, s])
  );
  const renderingB = new Map(
    Object.entries(resultB.renderingBuckets).map(([k, s]) => [k, s])
  );
  return {
    topEventsByTime: diffMaps(resultA.byEventName, resultB.byEventName, topN),
    topCallFrames: diffMaps(resultA.byCallFrame, resultB.byCallFrame, topN),
    topCategories: diffMaps(resultA.byCategory, resultB.byCategory, topN),
    renderingBuckets: diffMaps(renderingA, renderingB, INTERESTING.length),
    jankSummaryA: resultA.jankSummary,
    jankSummaryB: resultB.jankSummary,
  };
}

function printTextCompare(fileA, fileB, comparison) {
  function printDiff(title, entries) {
    console.log(`\n=== ${title} ===`);
    if (!entries.length) {
      console.log("(none)");
      return;
    }
    for (const e of entries) {
      const sign = e.deltaMs >= 0 ? "+" : "";
      const pct = e.pctChange !== null ? ` (${sign}${e.pctChange}%)` : " (new)";
      const deltaStr = `${e.deltaMs >= 0 ? "+" : ""}${e.deltaMs.toFixed(2).padStart(10)} ms`;
      console.log(`${deltaStr}${pct}  ${e.name}`);
    }
  }

  console.log(`\nComparing:\n  A: ${fileA}\n  B: ${fileB}`);
  printDiff("Top event changes (absolute delta, regressions first)", comparison.topEventsByTime);
  printDiff("Top call frame changes", comparison.topCallFrames);
  printDiff("Top category changes", comparison.topCategories);
  printDiff("Rendering bucket changes", comparison.renderingBuckets);

  const a = comparison.jankSummaryA;
  const b = comparison.jankSummaryB;
  console.log("\n=== Jank summary comparison ===");
  console.log(`  Total frames :  ${a.totalFrames} → ${b.totalFrames}`);
  console.log(`  Over 16.6 ms :  ${a.framesOver16ms} → ${b.framesOver16ms}`);
  console.log(`  Over  50 ms  :  ${a.framesOver50ms} → ${b.framesOver50ms}`);
  console.log(`  Over 100 ms  :  ${a.framesOver100ms} → ${b.framesOver100ms}`);
  const scoreDelta = b.jankScore - a.jankScore;
  const verdict =
    scoreDelta > 0 ? "regression" : scoreDelta < 0 ? "improvement" : "no change";
  console.log(`  Jank score   :  ${a.jankScore} → ${b.jankScore}  (${verdict})`);
}

function printJsonCompare(fileA, fileB, comparison, topN) {
  console.log(JSON.stringify({ fileA, fileB, topN, comparison }, null, 2));
}

/**
 * Build a single normalized comparison CSV.
 *
 * Schema: section,name,countA,totalMsA,selfMsA,maxMsA,countB,totalMsB,selfMsB,maxMsB,deltaTotalMs,pctChange
 *
 * Sections emitted:
 *   topEventsByTime, topCallFrames, topCategories, renderingBuckets –
 *     full per-trace metrics (count, total, self, max) plus delta and pct change.
 *   jankSummaryComparison – one row per metric; integer values in countA/countB,
 *     arithmetic delta in deltaTotalMs.
 *
 * Returns an array of row strings (header first, no trailing newlines).
 */
function buildCsvCompare(fileA, fileB, comparison) {
  const rows = [
    "section,name,countA,totalMsA,selfMsA,maxMsA,countB,totalMsB,selfMsB,maxMsB,deltaTotalMs,pctChange",
  ];

  function diffRow(section, e) {
    const pct = e.pctChange !== null ? e.pctChange : "";
    rows.push(
      `${section},${csvEscape(e.name)},${e.countA},${e.totalMsA},${e.selfMsA},${e.maxMsA},` +
      `${e.countB},${e.totalMsB},${e.selfMsB},${e.maxMsB},${e.deltaMs},${pct}`
    );
  }

  for (const e of comparison.topEventsByTime) diffRow("topEventsByTime", e);
  for (const e of comparison.topCallFrames) diffRow("topCallFrames", e);
  for (const e of comparison.topCategories) diffRow("topCategories", e);
  for (const e of comparison.renderingBuckets) diffRow("renderingBuckets", e);

  // jankSummaryComparison: countA/countB hold the integer values; deltaTotalMs holds the delta
  const a = comparison.jankSummaryA;
  const b = comparison.jankSummaryB;
  for (const metric of ["totalFrames", "framesOver16ms", "framesOver50ms", "framesOver100ms", "jankScore"]) {
    const delta = b[metric] - a[metric];
    rows.push(`jankSummaryComparison,${metric},${a[metric]},,,,${b[metric]},,,,${delta},`);
  }

  return rows;
}

function printCsvCompare(fileA, fileB, comparison) {
  console.log(buildCsvCompare(fileA, fileB, comparison).join("\n"));
}

// ── Load trace file ───────────────────────────────────────────────────────────

/* istanbul ignore next */
function loadTrace(file) {
  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(raw) ? raw : raw.traceEvents || [];
}

// ── Exports (used by tests) ───────────────────────────────────────────────────

if (typeof module !== "undefined") {
  module.exports = {
    parseArgs,
    analyzeTrace,
    computeJankSummary,
    computeHints,
    buildComparison,
    buildJsonReport,
    buildCsvReport,
    buildCsvCompare,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

/* istanbul ignore next */
if (require.main === module) {
  const cliArgs = parseArgs(process.argv.slice(2));
  const { format, top: topN, mainThreadOnly, filterTid } = cliArgs;

  if (!["text", "json", "csv"].includes(format)) {
    console.error(`Unknown format: ${format}. Use --format text, json, or csv.`);
    process.exit(1);
  }

  if (mainThreadOnly && filterTid !== null) {
    console.error("--main-thread-only and --tid cannot be used together.");
    process.exit(1);
  }

  if (cliArgs.compare) {
    if (cliArgs.files.length < 2) {
      console.error(
        "Usage: node index.js compare <trace-a.json> <trace-b.json> [--format text|json|csv] [--top N]"
      );
      process.exit(1);
    }
    const [fileA, fileB] = cliArgs.files;
    const opts = { mainThreadOnly, filterTid };
    const resultA = analyzeTrace(loadTrace(fileA), opts);
    const resultB = analyzeTrace(loadTrace(fileB), opts);
    const comparison = buildComparison(resultA, resultB, topN);

    if (format === "json") {
      printJsonCompare(fileA, fileB, comparison, topN);
    } else if (format === "csv") {
      printCsvCompare(fileA, fileB, comparison);
    } else {
      printTextCompare(fileA, fileB, comparison);
    }
  } else {
    if (mainThreadOnly) {
      const raw = JSON.parse(fs.readFileSync(cliArgs.files[0] || "performance.json", "utf8"));
      const events = Array.isArray(raw) ? raw : raw.traceEvents || [];
      // Emit warning if no main thread found (matches original behaviour)
      const threadNames = new Map();
      for (const e of events) {
        if (e.ph === "M" && e.name === "thread_name") {
          const key = `${e.pid}:${e.tid}`;
          if (e.args && e.args.name) threadNames.set(key, e.args.name);
        }
      }
      const hasMain = [...threadNames.values()].some(
        (n) => n === "CrRendererMain" || n === "main"
      );
      if (!hasMain) {
        console.warn(
          "Warning: --main-thread-only specified but no CrRendererMain/main thread found in trace; showing all threads."
        );
      }
    }

    const file = cliArgs.files[0] || "performance.json";
    const result = analyzeTrace(loadTrace(file), { mainThreadOnly, filterTid });

    if (format === "json") {
      printJsonReport(file, result, topN);
    } else if (format === "csv") {
      printCsvReport(file, result, topN);
    } else {
      printTextReport(file, result, topN);
    }
  }
}