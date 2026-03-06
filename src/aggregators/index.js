"use strict";

/**
 * Increment the numeric value stored at `key` in `map` by `durMs`.
 * Skips falsy keys.
 *
 * @param {Map<string,number>} map
 * @param {string|null|undefined} key
 * @param {number} durMs
 */
function add(map, key, durMs) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + durMs);
}

/**
 * Build a human-readable label for the JS call frame described by a trace
 * event's `args`.
 *
 * @param {object} args  The `args` field of a Chrome trace event.
 * @returns {string|null}
 */
function buildFrameLabel(args) {
  const data = args.data || {};
  const beginData = args.beginData || {};

  if (data.functionName || data.url) {
    return `${data.functionName || "(anonymous)"} @ ${data.url || data.scriptName || "(inline)"}`;
  }
  if (args.callFrame) {
    const cf = args.callFrame;
    return `${cf.functionName || "(anonymous)"} @ ${cf.url || "(inline)"}:${cf.lineNumber ?? "?"}`;
  }
  const frame = data.url || data.functionName || data.scriptName || beginData.url || beginData.frame;
  if (frame) {
    return String(frame);
  }
  return null;
}

/**
 * The set of keywords used to identify scroll/rendering-related events.
 */
const SCROLL_KEYWORDS = [
  "scroll",
  "wheel",
  "touchmove",
  "animationframe",
  "zone",
  "detectchanges",
  "layout",
  "recalculate",
  "paint",
];

/**
 * Aggregate an array of raw trace events into four Maps keyed by:
 *   - event name
 *   - JS call frame label
 *   - trace category
 *   - scroll/rendering-related event name
 *
 * Only "complete" events (ph === "X") are included.
 *
 * @param {object[]} events  Array of raw Chrome trace event objects.
 * @returns {{
 *   byEventName: Map<string,number>,
 *   byCallFrame: Map<string,number>,
 *   byCategory:  Map<string,number>,
 *   scrollRelated: Map<string,number>
 * }}
 */
function aggregate(events) {
  const byEventName = new Map();
  const byCallFrame = new Map();
  const byCategory = new Map();
  const scrollRelated = new Map();

  for (const e of events) {
    if (e.ph !== "X") continue;

    const durMs = (e.dur || 0) / 1000;
    const name = e.name || "(unnamed)";
    const cat = e.cat || "(no-category)";
    const args = e.args || {};

    add(byEventName, name, durMs);
    add(byCategory, cat, durMs);

    const frameLabel = buildFrameLabel(args);
    if (frameLabel) add(byCallFrame, frameLabel, durMs);

    const lower = `${name} ${cat} ${JSON.stringify(args).slice(0, 1000)}`.toLowerCase();
    if (SCROLL_KEYWORDS.some((kw) => lower.includes(kw))) {
      add(scrollRelated, name, durMs);
    }
  }

  return { byEventName, byCallFrame, byCategory, scrollRelated };
}

module.exports = { aggregate, add, buildFrameLabel, SCROLL_KEYWORDS };
