"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { parseTrace } = require("../src/parser");
const { aggregate, add, buildFrameLabel } = require("../src/aggregators");

const FIXTURE = path.join(__dirname, "fixtures", "simple-trace.json");

// ---------------------------------------------------------------------------
// aggregate()
// ---------------------------------------------------------------------------

test("aggregate returns the four expected Maps", () => {
  const events = parseTrace(FIXTURE);
  const result = aggregate(events);
  assert.ok(result.byEventName instanceof Map);
  assert.ok(result.byCallFrame instanceof Map);
  assert.ok(result.byCategory instanceof Map);
  assert.ok(result.scrollRelated instanceof Map);
});

test("aggregate ignores non-X events", () => {
  // The fixture has one ph='B' event — it should be excluded
  const events = parseTrace(FIXTURE);
  const { byEventName } = aggregate(events);
  // 'ShouldBeIgnored' is the ph='B' event name; it must not appear
  assert.equal(byEventName.has("ShouldBeIgnored"), false);
});

test("aggregate sums duration in milliseconds (dur / 1000)", () => {
  const events = [
    { ph: "X", name: "FunctionCall", cat: "cat", dur: 2000000, args: {} },
    { ph: "X", name: "FunctionCall", cat: "cat", dur: 3000000, args: {} },
  ];
  const { byEventName } = aggregate(events);
  // 2000000 μs + 3000000 μs = 5000000 μs = 5000 ms
  assert.equal(byEventName.get("FunctionCall"), 5000);
});

test("aggregate maps events with missing dur to 0 ms", () => {
  const events = [{ ph: "X", name: "NoDur", cat: "cat", args: {} }];
  const { byEventName } = aggregate(events);
  assert.equal(byEventName.get("NoDur"), 0);
});

test("aggregate groups by category", () => {
  const events = [
    { ph: "X", name: "A", cat: "mycat", dur: 1000, args: {} },
    { ph: "X", name: "B", cat: "mycat", dur: 2000, args: {} },
  ];
  const { byCategory } = aggregate(events);
  assert.equal(byCategory.get("mycat"), 3);
});

test("aggregate detects scroll-related events via keyword in name", () => {
  const events = [{ ph: "X", name: "ScrollUpdate", cat: "cat", dur: 1000, args: {} }];
  const { scrollRelated } = aggregate(events);
  assert.ok(scrollRelated.has("ScrollUpdate"));
});

test("aggregate detects scroll-related events via keyword in args", () => {
  const events = [
    { ph: "X", name: "EventDispatch", cat: "devtools.timeline", dur: 500000, args: { data: { type: "scroll" } } },
  ];
  const { scrollRelated } = aggregate(events);
  assert.ok(scrollRelated.has("EventDispatch"));
});

test("aggregate builds callFrame label from data.functionName + data.url", () => {
  const events = [
    {
      ph: "X",
      name: "FunctionCall",
      cat: "cat",
      dur: 1000,
      args: { data: { functionName: "myFn", url: "https://example.com/app.js" } },
    },
  ];
  const { byCallFrame } = aggregate(events);
  const key = "myFn @ https://example.com/app.js";
  assert.ok(byCallFrame.has(key), `Expected key "${key}" in byCallFrame`);
});

test("aggregate builds callFrame label from args.callFrame", () => {
  const events = [
    {
      ph: "X",
      name: "FunctionCall",
      cat: "cat",
      dur: 1000,
      args: { callFrame: { functionName: "zoneFn", url: "https://example.com/zone.js", lineNumber: 99 } },
    },
  ];
  const { byCallFrame } = aggregate(events);
  assert.ok(byCallFrame.has("zoneFn @ https://example.com/zone.js:99"));
});

// ---------------------------------------------------------------------------
// add()
// ---------------------------------------------------------------------------

test("add increments existing value", () => {
  const map = new Map([["key", 10]]);
  add(map, "key", 5);
  assert.equal(map.get("key"), 15);
});

test("add sets new value", () => {
  const map = new Map();
  add(map, "newKey", 7);
  assert.equal(map.get("newKey"), 7);
});

test("add does nothing for falsy key", () => {
  const map = new Map();
  add(map, null, 5);
  add(map, undefined, 5);
  add(map, "", 5);
  assert.equal(map.size, 0);
});

// ---------------------------------------------------------------------------
// buildFrameLabel()
// ---------------------------------------------------------------------------

test("buildFrameLabel returns null for empty args", () => {
  assert.equal(buildFrameLabel({}), null);
});

test("buildFrameLabel uses data.functionName and data.url", () => {
  const label = buildFrameLabel({ data: { functionName: "fn", url: "http://x.com" } });
  assert.equal(label, "fn @ http://x.com");
});

test("buildFrameLabel falls back to (anonymous) when functionName missing but url present", () => {
  const label = buildFrameLabel({ data: { url: "http://x.com" } });
  assert.equal(label, "(anonymous) @ http://x.com");
});

test("buildFrameLabel uses callFrame when data is empty", () => {
  const label = buildFrameLabel({ callFrame: { functionName: "foo", url: "http://y.com", lineNumber: 1 } });
  assert.equal(label, "foo @ http://y.com:1");
});
