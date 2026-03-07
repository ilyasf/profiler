"use strict";

const { parseArgs, analyzeTrace, computeJankSummary, buildComparison, buildJsonReport } = require("./index");

// ---------- Fixtures ----------

let _ts = 1000;

function makeEvent(overrides = {}) {
  const ts = _ts;
  _ts += (overrides.dur || 10000) + 1000;
  return {
    ph: "X",
    name: "FunctionCall",
    cat: "devtools.timeline",
    dur: 10000, // 10 ms in microseconds
    ts,
    pid: 1,
    tid: 1,
    args: {},
    ...overrides,
  };
}

beforeEach(() => { _ts = 1000; });

// ---------- parseArgs ----------

describe("parseArgs", () => {
  test("defaults", () => {
    const args = parseArgs([]);
    expect(args.format).toBe("text");
    expect(args.top).toBe(30);
    expect(args.compare).toBe(false);
    expect(args.files).toEqual([]);
    expect(args.mainThreadOnly).toBe(false);
    expect(args.filterTid).toBeNull();
  });

  test("--format json", () => {
    expect(parseArgs(["--format", "json"]).format).toBe("json");
  });

  test("--format=csv shorthand", () => {
    expect(parseArgs(["--format=csv"]).format).toBe("csv");
  });

  test("-f csv", () => {
    expect(parseArgs(["-f", "csv"]).format).toBe("csv");
  });

  test("--top 10", () => {
    expect(parseArgs(["--top", "10"]).top).toBe(10);
  });

  test("--top=5", () => {
    expect(parseArgs(["--top=5"]).top).toBe(5);
  });

  test("positional file", () => {
    expect(parseArgs(["trace.json"]).files).toEqual(["trace.json"]);
  });

  test("backward compat: file + numeric top", () => {
    const args = parseArgs(["trace.json", "50"]);
    expect(args.files).toEqual(["trace.json"]);
    expect(args.top).toBe(50);
  });

  test("compare subcommand", () => {
    const args = parseArgs(["compare", "a.json", "b.json"]);
    expect(args.compare).toBe(true);
    expect(args.files).toEqual(["a.json", "b.json"]);
  });

  test("compare with --format json", () => {
    const args = parseArgs(["compare", "a.json", "b.json", "--format", "json"]);
    expect(args.compare).toBe(true);
    expect(args.format).toBe("json");
  });

  test("--main-thread-only", () => {
    expect(parseArgs(["--main-thread-only"]).mainThreadOnly).toBe(true);
  });

  test("--tid 123", () => {
    expect(parseArgs(["--tid", "123"]).filterTid).toBe(123);
  });
});

// ---------- analyzeTrace ----------

