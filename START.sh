#!/bin/bash
set -e
cd "$(dirname "$0")"

echo ""
echo "  ============================================"
echo "   GridCaller REAL — Mobile Browser App"
echo "  ============================================"
echo ""

if [ ! -d "node_modules" ]; then
  echo "  Installing packages..."
  npm install --legacy-peer-deps
fi

if [ ! -f "dist/index.html" ]; then
  echo "  Building UI..."
  npm run build
fi

mkdir -p share

echo ""
echo "  ============================================"
echo "   App ready! Phone ko same WiFi se connect"
echo "   karo aur browser mein yeh link open karo:"
echo ""

# Show LAN IPs automatically
if command -v ip &>/dev/null; then
  IPS=$(ip -4 addr | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | grep -v 127.0.0.1)
elif command -v ifconfig &>/dev/null; then
  IPS=$(ifconfig | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | grep -v 127.0.0.1)
else
  IPS=""
fi

if [ -n "$IPS" ]; then
  for IP in $IPS; do
    echo "     http://$IP:8765"
  done
else
  echo "     http://YOUR-PC-IP:8765"
  echo "     (IP dekhne ke liye: ip addr  ya  ifconfig)"
fi

echo ""
echo "  Hub: port 8765 (HTTP/WS) + 9000 (PeerJS)"
echo "  Stop: Ctrl+C"
echo "  ============================================"
echo ""

node server/hub.mjs
