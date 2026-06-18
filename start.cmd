@echo off
REM Start the Ads Intelligence platform
REM Finds tsx from the pnpm virtual store and runs the server orchestrator

SET TSX="%~dp0node_modules\.pnpm\node_modules\.bin\tsx.CMD"

IF NOT EXIST %TSX% (
  echo [ERROR] tsx not found. Run: npx pnpm install
  exit /b 1
)

%TSX% server\index.ts
