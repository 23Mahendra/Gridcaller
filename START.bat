@echo off
title GridCaller REAL Mesh Hub
cd /d "%~dp0"
echo.
echo  ============================================
echo   GridCaller REAL — Mobile Browser App
echo  ============================================
echo.
if not exist "node_modules\" (
  echo Installing packages (peerjs trystero gun capacitor)...
  call npm install --legacy-peer-deps
)
if not exist "dist\index.html" (
  echo Building UI...
  call npm run build
)
if not exist "share\" mkdir share
echo.
echo  ============================================
echo   App ready! Phone ko same WiFi se connect
echo   karo aur browser mein yeh link open karo:
echo.
echo   http://YOUR-PC-IP:8765
echo.
echo   (Apna PC ka IP ipconfig se dekho)
echo  ============================================
echo  Hub ports: 8765 (HTTP/WS) + 9000 (PeerJS)
echo  Stop: Ctrl+C
echo.
node server/hub.mjs
pause
