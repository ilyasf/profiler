# Quick Usage Guide

## Generate Data with Different Sizes

### Using npm scripts (recommended)
```bash
npm run generate-small   # 10MB dataset
npm run generate-medium  # 200MB dataset (default)
npm run generate-large   # 500MB dataset
npm run generate-huge    # 1GB dataset
```

### Using custom sizes
```bash
node data-generator.js --size=50MB
node data-generator.js --size=1.5GB
node data-generator.js --size=100KB
```

### Size format
- **KB** = Kilobytes (1024 bytes)
- **MB** = Megabytes (1024 KB) - default if no unit specified
- **GB** = Gigabytes (1024 MB)

## Examples

**Small test (fast generation, quick loading):**
```bash
node data-generator.js --size=5MB
```

**Medium performance testing:**
```bash
npm run generate-medium
```

**Heavy performance testing:**
```bash
npm run generate-large
```

**Extreme stress test (may crash browser!):**
```bash
node data-generator.js --size=2GB
```

## Start Development Server

```bash
npm start
```

Opens at `http://localhost:4200`

## Common Commands

```bash
# Install dependencies
npm install

# Generate default data (200MB)
npm run generate-data

# Start dev server
npm start

# Build for production
npm run build
```

## Performance Testing Tips

1. **Start small** - Use 10MB to verify everything works
2. **Increase gradually** - Try 100MB, then 200MB, then 500MB
3. **Profile carefully** - Larger datasets may freeze dev tools
4. **Watch memory** - Chrome Task Manager shows memory usage
5. **Browser limits** - Most browsers can handle ~1GB, 2GB+ may crash

## Troubleshooting

**Generation too slow?**
- Use smaller size for testing
- Generation time: ~1 second per 10MB

**Browser crashes when loading?**
- Reduce data size
- Close other tabs
- Use Chrome with more memory flags

**File not found error?**
- Make sure to run `npm run generate-data` first
- Check that `src/data.json` exists
