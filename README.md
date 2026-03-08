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
- **Heuristic hints** - Automated suggestions for common performance issues

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

=== Heuristic hints ===
- Heavy JS/event-handler cost. In Angular this often means scroll listeners,
  zone.js-triggered change detection, or repeated component work.
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

## Example output
<img width="859" height="883" alt="image" src="https://github.com/user-attachments/assets/e2be54b4-60fe-4d63-a89d-3ec17bef6530" />

