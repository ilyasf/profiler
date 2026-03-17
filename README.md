# Trace Debug

A tool for analyzing Chrome DevTools performance trace files to identify performance bottlenecks, scroll jank, and rendering issues.

## Usage

```bash
node index.js ./example-trace.json
```

With a custom top-N limit (default is 30):

```bash
node index.js ./example-trace.json 50
```

Restrict analysis to the main renderer thread only:

```bash
node index.js ./example-trace.json --main-thread-only
```

Restrict analysis to a specific thread by ID:

```bash
node index.js ./example-trace.json --tid 12345
```

Flags and positional arguments can be combined in any order:

```bash
node index.js ./example-trace.json 20 --main-thread-only
```

### Output formats

```bash
node index.js trace.json --format json   # machine-readable JSON
node index.js trace.json --format csv    # labelled CSV blocks per section
node index.js trace.json                 # default human-readable text
```

### Compare two traces

```bash
node index.js compare trace-a.json trace-b.json
node index.js compare trace-a.json trace-b.json --format json --top 20
```

## What it does

This tool parses Chrome performance trace JSON files and provides:

- **Top trace events by CPU time** - Shows which browser operations consumed the most time, with count, total, self, and max duration columns
- **Top JS call frames / URLs** - Identifies the JavaScript functions and URLs with highest execution time
- **Top categories** - Groups events by their trace categories
- **Scroll / rendering related events** - Filters events that may impact scroll performance
- **Important rendering buckets** - Key metrics for layout, paint, and composite operations
- **Frame / jank summary** - Counts frames exceeding 16.6 ms / 50 ms / 100 ms thresholds and computes a weighted jank score
- **Angular heuristics** - Angular-specific change-detection analysis including:
  - zone.js detection from sampled call frames
  - EventDispatch → FunctionCall ratio analysis
  - Suggestions for `NgZone.runOutsideAngular()`, `ChangeDetectionStrategy.OnPush`, RxJS throttling, and CDK virtual scrolling
- **Layout thrash hints** - Layout-thrashing detection including:
  - Frequency-based Layout / RecalculateStyles spike detection
  - Forced-reflow call-site identification (reads of `getBoundingClientRect`, `offsetHeight`, `scrollTop`, etc.)
  - Recommendations for DOM read/write batching and `requestAnimationFrame` scheduling

### Self-time vs total time

Each report table shows four columns per entry:

| Column | Description |
|--------|-------------|
| `count` | Number of times the event occurred |
| `total ms` | Sum of each event's full duration, including time spent in nested child events |
| `self ms` | Sum of time spent *inside* the event, excluding time delegated to nested children |
| `max ms` | Longest single occurrence of the event |

Self-time is computed per-thread using a stack-based algorithm that handles arbitrarily nested `X` (complete) events.

### Thread filtering

