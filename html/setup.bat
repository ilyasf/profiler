@echo off
echo =========================================
echo Angular 15 AG-Grid Performance Debug Setup
echo =========================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo X Node.js is not installed. Please install Node.js 16+ first.
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo [OK] Node.js version: %NODE_VERSION%
echo.

REM Install dependencies
echo [*] Installing dependencies...
call npm install

if %ERRORLEVEL% NEQ 0 (
    echo X Failed to install dependencies
    exit /b 1
)

echo.
echo [OK] Dependencies installed successfully
echo.

REM Generate data
echo [*] Generating dataset (200MB default)...
echo     To generate different sizes later, use:
echo     npm run generate-small   (10MB)
echo     npm run generate-medium  (200MB)
echo     npm run generate-large   (500MB)
echo     npm run generate-huge    (1GB)
echo     or: node data-generator.js --size=^<size^>
echo.
call npm run generate-data

if %ERRORLEVEL% NEQ 0 (
    echo X Failed to generate data
    exit /b 1
)

echo.
echo =========================================
echo [OK] Setup complete!
echo =========================================
echo.
echo To start the development server, run:
echo   npm start
echo.
echo The app will be available at http://localhost:4200
echo.
pause
