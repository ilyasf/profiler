"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { parseTrace } = require("../src/parser");

const FIXTURE = path.join(__dirname, "fixtures", "simple-trace.json");

test("parseTrace returns an array", () => {
  const events = parseTrace(FIXTURE);
  assert.ok(Array.isArray(events), "should return an array");
});

test("parseTrace returns 10 events from the fixture", () => {
  const events = parseTrace(FIXTURE);
  assert.equal(events.length, 10);
});

test("parseTrace handles traceEvents wrapper object", () => {
  const events = parseTrace(FIXTURE);
  // The fixture uses { traceEvents: [...] } format; confirm events are unwrapped
  assert.ok(events[0].ph, "events should have a ph field");
});

test("parseTrace accepts a raw array format", () => {
  const tmpFile = path.join(require("os").tmpdir(), `trace-test-${Date.now()}.json`);
  require("fs").writeFileSync(tmpFile, JSON.stringify([{ ph: "X", name: "A", ts: 0, dur: 1000 }]));
  const events = parseTrace(tmpFile);
  assert.equal(events.length, 1);
  assert.equal(events[0].name, "A");
  require("fs").unlinkSync(tmpFile);
});

test("parseTrace throws if file does not exist", () => {
  assert.throws(
    () => parseTrace("/nonexistent/path/trace.json"),
    /File not found/
  );
});

test("parseTrace throws on malformed JSON", () => {
  const tmpFile = path.join(require("os").tmpdir(), `trace-bad-${Date.now()}.json`);
  require("fs").writeFileSync(tmpFile, "{ not valid json");
  assert.throws(() => parseTrace(tmpFile), /Failed to parse JSON/);
  require("fs").unlinkSync(tmpFile);
});
