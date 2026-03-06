#!/usr/bin/env node

"use strict";

const fs = require("fs");

// ---------- Constants ----------

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

// ---------- CLI argument parsing ----------

/**
 * Parse process.argv-style argument list into a structured options object.
 * Supports:
 *   node index.js [--format text|json|csv] [--top N] <file>
 *   node index.js compare <file-a> <file-b> [--format text|json|csv] [--top N]
 *
 * For backward compatibility, a bare numeric second positional argument is
 * treated as the --top value (matches the original `node index.js file.json 30`
 * invocation).
 */
function parseArgs(argv) {
  const args = { format: "text", top: 30, compare: false, files: [] };
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

// ---------- Shared helpers ----------

function add(map, key, durMs) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + durMs);
}

function fmt(ms) {
  return `${ms.toFixed(2).padStart(10)} ms`;
}

function topEntries(map, limit) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function loadTrace(file) {
  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(raw) ? raw : raw.traceEvents || [];
}

// ---------- Core analysis ----------

/**
 * Analyse an array of Chrome trace events and return structured results.
 * @param {object[]} events - Array of Chrome trace events.
 * @returns {object} Analysis result containing maps, rendering buckets, jank summary, and hints.
 */
function analyzeTrace(events) {
  const byEventName = new Map();
  const byCallFrame = new Map();
  const byCategory = new Map();
  const scrollRelated = new Map();
  const frameDurationsMs = [];

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

    // Collect per-frame timing
    if (FRAME_EVENT_NAMES.has(name) && durMs > 0) {
      frameDurationsMs.push(durMs);
    }
  }

  const renderingBuckets = {};
  for (const key of INTERESTING) {
    renderingBuckets[key] = byEventName.get(key) || 0;
  }

  const jankSummary = computeJankSummary(frameDurationsMs);
  const heuristicHints = computeHints(renderingBuckets);

  return { byEventName, byCallFrame, byCategory, scrollRelated, renderingBuckets, jankSummary, heuristicHints };
}

// ---------- Jank summary ----------

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

// ---------- Heuristic hints ----------

function computeHints({ EventDispatch, FunctionCall, Layout, RecalculateStyles, Paint }) {
  const hints = [];
  if (EventDispatch > 0 && FunctionCall > Layout) {
    hints.push(
      "Heavy JS/event-handler cost. In Angular this often means scroll listeners, zone.js-triggered change detection, or repeated component work."
    );
  }
  if (Layout > 0 || RecalculateStyles > 0) {
    hints.push(
      "Layout/style cost is significant. Look for forced reflow, getBoundingClientRect/offsetHeight/clientHeight reads after DOM writes, sticky/fixed elements, or large DOM."
    );
  }
  if (Paint > 0) {
    hints.push(
      "Paint cost is visible. Check paint flashing, large repaints, box-shadows, blur/backdrop-filter, gradients, and large images."
    );
  }
  if (EventDispatch > 0) {
    hints.push(
      "EventDispatch shows user/input handling overhead. For scroll jank, inspect wheel/scroll/touchmove handlers and whether they trigger Angular change detection."
    );
  }
  return hints;
}

// ---------- TEXT output ----------

