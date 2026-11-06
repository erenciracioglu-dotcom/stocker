@echo off
rem Stocker: yerel sunucuyu baslatir ve tarayiciyi acar.
cd /d "%~dp0"
set PORT=8765
set PY=
where py >nul 2>nul && set PY=py
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set PY="%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not defined PY set PY=python
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:%PORT%/"
echo Stocker calisiyor: http://localhost:%PORT%/
echo Kapatmak icin bu pencereyi kapat.
%PY% -m http.server %PORT%
