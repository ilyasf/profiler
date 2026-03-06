const fs = require('fs');
const path = require('path');

// Show help if requested
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('');
  console.log('Data Generator for AG-Grid Performance Testing');
  console.log('==============================================');
  console.log('');
  console.log('Usage:');
  console.log('  node data-generator.js [--size=<size>]');
  console.log('');
  console.log('Options:');
  console.log('  --size=<size>    Target file size (default: 200MB)');
  console.log('                   Format: <number><unit> where unit is KB, MB, or GB');
  console.log('');
  console.log('Examples:');
  console.log('  node data-generator.js                 # Generate 200MB (default)');
  console.log('  node data-generator.js --size=10MB     # Generate 10MB');
  console.log('  node data-generator.js --size=1GB      # Generate 1GB');
  console.log('  node data-generator.js --size=500KB    # Generate 500KB');
  console.log('');
  console.log('NPM Scripts:');
  console.log('  npm run generate-small    # 10MB');
  console.log('  npm run generate-medium   # 200MB');
  console.log('  npm run generate-large    # 500MB');
  console.log('  npm run generate-huge     # 1GB');
  console.log('');
  process.exit(0);
}

// Parse command line arguments
function parseSize(sizeStr) {
  const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(kb|mb|gb)?$/i);
  if (!match) {
    console.error('');
    console.error('❌ Invalid size format:', sizeStr);
    console.error('');
    console.error('Expected format: <number><unit>');
    console.error('  Examples: 200MB, 1GB, 500KB, 1.5GB');
    console.error('');
    console.error('Run with --help for more information');
    console.error('');
    process.exit(1);
  }

  const value = parseFloat(match[1]);
  const unit = (match[2] || 'MB').toUpperCase();

  // Convert to bytes
  const multipliers = {
    'KB': 1024,
    'MB': 1024 * 1024,
    'GB': 1024 * 1024 * 1024
  };

  return value * multipliers[unit];
}

function getTargetSize() {
  const args = process.argv.slice(2);
  const sizeArg = args.find(arg => arg.startsWith('--size='));

  if (sizeArg) {
    const sizeStr = sizeArg.split('=')[1];
    if (!sizeStr) {
      console.error('');
      console.error('❌ --size requires a value');
      console.error('   Example: --size=200MB');
      console.error('');
      process.exit(1);
    }
    return parseSize(sizeStr);
  }

  // Default to 200MB
  return 200 * 1024 * 1024;
}

function calculateRowsForSize(targetBytes) {
  // Estimate: each row is approximately 2400-2600 bytes in JSON
  // (Based on actual measurements: ~2500 bytes per row with 65 columns)
  const estimatedBytesPerRow = 2500;
  return Math.floor(targetBytes / estimatedBytesPerRow);
}

const targetSizeBytes = getTargetSize();
const targetSizeMB = (targetSizeBytes / (1024 * 1024)).toFixed(2);
const NUM_ROWS = calculateRowsForSize(targetSizeBytes);
const NUM_EXTRA_COLUMNS = 50; // Many columns for worse performance

console.log('========================================');
console.log('Generating large dataset for performance testing...');
console.log(`Target size: ${targetSizeMB} MB`);
console.log(`Estimated rows: ${NUM_ROWS.toLocaleString()}`);
console.log('========================================');
console.log('');

const firstNames = ['John', 'Jane', 'Michael', 'Sarah', 'David', 'Emily', 'Christopher', 'Jessica', 'Matthew', 'Ashley',
  'Joshua', 'Amanda', 'Daniel', 'Stephanie', 'Andrew', 'Jennifer', 'Joseph', 'Elizabeth', 'Ryan', 'Lauren'];
const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
  'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin'];
const companies = ['Acme Corp', 'TechStart Inc', 'Global Solutions', 'Innovation Labs', 'Enterprise Systems', 'Digital Dynamics',
  'Cloud Services Ltd', 'Data Analytics Co', 'Software Solutions', 'Tech Innovations'];
const departments = ['Engineering', 'Sales', 'Marketing', 'HR', 'Finance', 'Operations', 'IT', 'Legal', 'R&D', 'Customer Service'];
const countries = ['USA', 'Canada', 'UK', 'Germany', 'France', 'Japan', 'Australia', 'India', 'Brazil', 'Mexico'];
const statuses = ['Active', 'Inactive', 'Pending', 'Suspended', 'Trial', 'Premium', 'Standard', 'Enterprise'];

function randomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDate(start, end) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime())).toISOString();
}

function generateRow(id) {
  const row = {
    id: id,
    firstName: randomElement(firstNames),
    lastName: randomElement(lastNames),
    email: `user${id}@example.com`,
    company: randomElement(companies),
    department: randomElement(departments),
    salary: Math.floor(Math.random() * 150000) + 30000,
    age: Math.floor(Math.random() * 45) + 22,
    country: randomElement(countries),
    status: randomElement(statuses),
    joinDate: randomDate(new Date(2010, 0, 1), new Date(2024, 0, 1)),
    lastActive: randomDate(new Date(2023, 0, 1), new Date()),
    performanceScore: (Math.random() * 100).toFixed(2),
    projectsCompleted: Math.floor(Math.random() * 200),
    hoursWorked: Math.floor(Math.random() * 2000) + 500,
  };

  // Add extra columns with random data to make dataset larger and slower
  for (let i = 1; i <= NUM_EXTRA_COLUMNS; i++) {
    row[`extraField${i}`] = `Data_${id}_${i}_` + Math.random().toString(36).substring(2, 15);
  }

  return row;
}

// Generate data in chunks and write to file
const outputPath = path.join(__dirname, 'src', 'data.json');
const writeStream = fs.createWriteStream(outputPath);

writeStream.write('[\n');

for (let i = 0; i < NUM_ROWS; i++) {
  const row = generateRow(i + 1);
  const json = JSON.stringify(row);

  if (i < NUM_ROWS - 1) {
    writeStream.write('  ' + json + ',\n');
  } else {
    writeStream.write('  ' + json + '\n');
  }

  if (i % 10000 === 0) {
    console.log(`Generated ${i} rows...`);
  }
}

writeStream.write(']');
writeStream.end();

writeStream.on('error', (err) => {
  console.error('');
  console.error('❌ Error writing data file:', err.message);
  console.error('');
  process.exit(1);
});

writeStream.on('finish', () => {
  const stats = fs.statSync(outputPath);
  const actualSizeMB = (stats.size / 1024 / 1024).toFixed(2);

  console.log('');
  console.log('========================================');
  console.log('✓ Data generation complete!');
  console.log('========================================');
  console.log(`File: ${outputPath}`);
  console.log(`Rows: ${NUM_ROWS.toLocaleString()}`);
  console.log(`Target size: ${targetSizeMB} MB`);
  console.log(`Actual size: ${actualSizeMB} MB`);
  console.log('========================================');
  console.log('');
  console.log('Run "npm start" to launch the app');
});
