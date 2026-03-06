"use strict";

/**
 * Produce heuristic hint strings based on aggregated rendering metrics.
 *
 * @param {Map<string,number>} byEventName  Map from aggregate().
 * @returns {string[]}  Array of human-readable hint strings (may be empty).
 */
function getHints(byEventName) {
  const totalFunctionCall = byEventName.get("FunctionCall") || 0;
  const totalLayout = byEventName.get("Layout") || 0;
  const totalStyles = byEventName.get("RecalculateStyles") || 0;
  const totalPaint = byEventName.get("Paint") || 0;
  const totalEventDispatch = byEventName.get("EventDispatch") || 0;

  const hints = [];

  if (totalEventDispatch > 0 && totalFunctionCall > totalLayout) {
    hints.push(
      "Heavy JS/event-handler cost. In Angular this often means scroll listeners, " +
        "zone.js-triggered change detection, or repeated component work."
    );
  }
  if (totalLayout > 0 || totalStyles > 0) {
    hints.push(
      "Layout/style cost is significant. Look for forced reflow, " +
        "getBoundingClientRect/offsetHeight/clientHeight reads after DOM writes, " +
        "sticky/fixed elements, or large DOM."
    );
  }
  if (totalPaint > 0) {
    hints.push(
      "Paint cost is visible. Check paint flashing, large repaints, " +
        "box-shadows, blur/backdrop-filter, gradients, and large images."
    );
  }
  if (totalEventDispatch > 0) {
    hints.push(
      "EventDispatch shows user/input handling overhead. For scroll jank, inspect " +
        "wheel/scroll/touchmove handlers and whether they trigger Angular change detection."
    );
  }

  return hints;
}

/**
 * Format the heuristic hints section as a string.
 *
 * @param {Map<string,number>} byEventName
 * @returns {string}
 */
function formatHints(byEventName) {
  const hints = getHints(byEventName);
  const lines = ["\n=== Heuristic hints ==="];
  if (hints.length === 0) {
    lines.push("(no hints — trace may not contain rendering-related events)");
  } else {
    for (const h of hints) {
      lines.push(`- ${h}`);
    }
  }
  return lines.join("\n");
}

/**
 * Print heuristic hints to stdout.
 *
 * @param {Map<string,number>} byEventName
 */
function printHints(byEventName) {
  process.stdout.write(formatHints(byEventName));
  process.stdout.write("\n");
}

module.exports = { getHints, formatHints, printHints };
