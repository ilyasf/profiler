# Angular 15 AG-Grid Performance Debug Example

This is an intentionally poorly performing Angular 15 application with ag-grid, designed for performance debugging and profiling.

## Features

- **Angular 15** with **zone.js** enabled
- **AG-Grid Community** with 500k rows of data
- **Intentional performance anti-patterns** including:
  - Loading large dataset inefficiently
  - Frequent unnecessary change detection (every 100ms)
  - Slow value formatters in grid cells
  - Forcing cell refresh on every change
  - Column virtualization disabled
  - Processing data row-by-row instead of in batch

## Setup Instructions

### 1. Install Dependencies

```bash
cd html
npm install
```

### 2. Generate Large Dataset

You can generate datasets of different sizes:

**Default (200MB):**
```bash
npm run generate-data
```

**Pre-configured sizes:**
```bash
npm run generate-small   # 10MB dataset
npm run generate-medium  # 200MB dataset
npm run generate-large   # 500MB dataset
npm run generate-huge    # 1GB dataset (may crash some browsers!)
```

**Custom size:**
```bash
node data-generator.js --size=50MB
node data-generator.js --size=750MB
node data-generator.js --size=2GB
node data-generator.js --size=5KB
```

This generates `src/data.json` with:
- Variable number of rows based on target size
- 65+ columns per row
- Varied data types (strings, numbers, dates)
- Approximately matching the requested size

**Note:** Sizes over 1GB may crash browsers when loading all data into memory at once!

### 3. Run Development Server

```bash
npm start
```

The app will open at `http://localhost:4200`

## Performance Anti-Patterns Implemented

### 1. **Zone.js Change Detection Issues**
- `setInterval` running every 100ms updating component state
- Triggers change detection constantly
- Very inefficient for large datasets

### 2. **Inefficient Data Loading**
- Loads entire JSON file into memory
- Processes rows one-by-one with async delays
- Forces change detection during load

### 3. **AG-Grid Configuration Issues**
- `suppressColumnVirtualisation: true` - renders all columns
- `enableCellChangeFlash: true` - triggers animations
- `animateRows: true` - causes reflows
- `rowBuffer: 50` - large buffer size

### 4. **Slow Value Formatters**
- Salary column has intentionally slow formatter
- Performs unnecessary loops (100 iterations)

### 5. **Unnecessary Grid Refreshes**
- `refreshCells({ force: true })` on every cell change
- Updates all rows at once instead of batched updates

## Debugging Tools

Use these buttons to test performance:

1. **Load Data** - Loads the large dataset inefficiently
2. **Trigger Change Detection** - Forces 100 change detection cycles
3. **Add Random Row** - Adds a row with full change detection
4. **Update All Rows** - Modifies every row causing massive re-render

## Performance Profiling

### Chrome DevTools
1. Open DevTools (F12)
2. Go to Performance tab
3. Click Record
4. Click "Load Data" button
5. Stop recording
6. Analyze the flame graph

Look for:
- Long tasks (>50ms)
- Zone.js overhead
- AG-Grid rendering
- Change detection cycles

### Angular DevTools
1. Install Angular DevTools extension
2. Open the Profiler tab
3. Start recording
4. Interact with the app
5. Analyze change detection cycles

## Making It Worse (Optional)

To make performance even worse:

1. **Increase dataset size** using the size parameter:
   ```bash
   node data-generator.js --size=2GB
   ```

2. **Increase change detection frequency** in `app.component.ts`:
   ```typescript
   setInterval(() => {
     this.status = `Status: ${new Date().toLocaleTimeString()}`;
   }, 10); // Every 10ms instead of 100ms!
   ```

## Data Generation Options

The data generator accepts a `--size` parameter:

**Format:** `--size=<number><unit>`

**Units supported:**
- `KB` - Kilobytes (e.g., `--size=500KB`)
- `MB` - Megabytes (e.g., `--size=200MB`) - Default if no unit specified
- `GB` - Gigabytes (e.g., `--size=1GB`)

**Examples:**
```bash
# Small test dataset
node data-generator.js --size=1MB

# Medium dataset for testing
node data-generator.js --size=100MB

# Large dataset for stress testing
node data-generator.js --size=1.5GB

# Tiny dataset for quick tests
node data-generator.js --size=100KB
```

The script estimates approximately 2.5KB per row (with 65 columns) and calculates the number of rows needed to reach your target size.

## Files Structure

```
html/
├── src/
│   ├── app.component.ts    # Main component with ag-grid
│   ├── app.module.ts       # Angular module
│   ├── index.html          # HTML entry point
│   ├── main.ts             # Bootstrap file
│   ├── polyfills.ts        # Polyfills (zone.js)
│   ├── styles.css          # Global styles
│   └── data.json          # Generated data (not in git)
├── data-generator.js       # Script to generate test data
├── package.json
├── tsconfig.json
└── webpack.config.js
```

## Troubleshooting

**Data not loading?**
- Make sure you ran `npm run generate-data` first
- Check that `src/data.json` exists

**Browser crashes?**
- Reduce `NUM_ROWS` in `data-generator.js`
- Close other tabs
- Use a browser with more memory

**Build errors?**
- Delete `node_modules` and run `npm install` again
- Make sure you're using Node.js 16+

## License

MIT - Use for debugging and learning purposes.