describe("analyzeTrace", () => {
  test("ignores non-complete events", () => {
    const events = [{ ph: "B", name: "FunctionCall", dur: 10000, cat: "v8", args: {}, ts: 1000, pid: 1, tid: 1 }];
    const result = analyzeTrace(events);
    expect(result.byEventName.size).toBe(0);
  });

  test("accumulates event total duration", () => {
    const events = [
      makeEvent({ name: "Layout", dur: 5000 }),
      makeEvent({ name: "Layout", dur: 3000 }),
    ];
    const result = analyzeTrace(events);
    const stats = result.byEventName.get("Layout");
    expect(stats).toBeTruthy();
    expect(stats.total).toBe(8000); // µs
    expect(stats.count).toBe(2);
  });

  test("accumulates categories", () => {
    const events = [
      makeEvent({ cat: "v8", dur: 20000 }),
      makeEvent({ cat: "v8", dur: 10000 }),
    ];
    const result = analyzeTrace(events);
    expect(result.byCategory.get("v8").total).toBe(30000);
  });

  test("extracts call frame from data.url + data.functionName", () => {
    const events = [
      makeEvent({
        args: { data: { functionName: "myFn", url: "http://example.com/app.js" } },
      }),
    ];
    const result = analyzeTrace(events);
    const keys = [...result.byCallFrame.keys()];
    expect(keys.some((k) => k.includes("myFn") && k.includes("app.js"))).toBe(true);
  });

  test("extracts call frame from args.callFrame", () => {
    const events = [
      makeEvent({
        args: { callFrame: { functionName: "render", url: "http://example.com/main.js", lineNumber: 42 } },
      }),
    ];
    const result = analyzeTrace(events);
    const keys = [...result.byCallFrame.keys()];
    expect(keys.some((k) => k.includes("render") && k.includes("main.js") && k.includes("42"))).toBe(true);
  });

  test("flags scroll-related events", () => {
    const events = [makeEvent({ name: "ScrollBegin", cat: "input" })];
    const result = analyzeTrace(events);
    expect(result.scrollRelated.has("ScrollBegin")).toBe(true);
  });

  test("collects DrawFrame durations", () => {
    const events = [
      makeEvent({ name: "DrawFrame", dur: 20000 }), // 20 ms
      makeEvent({ name: "DrawFrame", dur: 10000 }), // 10 ms
    ];
    const result = analyzeTrace(events);
    expect(result.jankSummary.totalFrames).toBe(2);
  });

  test("rendering buckets populated correctly", () => {
    const events = [
      makeEvent({ name: "Layout", dur: 15000 }),
      makeEvent({ name: "Paint", dur: 5000 }),
    ];
    const result = analyzeTrace(events);
    expect(result.renderingBuckets.Layout.total).toBe(15000);
    expect(result.renderingBuckets.Paint.total).toBe(5000);
    expect(result.renderingBuckets.RasterTask.total).toBe(0);
  });

  test("heuristic hints triggered for layout cost", () => {
    const events = [makeEvent({ name: "Layout", dur: 100000 })];
    const result = analyzeTrace(events);
    expect(result.heuristicHints.some((h) => h.includes("Layout"))).toBe(true);
  });

  test("heuristic hints triggered for paint cost", () => {
    const events = [makeEvent({ name: "Paint", dur: 100000 })];
    const result = analyzeTrace(events);
    expect(result.heuristicHints.some((h) => h.includes("Paint"))).toBe(true);
  });

  test("accepts raw event array", () => {
    const events = [makeEvent({ name: "RunTask", dur: 50000 })];
    const result = analyzeTrace(events);
    expect(result.byEventName.has("RunTask")).toBe(true);
  });

  test("computes self time: child subtracted from parent", () => {
    // Parent: ts=1000, dur=20000 → ends at 21000
    // Child:  ts=5000, dur=5000  → ends at 10000 (inside parent)
    const events = [
      { ph: "X", name: "Parent", cat: "v8", dur: 20000, ts: 1000, pid: 1, tid: 1, args: {} },
      { ph: "X", name: "Child",  cat: "v8", dur: 5000,  ts: 5000, pid: 1, tid: 1, args: {} },
    ];
    const result = analyzeTrace(events);
    const parent = result.byEventName.get("Parent");
    // self = total − child = 20000 − 5000 = 15000
    expect(parent.self).toBe(15000);
    expect(parent.total).toBe(20000);
  });

  test("--main-thread-only filters other threads", () => {
    const events = [
      { ph: "M", name: "thread_name", pid: 1, tid: 1, args: { name: "CrRendererMain" } },
      { ph: "X", name: "MainTask",  cat: "v8", dur: 10000, ts: 1000, pid: 1, tid: 1, args: {} },
      { ph: "X", name: "OtherTask", cat: "v8", dur: 10000, ts: 1000, pid: 1, tid: 2, args: {} },
    ];
    const result = analyzeTrace(events, { mainThreadOnly: true });
    expect(result.byEventName.has("MainTask")).toBe(true);
    expect(result.byEventName.has("OtherTask")).toBe(false);
  });

  test("--tid filters to specific thread", () => {
    const events = [
      { ph: "X", name: "TidTask",   cat: "v8", dur: 10000, ts: 1000, pid: 1, tid: 99, args: {} },
      { ph: "X", name: "OtherTask", cat: "v8", dur: 10000, ts: 1000, pid: 1, tid: 2,  args: {} },
    ];
    const result = analyzeTrace(events, { filterTid: 99 });
    expect(result.byEventName.has("TidTask")).toBe(true);
    expect(result.byEventName.has("OtherTask")).toBe(false);
  });
});

