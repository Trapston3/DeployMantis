#!/usr/bin/env bash
set -euo pipefail

echo "[*] Installing CLI dependencies..."
pip install -r requirements.txt

echo "[*] Building single-file executable..."
pyinstaller --onefile main.py -n deploymantis

echo ""
echo "[✔] Build complete. Binary at: dist/deploymantis"
echo "    Run: ./dist/deploymantis start"
