#!/bin/bash

echo "========================================="
echo "Angular 15 AG-Grid Performance Debug Setup"
echo "========================================="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null
then
    echo "❌ Node.js is not installed. Please install Node.js 16+ first."
    exit 1
fi

echo "✓ Node.js version: $(node --version)"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo ""
echo "✓ Dependencies installed successfully"
echo ""

# Generate data
echo "📊 Generating dataset (200MB default)..."
echo "    To generate different sizes later, use:"
echo "    npm run generate-small   (10MB)"
echo "    npm run generate-medium  (200MB)"
echo "    npm run generate-large   (500MB)"
echo "    npm run generate-huge    (1GB)"
echo "    or: node data-generator.js --size=<size>"
echo ""
npm run generate-data

if [ $? -ne 0 ]; then
    echo "❌ Failed to generate data"
    exit 1
fi

echo ""
echo "========================================="
echo "✓ Setup complete!"
echo "========================================="
echo ""
echo "To start the development server, run:"
echo "  npm start"
echo ""
echo "The app will be available at http://localhost:4200"
echo ""
