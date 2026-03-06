# Trace Debug

A tool for analyzing Chrome DevTools performance trace files to identify performance bottlenecks, scroll jank, and rendering issues.

## Usage

```bash
node index.js ./example-trace.json
```

Or with a custom top-N limit (default is 30):

```bash
node index.js ./example-trace.json 50
```

## What it does

This tool parses Chrome performance trace JSON files and provides:

- **Top trace events by CPU time** - Shows which browser operations consumed the most time
- **Top JS call frames / URLs** - Identifies the JavaScript functions and URLs with highest execution time
- **Top categories** - Groups events by their trace categories
- **Scroll / rendering related events** - Filters events that may impact scroll performance
- **Important rendering buckets** - Key metrics for layout, paint, and composite operations
- **Heuristic hints** - Automated suggestions for common performance issues

## Generating a trace file

1. Open Chrome DevTools (F12)
2. Go to the Performance tab
3. Click the record button
4. Perform the actions you want to profile (e.g., scroll, interact with UI)
5. Stop recording
6. Click "Save profile" to export as JSON

## Example output

```
=== Top trace events by CPU time ===
  10481.49 ms  RunTask
   6452.81 ms  v8::Debugger::AsyncTaskRun
   3238.99 ms  v8.callFunction
   3235.56 ms  FunctionCall
   3227.56 ms  PageAnimator::serviceScriptedAnimations
   ...

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
