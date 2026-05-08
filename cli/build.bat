@echo off
echo [*] Installing CLI dependencies...
pip install -r requirements.txt

echo [*] Building single-file executable...
pyinstaller --onefile main.py -n deploymantis

echo.
echo [✔] Build complete. Binary at: dist\deploymantis.exe
echo     Run: dist\deploymantis.exe start