function printTextReport(file, result, topN) {
  const { byEventName, byCallFrame, byCategory, scrollRelated, renderingBuckets, jankSummary, heuristicHints } = result;

  function printTop(title, map, limit) {
    console.log(`\n=== ${title} ===`);
    const sorted = topEntries(map, limit);
    if (!sorted.length) {
      console.log("(none)");
      return;
    }
    for (const [name, dur] of sorted) {
      console.log(`${fmt(dur)}  ${name}`);
    }
  }

  printTop("Top trace events by CPU time", byEventName, topN);
  printTop("Top JS call frames / URLs", byCallFrame, topN);
  printTop("Top categories", byCategory, topN);
  printTop("Scroll / rendering related", scrollRelated, topN);

  console.log("\n=== Important rendering buckets ===");
  let anyBucket = false;
  for (const key of INTERESTING) {
    const value = renderingBuckets[key];
    if (value > 0) {
      console.log(`${fmt(value)}  ${key}`);
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

  console.log("\n=== Heuristic hints ===");
  if (!heuristicHints.length) {
    console.log("(none)");
  } else {
    for (const hint of heuristicHints) console.log(`- ${hint}`);
  }
}

// ---------- JSON output ----------

function buildJsonReport(file, result, topN) {
  const { byEventName, byCallFrame, byCategory, scrollRelated, renderingBuckets, jankSummary, heuristicHints } = result;

  function toList(map, key) {
    return topEntries(map, topN).map(([name, durationMs]) => ({
      [key]: name,
      durationMs: parseFloat(durationMs.toFixed(3)),
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
      Object.entries(renderingBuckets).map(([k, v]) => [k, parseFloat(v.toFixed(3))])
    ),
    jankSummary,
    heuristicHints,
  };
}

function printJsonReport(file, result, topN) {
  console.log(JSON.stringify(buildJsonReport(file, result, topN), null, 2));
}

// ---------- CSV output ----------

function csvEscape(value) {
  const str = String(value);
  return str.includes(",") || str.includes('"') || str.includes("\n")
    ? `"${str.replace(/"/g, '""')}"`
    : str;
}

function printCsvReport(file, result, topN) {
  const { byEventName, byCallFrame, byCategory, scrollRelated, renderingBuckets, jankSummary, heuristicHints } = result;

  function csvSection(title, entries, col) {
    console.log(title);
    console.log(`${col},durationMs`);
    for (const [name, dur] of entries) {
      console.log(`${csvEscape(name)},${dur.toFixed(3)}`);
    }
    console.log();
  }

  csvSection("topEventsByTime", topEntries(byEventName, topN), "name");
  csvSection("topCallFrames", topEntries(byCallFrame, topN), "frame");
  csvSection("topCategories", topEntries(byCategory, topN), "category");
  csvSection("scrollRelated", topEntries(scrollRelated, topN), "name");

  console.log("renderingBuckets");
  console.log("name,durationMs");
  for (const key of INTERESTING) {
    const value = renderingBuckets[key];
    if (value > 0) console.log(`${key},${value.toFixed(3)}`);
  }
  console.log();

  console.log("jankSummary");
  console.log(`totalFrames,${jankSummary.totalFrames}`);
  console.log(`framesOver16ms,${jankSummary.framesOver16ms}`);
  console.log(`framesOver50ms,${jankSummary.framesOver50ms}`);
  console.log(`framesOver100ms,${jankSummary.framesOver100ms}`);
  console.log(`worstFramesMs,${csvEscape(jankSummary.worstFramesMs.join(","))}`);
  console.log(`jankScore,${jankSummary.jankScore}`);
  console.log();

  console.log("heuristicHints");
  console.log("hint");
  for (const hint of heuristicHints) {
    console.log(csvEscape(hint));
  }
}

// ---------- Compare mode ----------

/**
 * Diff two Maps, returning entries sorted by absolute delta.
 */
function diffMaps(mapA, mapB, topN) {
  const keys = new Set([...mapA.keys(), ...mapB.keys()]);
  const rows = [];
  for (const key of keys) {
    const a = mapA.get(key) || 0;
    const b = mapB.get(key) || 0;
    if (a === 0 && b === 0) continue;
    const deltaMs = b - a;
    const pctChange = a > 0 ? parseFloat((((b - a) / a) * 100).toFixed(1)) : null;
    rows.push({
      name: key,
      durationMsA: parseFloat(a.toFixed(3)),
      durationMsB: parseFloat(b.toFixed(3)),
      deltaMs: parseFloat(deltaMs.toFixed(3)),
      pctChange,
    });
  }
  return rows.sort((a, b) => Math.abs(b.deltaMs) - Math.abs(a.deltaMs)).slice(0, topN);
}

/**
 * Build a comparison object from two analysis results.
 */
function buildComparison(resultA, resultB, topN) {
  return {
    topEventsByTime: diffMaps(resultA.byEventName, resultB.byEventName, topN),
    topCallFrames: diffMaps(resultA.byCallFrame, resultB.byCallFrame, topN),
    topCategories: diffMaps(resultA.byCategory, resultB.byCategory, topN),
    renderingBuckets: diffMaps(
      new Map(Object.entries(resultA.renderingBuckets)),
      new Map(Object.entries(resultB.renderingBuckets)),
      INTERESTING.length
    ),
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
      console.log(`${fmt(e.deltaMs)}${pct}  ${e.name}`);
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

function printCsvCompare(fileA, fileB, comparison) {
  function csvDiff(title, entries) {
    console.log(title);
    console.log("name,durationMsA,durationMsB,deltaMs,pctChange");
    for (const e of entries) {
      const pct = e.pctChange !== null ? e.pctChange : "";
      console.log(`${csvEscape(e.name)},${e.durationMsA},${e.durationMsB},${e.deltaMs},${pct}`);
    }
    console.log();
  }

  csvDiff("topEventsByTime", comparison.topEventsByTime);
  csvDiff("topCallFrames", comparison.topCallFrames);
  csvDiff("topCategories", comparison.topCategories);
  csvDiff("renderingBuckets", comparison.renderingBuckets);

  const a = comparison.jankSummaryA;
  const b = comparison.jankSummaryB;
  console.log("jankSummaryComparison");
  console.log("metric,valueA,valueB");
  console.log(`totalFrames,${a.totalFrames},${b.totalFrames}`);
  console.log(`framesOver16ms,${a.framesOver16ms},${b.framesOver16ms}`);
  console.log(`framesOver50ms,${a.framesOver50ms},${b.framesOver50ms}`);
  console.log(`framesOver100ms,${a.framesOver100ms},${b.framesOver100ms}`);
  console.log(`jankScore,${a.jankScore},${b.jankScore}`);
}

// ---------- Exports (used by tests) ----------

if (typeof module !== "undefined") {
  module.exports = { parseArgs, analyzeTrace, computeJankSummary, buildComparison, buildJsonReport };
}

// ---------- Main ----------

/* istanbul ignore next */
if (require.main === module) {
  const cliArgs = parseArgs(process.argv.slice(2));
  const { format, top: topN } = cliArgs;

  if (!["text", "json", "csv"].includes(format)) {
    console.error(`Unknown format: ${format}. Use --format text, json, or csv.`);
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
    const resultA = analyzeTrace(loadTrace(fileA));
    const resultB = analyzeTrace(loadTrace(fileB));
    const comparison = buildComparison(resultA, resultB, topN);

    if (format === "json") {
      printJsonCompare(fileA, fileB, comparison, topN);
    } else if (format === "csv") {
      printCsvCompare(fileA, fileB, comparison);
    } else {
      printTextCompare(fileA, fileB, comparison);
    }
  } else {
    const file = cliArgs.files[0] || "performance.json";
    const result = analyzeTrace(loadTrace(file));

    if (format === "json") {
      printJsonReport(file, result, topN);
    } else if (format === "csv") {
      printCsvReport(file, result, topN);
    } else {
      printTextReport(file, result, topN);
    }
  }
}