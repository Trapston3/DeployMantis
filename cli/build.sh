#!/usr/bin/env bash
set -euo pipefail

echo "[*] Installing CLI dependencies..."
pip install -r requirements.txt

echo "[*] Building single-file executable..."
pyinstaller --onefile main.py -n aegis

echo ""
echo "[✔] Build complete. Binary at: dist/aegis"
echo "    Run: ./dist/aegis start"
