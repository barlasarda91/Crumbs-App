@echo off
echo Starting Crumbs...
start cmd /k "node server.js"
timeout /t 2 >nul
start cmd /k "npm run dev"
echo.
echo Crumbs is starting! Open http://localhost:5173 in your browser.
