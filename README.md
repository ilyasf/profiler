# trace-debug

A CLI tool for analyzing Chrome DevTools performance trace files to identify
CPU hotspots, scroll jank, layout thrashing, and other rendering issues.

## Installation

```bash
# Clone and use directly
git clone https://github.com/ilyasf/profiler.git
cd profiler
npm install

# Or install globally
npm install -g .
```

## Usage

```bash
node cli.js [options] <trace-file>
```

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--top <n>` | `-n` | Number of entries to show per section | `30` |
| `--help` | `-h` | Show help message | — |
| `--version` | `-v` | Print version and exit | — |

### Examples

```bash
# Analyze a trace file
node cli.js trace.json

# Show only the top 10 entries per section
node cli.js --top 10 trace.json
node cli.js -n 10 trace.json

# Show the full help
node cli.js --help
```

## How to export a trace from Chrome

1. Open Chrome DevTools (`F12`)
2. Go to the **Performance** tab
3. Click the **●** record button
4. Perform the actions you want to profile (e.g., scroll, interact with the UI)
5. Click **Stop**
6. Click the **↓** (download) icon to export the trace as JSON

## How to read the output

### Top trace events by CPU time

Lists every Chrome trace event type ordered by total CPU time consumed.
High values for `FunctionCall`, `TimerFire`, or `FireAnimationFrame` indicate
expensive JavaScript. High values for `Layout`, `RecalculateStyles`, or `Paint`
point to rendering work.

```
=== Top trace events by CPU time ===
  10481.49 ms  RunTask
   6452.81 ms  v8::Debugger::AsyncTaskRun
   3238.99 ms  v8.callFunction
   3235.56 ms  FunctionCall
   3227.56 ms  PageAnimator::serviceScriptedAnimations
```

### Top JS call frames / URLs

Identifies the JavaScript functions and script URLs with the highest
accumulated execution time. Great for pinpointing which script or handler is
the bottleneck.

```
=== Top JS call frames / URLs ===
   5000.00 ms  handleScroll @ https://example.com/app.js
   3000.00 ms  detectChanges @ https://example.com/zone.js:100
```

### Top categories

Groups events by their trace category. Categories like
`devtools.timeline,blink` cover rendering work; `v8` covers JavaScript
execution.

### Scroll / rendering related

A filtered view showing only events whose name, category, or arguments contain
scroll/rendering keywords (`scroll`, `wheel`, `touchmove`, `animationframe`,
`zone`, `detectchanges`, `layout`, `recalculate`, `paint`). These are the
events most likely to cause scroll jank.

### Important rendering buckets

A fixed summary of the ten most important rendering event types:

| Bucket | What it means |
|--------|---------------|
| `EventDispatch` | User-input events (click, scroll, wheel) |
| `FunctionCall` | JS function executions |
| `TimerFire` | `setTimeout`/`setInterval` callbacks |
| `FireAnimationFrame` | `requestAnimationFrame` callbacks |
| `Layout` | Browser layout (reflow) |
| `RecalculateStyles` | CSS style recalculation |
| `UpdateLayoutTree` | Incremental layout-tree update |
| `Paint` | Pixel painting |
| `RasterTask` | GPU rasterization |
| `CompositeLayers` | GPU layer compositing |

### Heuristic hints

Automated suggestions generated from the aggregated data:

- **Heavy JS/event-handler cost** — fires when `FunctionCall` time exceeds
  `Layout` time and `EventDispatch` is present. In Angular this often means
  zone.js-triggered change detection or unthrottled scroll listeners.
- **Layout/style cost is significant** — fires when `Layout` or
  `RecalculateStyles` is non-zero. Commonly caused by forced reflow
  (reading `offsetHeight`, `getBoundingClientRect` after DOM writes).
- **Paint cost is visible** — fires when `Paint` is non-zero. Check for large
  repaints, `box-shadow`, `backdrop-filter`, and large images.
- **EventDispatch overhead** — fires when `EventDispatch` is non-zero.
  Relevant for scroll jank caused by synchronous scroll/wheel/touchmove
  handlers.

---

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
node cli.js --top 15 scroll-jank.json
```

### 3 — Interpret the output

**Look at "Top trace events by CPU time".**  
If `FunctionCall` and `EventDispatch` dominate, JavaScript is the bottleneck,
not rendering.

**Look at "Top JS call frames / URLs".**  
If `zone.js` or your `AppModule` file appears near the top, zone.js is
triggering change detection on every scroll event.

**Look at "Important rendering buckets".**  
A high `Layout` value combined with high `FunctionCall` is the classic
forced-reflow pattern: JavaScript reads layout properties
(`scrollTop`, `offsetHeight`) which forces the browser to synchronously
complete a pending layout before returning.

**Look at "Heuristic hints".**  
The tool will flag:
- *"Heavy JS/event-handler cost"* → suspect zone.js change detection
- *"Layout/style cost is significant"* → suspect forced reflow

### 4 — Common fixes

| Symptom | Root cause | Fix |
|---------|-----------|-----|
| `FunctionCall` ≫ `Layout`, `zone.js` in call frames | zone.js triggers `ngDoCheck` on every scroll | Run scroll handler outside Angular zone: `this.ngZone.runOutsideAngular(() => window.addEventListener('scroll', ...))` |
| High `Layout` + `FunctionCall` together | Forced reflow inside scroll handler | Cache layout reads, avoid reading `offsetHeight`/`getBoundingClientRect` after writing to the DOM |
| High `RecalculateStyles` | CSS applied/removed on every scroll step | Use CSS classes toggled once, or `will-change: transform` on scrolling elements |
| High `Paint` | Large areas repainted on scroll | Promote expensive elements to their own compositor layer with `transform: translateZ(0)` |

---

## Project structure

```
.
├── cli.js                  # CLI entry point (--help, --version, named flags)
├── index.js                # Backward-compatible entry (delegates to cli.js)
├── src/
│   ├── parser/             # Loads and parses trace JSON files
│   ├── aggregators/        # Accumulates event durations into Maps
│   ├── reporters/          # Formats and prints the report sections
│   └── heuristics/         # Generates performance hint strings
└── test/
    ├── fixtures/           # Sample trace JSON files used by tests
    ├── parser.test.js
    ├── aggregators.test.js
    └── reporters.test.js
```

## Running tests

```bash
npm test
```