// ---------- computeJankSummary ----------

describe("computeJankSummary", () => {
  test("empty frames returns zero summary", () => {
    const s = computeJankSummary([]);
    expect(s.totalFrames).toBe(0);
    expect(s.jankScore).toBe(0);
    expect(s.worstFramesMs).toEqual([]);
  });

  test("counts frames over thresholds", () => {
    const frames = [10, 20, 60, 120];
    const s = computeJankSummary(frames);
    expect(s.totalFrames).toBe(4);
    expect(s.framesOver16ms).toBe(3); // 20, 60, 120
    expect(s.framesOver50ms).toBe(2); // 60, 120
    expect(s.framesOver100ms).toBe(1); // 120
  });

  test("jank score is weighted correctly", () => {
    // 3 over 16ms (+1 each), 2 over 50ms (+3 each), 1 over 100ms (+10 each)
    // score = 3 + 2*3 + 1*10 = 19
    const frames = [10, 20, 60, 120];
    const s = computeJankSummary(frames);
    expect(s.jankScore).toBe(3 + 2 * 3 + 1 * 10);
  });

  test("worst frames are sorted descending and capped at 5", () => {
    const frames = [5, 200, 10, 300, 50, 150, 100, 80];
    const s = computeJankSummary(frames);
    expect(s.worstFramesMs).toHaveLength(5);
    expect(s.worstFramesMs[0]).toBe(300);
    expect(s.worstFramesMs[1]).toBe(200);
  });

  test("all fast frames have zero jank score", () => {
    const frames = [5, 8, 10, 15];
    const s = computeJankSummary(frames);
    expect(s.framesOver16ms).toBe(0);
    expect(s.jankScore).toBe(0);
  });
});

// ---------- buildComparison ----------

describe("buildComparison", () => {
  function makeStats(total) {
    return { count: 1, total, self: total, max: total };
  }

  function makeResult(eventMap, frameMs = []) {
    const byEventName = new Map(
      Object.entries(eventMap).map(([k, v]) => [k, makeStats(v * 1000)]) // ms → µs
    );
    const renderingBuckets = {};
    for (const key of ["EventDispatch","FunctionCall","TimerFire","FireAnimationFrame",
      "Layout","RecalculateStyles","UpdateLayoutTree","Paint","RasterTask","CompositeLayers"]) {
      renderingBuckets[key] = byEventName.get(key) || { count: 0, total: 0, self: 0, max: 0 };
    }
    return {
      byEventName,
      byCallFrame: new Map(),
      byCategory: new Map(),
      scrollRelated: new Map(),
      renderingBuckets,
      jankSummary: computeJankSummary(frameMs),
      heuristicHints: [],
    };
  }

  test("shows delta between traces", () => {
    const rA = makeResult({ Layout: 100 });
    const rB = makeResult({ Layout: 150 });
    const cmp = buildComparison(rA, rB, 30);
    const entry = cmp.topEventsByTime.find((e) => e.name === "Layout");
    expect(entry).toBeTruthy();
    expect(entry.deltaMs).toBeCloseTo(50, 1);
    expect(entry.pctChange).toBeCloseTo(50, 0);
  });

  test("marks new events with null pctChange", () => {
    const rA = makeResult({});
    const rB = makeResult({ NewEvent: 200 });
    const cmp = buildComparison(rA, rB, 30);
    const entry = cmp.topEventsByTime.find((e) => e.name === "NewEvent");
    expect(entry).toBeTruthy();
    expect(entry.pctChange).toBeNull();
  });

  test("reports improvement as negative delta", () => {
    const rA = makeResult({ Paint: 200 });
    const rB = makeResult({ Paint: 80 });
    const cmp = buildComparison(rA, rB, 30);
    const entry = cmp.topEventsByTime.find((e) => e.name === "Paint");
    expect(entry.deltaMs).toBeLessThan(0);
  });

  test("includes jank summary for both traces", () => {
    const rA = makeResult({}, [20, 60]);
    const rB = makeResult({}, [10]);
    const cmp = buildComparison(rA, rB, 30);
    expect(cmp.jankSummaryA.totalFrames).toBe(2);
    expect(cmp.jankSummaryB.totalFrames).toBe(1);
  });

  test("results sorted by absolute delta descending", () => {
    const rA = makeResult({ A: 10, B: 10 });
    const rB = makeResult({ A: 20, B: 100 }); // B has bigger delta
    const cmp = buildComparison(rA, rB, 30);
    expect(cmp.topEventsByTime[0].name).toBe("B");
  });

  test("skips entries where both traces have zero", () => {
    const rA = makeResult({ Layout: 0 });
    const rB = makeResult({ Layout: 0 });
    const cmp = buildComparison(rA, rB, 30);
    const entry = cmp.topEventsByTime.find((e) => e.name === "Layout");
    expect(entry).toBeUndefined();
  });
});

