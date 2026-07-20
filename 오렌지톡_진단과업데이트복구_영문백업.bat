@echo off
title OrangeTalk Update Repair Tool
set "DIAG=%USERPROFILE%\Desktop\OrangeTalk-Diagnostic.txt"
set "UPD=%LOCALAPPDATA%\my-health-diary-updater"
echo ============================================================
echo    OrangeTalk - Update Repair / Diagnostic Tool
echo ============================================================
echo.
echo [1/4] Collecting diagnostic info...
> "%DIAG%" echo [OrangeTalk Diagnostic]
>>"%DIAG%" echo Time : %DATE% %TIME%
>>"%DIAG%" echo PC   : %COMPUTERNAME%    User : %USERNAME%
>>"%DIAG%" echo.
>>"%DIAG%" echo [Windows Version]
ver >> "%DIAG%"
>>"%DIAG%" echo.
>>"%DIAG%" echo [Installed OrangeTalk version]
set "OTVER=unknown"
set "OTKEY="
for /f "delims=" %%K in ('reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall" /s /f "OrangeTalk" /d 2^>nul ^| findstr /i "HKEY_CURRENT_USER"') do set "OTKEY=%%K"
if defined OTKEY for /f "tokens=2,*" %%a in ('reg query "%OTKEY%" /v DisplayVersion 2^>nul ^| findstr /i "DisplayVersion"') do set "OTVER=%%b"
>>"%DIAG%" echo %OTVER%
>>"%DIAG%" echo.
>>"%DIAG%" echo [Updater cache folder] %UPD%
if exist "%UPD%" >>"%DIAG%" echo exists : YES
if not exist "%UPD%" >>"%DIAG%" echo exists : NO
>>"%DIAG%" echo.
>>"%DIAG%" echo [Pending (stuck) update files]
if exist "%UPD%\pending" dir /b "%UPD%\pending" >> "%DIAG%" 2>nul
>>"%DIAG%" echo.
>>"%DIAG%" echo [latest.yml - target version / checksum]
if exist "%UPD%\latest.yml" type "%UPD%\latest.yml" >> "%DIAG%" 2>nul
>>"%DIAG%" echo.
echo     Saved: %DIAG%
echo.
echo [2/4] Closing OrangeTalk...
taskkill /F /T /IM "OrangeTalk.exe" >nul 2>&1
taskkill /F /T /IM "OrangePharmDiary.exe" >nul 2>&1
taskkill /F /T /IM "MyHealthDiary.exe" >nul 2>&1
echo [3/4] Waiting for processes to close...
timeout /t 3 /nobreak >nul
echo [4/4] Deleting stuck update cache...
rmdir /S /Q "%LOCALAPPDATA%\my-health-diary-updater" >nul 2>&1
rmdir /S /Q "%LOCALAPPDATA%\OrangeTalk-updater" >nul 2>&1
rmdir /S /Q "%LOCALAPPDATA%\OrangePharmDiary-updater" >nul 2>&1
>>"%DIAG%" echo.
>>"%DIAG%" echo [Repair] update cache delete attempted
echo     Done.
echo.
echo ------------------------- DIAGNOSTIC -------------------------
type "%DIAG%"
echo -------------------------------------------------------------
echo.
echo ============================================================
echo  COMPLETE!  (See Korean guide: OrangeTalk-Guide-KO.txt)
echo.
echo  1) Please restart OrangeTalk.
echo  2) If it still loops, the diagnostic above is COPIED TO
echo     CLIPBOARD (Ctrl+V), and saved as:
echo     Desktop\OrangeTalk-Diagnostic.txt  -- send it to OrangePharm.
echo ============================================================
echo.
type "%DIAG%" | clip
echo  Diagnostic copied to clipboard.
echo  Press any key to finish...
pause >nul
start "" notepad "%DIAG%"
if exist "%~dp0OrangeTalk-Guide-KO.txt" start "" notepad "%~dp0OrangeTalk-Guide-KO.txt"