| Flag | Description |
|------|-------------|
| `--main-thread-only` | Include only events from the thread named `CrRendererMain` or `main` (the browser's main renderer thread) |
| `--tid <n>` | Include only events from thread with the given numeric ID |

If `--main-thread-only` is specified but no `CrRendererMain`/`main` thread is found in the trace, a warning is printed and all threads are shown.

### Frame / jank summary

Aggregates `DrawFrame`, `BeginFrame`, and `ActivateLayerTree` events:

- Frame counts exceeding 16.6 ms / 50 ms / 100 ms thresholds
- Top-5 worst frame times
- Weighted jank score: mild frame +1, moderate +3, severe +10

### Compare mode

Diffs event/call-frame/category/rendering-bucket maps between two traces — absolute delta in ms, percentage change, `(new)` for events absent in trace A. Jank score delta is labelled `regression` / `improvement` / `no change`.

## Generating a trace file

1. Open Chrome DevTools (F12)
2. Go to the Performance tab
3. Click the record button
4. Perform the actions you want to profile (e.g., scroll, interact with UI)
5. Stop recording
6. Click "Save profile" to export as JSON

## Example output

The `self ms` column shows time spent *inside* the event excluding child events,
which is often the most actionable metric (e.g. `RunTask` total is high but most
of that time is attributed to `FunctionCall` children, not `RunTask` itself).

```
=== Top trace events by CPU time ===
  count    total ms     self ms      max ms  name
      1    10481.49 ms     4200.13 ms    10481.49 ms  RunTask
      2     6452.81 ms     6452.81 ms     3301.50 ms  v8::Debugger::AsyncTaskRun
      1     3238.99 ms     3238.99 ms     3238.99 ms  v8.callFunction
      3     3235.56 ms      802.11 ms     1420.33 ms  FunctionCall
    ...

=== Frame / jank summary ===
  Total frames :  42
  Over 16.6 ms :  8
  Over  50 ms  :  2
  Over 100 ms  :  0
  Worst frames :  87.34 ms  63.12 ms  48.90 ms  32.11 ms  28.05 ms
  Jank score   :  14

=== Angular heuristics ===
- zone.js detected in call frames. Every async operation (setTimeout, Promises,
  XHR, event listeners) triggers a full change-detection pass. Move work that
  does not need UI updates outside Angular's zone with NgZone.runOutsideAngular().
- EventDispatch → FunctionCall pattern: EventDispatch=    320.00 ms,
  FunctionCall=   3235.56 ms (ratio 0.10). High EventDispatch cost means user/input
  events are directly driving expensive JS.
- Heavy JS/event-handler cost detected (FunctionCall > Layout).
  Suggestions:
  • Switch leaf components to ChangeDetectionStrategy.OnPush.
  • Wrap read-heavy scroll/resize handlers with NgZone.runOutsideAngular().
  • Throttle or debounce high-frequency event streams (RxJS throttleTime / debounceTime).
  • Use CDK virtual scrolling (<cdk-virtual-scroll-viewport>) for long lists.

=== Layout thrash hints ===
- Layout/style cost is significant. Look for forced reflow,
  getBoundingClientRect/offsetHeight/clientHeight reads after DOM writes,
  sticky/fixed elements, or large DOM.
```

## Use cases

- Debugging scroll jank in Angular applications
- Identifying expensive change detection cycles
- Finding layout thrashing and forced reflows
- Analyzing paint and composite performance
- Tracking down slow JavaScript execution

## Installation

```bash
# Clone and use directly
git clone https://github.com/ilyasf/profiler.git
cd profiler
npm install

# Or install globally
npm install -g .
```

## CLI entry point (with --help / --version)

A separate `cli.js` entry point provides named flags and a polished CLI experience:

```bash
node cli.js --help
node cli.js --version
node cli.js --top 10 trace.json
node cli.js -n 50 ./profiles/my-app.json
```

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--top <n>` | `-n` | Number of entries to show per section | `30` |
| `--help` | `-h` | Show help message | — |
| `--version` | `-v` | Print version and exit | — |

## Running tests

```bash
npm test            # runs Jest (index.test.js — 55 tests)
npm run test:unit   # runs modular unit tests (test/**/*.test.js — 43 tests)
```

## Project structure

```
.
├── cli.js                  # Polished CLI entry point (--help, --version, named flags)
├── index.js                # Full-featured entry point (all output formats, compare mode)
├── src/
│   ├── parser/             # Loads and parses trace JSON files
│   ├── aggregators/        # Accumulates event durations into Maps
│   ├── reporters/          # Formats and prints the report sections
│   └── heuristics/         # Generates performance hint strings
└── test/
    ├── fixtures/           # Sample trace JSON files used by unit tests
    ├── parser.test.js
    ├── aggregators.test.js
    └── reporters.test.js
```

## Angular scroll-jank walkthrough

> **Scenario:** An Angular app scrolls smoothly in development but becomes
> janky in production when the list contains hundreds of items.

### 1 — Record the trace

1. Open the app in Chrome.
2. Open DevTools → **Performance**.
3. Click **Record**, scroll quickly through the problematic list for ~3 seconds,
   then click **Stop**.
4. Save the profile as `scroll-jank.json`.

### 2 — Run the analyzer

```bash
node index.js --top 15 scroll-jank.json
```

### 3 — Interpret the output

**Look at "Top trace events by CPU time".**
If `FunctionCall` and `EventDispatch` dominate, JavaScript is the bottleneck,
not rendering.

**Look at "Angular heuristics".**
If `zone.js detected` appears, zone.js is triggering change detection on every
scroll event. The `EventDispatch → FunctionCall` ratio reveals how much of the
JS cost is driven directly by user-input events.

**Look at "Layout thrash hints".**
A high Layout event count combined with high `FunctionCall` is the classic
forced-reflow pattern: JavaScript reads layout properties (`scrollTop`,
`offsetHeight`) which forces the browser to synchronously complete a pending
layout before returning.

### 4 — Common fixes

| Symptom | Root cause | Fix |
|---------|-----------|-----|
| `FunctionCall` ≫ `Layout`, `zone.js` in Angular heuristics | zone.js triggers `ngDoCheck` on every scroll | Run scroll handler outside Angular zone: `this.ngZone.runOutsideAngular(() => window.addEventListener('scroll', ...))` |
| High `Layout` count (≥50) + `FunctionCall` together | Forced reflow inside scroll handler | Cache layout reads, avoid reading `offsetHeight`/`getBoundingClientRect` after writing to the DOM |
| High `RecalculateStyles` count | CSS applied/removed on every scroll step | Use CSS classes toggled once, or `will-change: transform` on scrolling elements |
| High `Paint` | Large areas repainted on scroll | Promote expensive elements to their own compositor layer with `transform: translateZ(0)` |
| High jank score | Frames consistently over 16.6 ms | Apply OnPush change detection, virtual scrolling (CDK), and `trackBy` on `*ngFor` |

## Screenshot
<img width="859" height="883" alt="image" src="https://github.com/user-attachments/assets/e2be54b4-60fe-4d63-a89d-3ec17bef6530" />

