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
- **Angular heuristics** - Automated Angular-specific suggestions including:
  - zone.js detection from sampled call frames
  - EventDispatch → FunctionCall ratio analysis
  - Suggestions for `NgZone.runOutsideAngular()`, `ChangeDetectionStrategy.OnPush`, RxJS throttling, and CDK virtual scrolling
- **Layout thrash hints** - Layout-thrashing detection including:
  - Frequency-based Layout / RecalculateStyles spike detection
  - Forced-reflow call-site identification (reads of `getBoundingClientRect`, `offsetHeight`, `scrollTop`, etc.)
  - Recommendations for DOM read/write batching and `requestAnimationFrame` scheduling

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

=== Angular heuristics ===
- zone.js detected in call frames. Every async operation (setTimeout, Promises,
  XHR, event listeners) triggers a full change-detection pass. Move work that
  does not need UI updates outside Angular's zone with NgZone.runOutsideAngular().
- EventDispatch → FunctionCall pattern: EventDispatch=  320.00 ms,
  FunctionCall= 3235.56 ms (ratio 0.10). High EventDispatch cost means user/input
  events are directly driving expensive JS.
- Heavy JS/event-handler cost detected (FunctionCall > Layout).
  Suggestions:
  • Switch leaf components to ChangeDetectionStrategy.OnPush.
  • Wrap read-heavy scroll/resize handlers with NgZone.runOutsideAngular().
  • Throttle or debounce high-frequency event streams (RxJS throttleTime / debounceTime).
  • Use CDK virtual scrolling (<cdk-virtual-scroll-viewport>) for long lists.

=== Layout thrash hints ===
- High layout/style-recalculation frequency detected: Layout×120, RecalculateStyles×118.
  Suggestions:
  • Batch all DOM reads first, then apply all DOM writes (e.g. use FastDOM).
  • Replace synchronous reads like getBoundingClientRect() inside loops with values
    cached before the loop.
  • Use ResizeObserver instead of polling offsetWidth/offsetHeight.
  • Schedule write-heavy work in requestAnimationFrame callbacks.
- Likely forced-reflow call sites detected (property reads that flush layout):
      450.00 ms  getBoundingClientRect @ https://example.com/app.js:200
```

## Use cases

- Debugging scroll jank in Angular applications
- Identifying expensive change detection cycles
- Finding layout thrashing and forced reflows
- Analyzing paint and composite performance
- Tracking down slow JavaScript execution