// ---------- buildJsonReport ----------

describe("buildJsonReport", () => {
  test("JSON output has stable top-level keys", () => {
    const events = [makeEvent({ name: "Layout", dur: 15000 })];
    const result = analyzeTrace(events);
    const report = buildJsonReport("trace.json", result, 10);
    expect(report).toHaveProperty("file", "trace.json");
    expect(report).toHaveProperty("topN", 10);
    expect(report).toHaveProperty("topEventsByTime");
    expect(report).toHaveProperty("topCallFrames");
    expect(report).toHaveProperty("topCategories");
    expect(report).toHaveProperty("scrollRelated");
    expect(report).toHaveProperty("renderingBuckets");
    expect(report).toHaveProperty("jankSummary");
    expect(report).toHaveProperty("heuristicHints");
  });

  test("topEventsByTime entries have name + stats fields", () => {
    const events = [makeEvent({ name: "Layout", dur: 15000 })];
    const result = analyzeTrace(events);
    const report = buildJsonReport("trace.json", result, 10);
    expect(report.topEventsByTime[0]).toMatchObject({
      name: "Layout",
      count: expect.any(Number),
      totalMs: expect.any(Number),
      selfMs: expect.any(Number),
      maxMs: expect.any(Number),
    });
  });

  test("topCallFrames entries have frame + stats fields", () => {
    const events = [
      makeEvent({ args: { data: { functionName: "myFn", url: "http://example.com/app.js" } } }),
    ];
    const result = analyzeTrace(events);
    const report = buildJsonReport("trace.json", result, 10);
    expect(report.topCallFrames[0]).toMatchObject({
      frame: expect.any(String),
      totalMs: expect.any(Number),
    });
  });

  test("topCategories entries have category + stats fields", () => {
    const events = [makeEvent({ cat: "devtools.timeline", dur: 5000 })];
    const result = analyzeTrace(events);
    const report = buildJsonReport("trace.json", result, 10);
    expect(report.topCategories[0]).toMatchObject({
      category: "devtools.timeline",
      totalMs: expect.any(Number),
    });
  });

  test("jankSummary included in JSON output", () => {
    const events = [makeEvent({ name: "DrawFrame", dur: 25000 })];
    const result = analyzeTrace(events);
    const report = buildJsonReport("trace.json", result, 10);
    expect(report.jankSummary).toMatchObject({
      totalFrames: 1,
      framesOver16ms: 1,
      jankScore: expect.any(Number),
    });
  });

  test("respects topN limit", () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      makeEvent({ name: `Event${i}`, dur: (20 - i) * 1000 })
    );
    const result = analyzeTrace(events);
    const report = buildJsonReport("trace.json", result, 5);
    expect(report.topEventsByTime).toHaveLength(5);
  });

  test("is valid JSON", () => {
    const events = [makeEvent()];
    const result = analyzeTrace(events);
    const report = buildJsonReport("trace.json", result, 10);
    expect(() => JSON.stringify(report)).not.toThrow();
  });

  test("renderingBuckets has stats shape for each bucket key", () => {
    const events = [makeEvent({ name: "Layout", dur: 10000 })];
    const result = analyzeTrace(events);
    const report = buildJsonReport("trace.json", result, 10);
    expect(report.renderingBuckets.Layout).toMatchObject({
      count: expect.any(Number),
      totalMs: expect.any(Number),
      selfMs: expect.any(Number),
      maxMs: expect.any(Number),
    });
  });
});
