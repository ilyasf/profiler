"use strict";

const fs = require("fs");

/**
 * Load and parse a Chrome DevTools performance trace file.
 *
 * Accepts both the raw array format and the `{ traceEvents: [...] }` object
 * format that Chrome exports.
 *
 * @param {string} filePath  Absolute or relative path to the JSON trace file.
 * @returns {object[]}       Array of trace event objects.
 * @throws {Error}           If the file does not exist or is not valid JSON.
 */
function parseTrace(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    throw new Error(`Failed to parse JSON in ${filePath}: ${err.message}`);
  }

  const events = Array.isArray(raw) ? raw : raw.traceEvents || [];
  return events;
}

module.exports = { parseTrace };
