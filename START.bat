@echo off
title GridCaller REAL Mesh Hub
cd /d "%~dp0"
echo.
echo  ============================================
echo   GridCaller REAL — Mesh + APK share + gh
echo  ============================================
echo.
if not exist "node_modules\" (
  echo Installing packages (peerjs trystero gun capacitor)...
  call npm install
)
if not exist "dist\index.html" (
  echo Building UI...
  call npm run build
)
if not exist "share\" mkdir share
echo.
echo  Hub ports: 8765 (HTTP/WS) + 9000 (PeerJS)
echo  Drop APK in: D:\gridcaller\share\
echo  After Android build: npm run apk:copy
echo.
echo  Phone same WiFi/hotspot - open http://PC-IP:8765
echo  Stop: Ctrl+C
echo.
node server/hub.mjs
pause
