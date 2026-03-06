"use strict";

const { parseArgs, analyzeTrace, computeJankSummary, buildComparison, buildJsonReport } = require("./index");

// ---------- Fixtures ----------

function makeEvent(overrides) {
  return {
    ph: "X",
    name: "FunctionCall",
    cat: "devtools.timeline",
    dur: 10000, // 10 ms in microseconds
    ts: 1000,
    args: {},
    ...overrides,
  };
}

function traceWith(events) {
  return { traceEvents: events };
}

// ---------- parseArgs ----------

describe("parseArgs", () => {
  test("defaults", () => {
    const args = parseArgs([]);
    expect(args.format).toBe("text");
    expect(args.top).toBe(30);
    expect(args.compare).toBe(false);
    expect(args.files).toEqual([]);
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
});

// ---------- analyzeTrace ----------

describe("analyzeTrace", () => {
  test("ignores non-complete events", () => {
    const events = [{ ph: "B", name: "FunctionCall", dur: 10000, cat: "v8", args: {} }];
    const result = analyzeTrace(events);
    expect(result.byEventName.size).toBe(0);
  });

  test("accumulates event durations", () => {
    const events = [
      makeEvent({ name: "Layout", cat: "devtools.timeline", dur: 5000 }),
      makeEvent({ name: "Layout", cat: "devtools.timeline", dur: 3000 }),
    ];
    const result = analyzeTrace(events);
    expect(result.byEventName.get("Layout")).toBeCloseTo(8, 1);
  });

  test("accumulates categories", () => {
    const events = [
      makeEvent({ cat: "v8", dur: 20000 }),
      makeEvent({ cat: "v8", dur: 10000 }),
    ];
    const result = analyzeTrace(events);
    expect(result.byCategory.get("v8")).toBeCloseTo(30, 1);
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
    expect(result.renderingBuckets.Layout).toBeCloseTo(15, 1);
    expect(result.renderingBuckets.Paint).toBeCloseTo(5, 1);
    expect(result.renderingBuckets.RasterTask).toBe(0);
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
  function makeResult(eventMap, frameMs = []) {
    const byEventName = new Map(Object.entries(eventMap));
    return {
      byEventName,
      byCallFrame: new Map(),
      byCategory: new Map(),
      scrollRelated: new Map(),
      renderingBuckets: Object.fromEntries(
        ["EventDispatch", "FunctionCall", "TimerFire", "FireAnimationFrame",
          "Layout", "RecalculateStyles", "UpdateLayoutTree", "Paint",
          "RasterTask", "CompositeLayers"].map((k) => [k, byEventName.get(k) || 0])
      ),
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

  test("topEventsByTime entries have name + durationMs", () => {
    const events = [makeEvent({ name: "Layout", dur: 15000 })];
    const result = analyzeTrace(events);
    const report = buildJsonReport("trace.json", result, 10);
    expect(report.topEventsByTime[0]).toMatchObject({ name: "Layout", durationMs: expect.any(Number) });
  });

  test("topCallFrames entries have frame + durationMs", () => {
    const events = [
      makeEvent({ args: { data: { functionName: "myFn", url: "http://example.com/app.js" } } }),
    ];
    const result = analyzeTrace(events);
    const report = buildJsonReport("trace.json", result, 10);
    expect(report.topCallFrames[0]).toMatchObject({ frame: expect.any(String), durationMs: expect.any(Number) });
  });

  test("topCategories entries have category + durationMs", () => {
    const events = [makeEvent({ cat: "devtools.timeline", dur: 5000 })];
    const result = analyzeTrace(events);
    const report = buildJsonReport("trace.json", result, 10);
    expect(report.topCategories[0]).toMatchObject({
      category: "devtools.timeline",
      durationMs: expect.any(Number),
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
});
