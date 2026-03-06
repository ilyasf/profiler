"use strict";

/**
 * Format a millisecond value as a right-aligned, fixed-precision string.
 *
 * @param {number} ms
 * @returns {string}
 */
function fmt(ms) {
  return `${ms.toFixed(2).padStart(10)} ms`;
}

/**
 * Return a sorted array (descending) of [name, durationMs] pairs from `map`,
 * limited to `limit` entries.
 *
 * @param {Map<string,number>} map
 * @param {number} limit
 * @returns {Array<[string,number]>}
 */
function topEntries(map, limit) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

/**
 * Format a section with a title and the top entries from `map`.
 *
 * @param {string} title
 * @param {Map<string,number>} map
 * @param {number} [limit=30]
 * @returns {string}
 */
function formatSection(title, map, limit = 30) {
  const lines = [`\n=== ${title} ===`];
  const sorted = topEntries(map, limit);
  if (!sorted.length) {
    lines.push("(none)");
  } else {
    for (const [name, dur] of sorted) {
      lines.push(`${fmt(dur)}  ${name}`);
    }
  }
  return lines.join("\n");
}

/**
 * The ordered list of rendering-related event names shown in the summary.
 */
const RENDERING_BUCKETS = [
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

/**
 * Format the "Important rendering buckets" section.
 *
 * @param {Map<string,number>} byEventName
 * @returns {string}
 */
function formatRenderingBuckets(byEventName) {
  const lines = ["\n=== Important rendering buckets ==="];
  let any = false;
  for (const key of RENDERING_BUCKETS) {
    const value = byEventName.get(key) || 0;
    if (value > 0) {
      lines.push(`${fmt(value)}  ${key}`);
      any = true;
    }
  }
  if (!any) lines.push("(none)");
  return lines.join("\n");
}

/**
 * Print all four aggregate maps and the rendering-bucket summary to stdout.
 *
 * @param {{
 *   byEventName:   Map<string,number>,
 *   byCallFrame:   Map<string,number>,
 *   byCategory:    Map<string,number>,
 *   scrollRelated: Map<string,number>
 * }} aggregates
 * @param {number} [topN=30]
 */
function printReport(aggregates, topN = 30) {
  const { byEventName, byCallFrame, byCategory, scrollRelated } = aggregates;

  process.stdout.write(formatSection("Top trace events by CPU time", byEventName, topN));
  process.stdout.write("\n");
  process.stdout.write(formatSection("Top JS call frames / URLs", byCallFrame, topN));
  process.stdout.write("\n");
  process.stdout.write(formatSection("Top categories", byCategory, topN));
  process.stdout.write("\n");
  process.stdout.write(formatSection("Scroll / rendering related", scrollRelated, topN));
  process.stdout.write("\n");
  process.stdout.write(formatRenderingBuckets(byEventName));
  process.stdout.write("\n");
}

module.exports = { fmt, topEntries, formatSection, formatRenderingBuckets, printReport, RENDERING_BUCKETS };
