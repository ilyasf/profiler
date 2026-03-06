#!/usr/bin/env node
"use strict";

const { parseArgs } = require("util");
const { parseTrace } = require("./src/parser");
const { aggregate } = require("./src/aggregators");
const { printReport } = require("./src/reporters");
const { printHints } = require("./src/heuristics");

const { version, name } = require("./package.json");

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const HELP = `
Usage: ${name} [options] <trace-file>

Analyze a Chrome DevTools performance trace JSON file to identify CPU hotspots,
scroll jank, layout thrashing, and other rendering issues.

Arguments:
  trace-file            Path to the Chrome trace JSON file to analyze.
                        (default: performance.json)

Options:
  -n, --top <number>    Number of top entries to show per section. (default: 30)
  -h, --help            Show this help message and exit.
  -v, --version         Print the version number and exit.

Examples:
  ${name} trace.json
  ${name} --top 10 trace.json
  ${name} -n 50 ./profiles/my-app.json

How to export a trace from Chrome:
  1. Open Chrome DevTools (F12)
  2. Go to the Performance tab
  3. Click Record, reproduce the slow interaction, then Stop
  4. Click the download/save icon to export the trace as JSON
`.trimStart();

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseCliArgs(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      top: { type: "string", short: "n" },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  return { values, positionals };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(argv) {
  let parsed;
  try {
    parsed = parseCliArgs(argv);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.stderr.write(`Run with --help for usage information.\n`);
    process.exit(2);
  }

  const { values, positionals } = parsed;

  if (values.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  if (values.version) {
    process.stdout.write(`${version}\n`);
    process.exit(0);
  }

  // Resolve trace file path
  const inputFile = positionals[0] || "performance.json";

  // Resolve --top / -n
  let topN = 30;
  if (values.top !== undefined) {
    const parsed = Number(values.top);
    if (!Number.isInteger(parsed) || parsed < 1) {
      process.stderr.write(`Error: --top must be a positive integer, got: ${values.top}\n`);
      process.exit(2);
    }
    topN = parsed;
  }

  // Parse trace
  let events;
  try {
    events = parseTrace(inputFile);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }

  if (events.length === 0) {
    process.stderr.write(`Warning: No trace events found in ${inputFile}\n`);
  }

  // Aggregate
  const aggregates = aggregate(events);

  // Report
  printReport(aggregates, topN);
  printHints(aggregates.byEventName);
}

// Allow the module to be required in tests without auto-running
if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main, parseCliArgs };
