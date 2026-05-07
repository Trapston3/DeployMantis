@echo off
echo [*] Installing CLI dependencies...
pip install -r requirements.txt

echo [*] Building single-file executable...
pyinstaller --onefile main.py -n aegis

echo.
echo [✔] Build complete. Binary at: dist\aegis.exe
echo     Run: dist\aegis.exe start
