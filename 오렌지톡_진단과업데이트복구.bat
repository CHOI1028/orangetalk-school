@echo off
if /i "%~1"=="utf8" goto MAIN
chcp 65001 >nul
cmd /c ""%~f0" utf8"
exit /b
:MAIN
title OrangeTalk Update Repair / 오렌지톡 업데이트 복구
set "DIAG=%USERPROFILE%\Desktop\OrangeTalk-Diagnostic.txt"
set "UPD=%LOCALAPPDATA%\my-health-diary-updater"
set "ULOG=%APPDATA%\my-health-diary\update.log"

echo ============================================================
echo    OrangeTalk - Update Repair / Diagnostic
echo    오렌지톡 - 업데이트 진단 및 복구
echo ============================================================
echo.
echo [1/4] Collecting diagnostic info...
echo       진단 정보를 수집합니다...

set "OTVER=unknown"
set "OTKEY="
for /f "delims=" %%K in ('reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall" /s /f "OrangeTalk" /d 2^>nul ^| findstr /i "HKEY_CURRENT_USER"') do set "OTKEY=%%K"
if defined OTKEY for /f "tokens=2,*" %%a in ('reg query "%OTKEY%" /v DisplayVersion 2^>nul ^| findstr /i "DisplayVersion"') do set "OTVER=%%b"
set "TGT=none"
if exist "%UPD%\pending" for /f "delims=" %%F in ('dir /b "%UPD%\pending\*.exe" 2^>nul') do for /f "tokens=3" %%v in ("%%~nF") do set "TGT=%%v"
set "VERDICT=OK"
if not "%TGT%"=="none" if not "%TGT%"=="%OTVER%" set "VERDICT=STUCK"

> "%DIAG%" echo [OrangeTalk Diagnostic]
>>"%DIAG%" echo Time : %DATE% %TIME%
>>"%DIAG%" echo PC : %COMPUTERNAME%  User : %USERNAME%
>>"%DIAG%" echo.
>>"%DIAG%" echo Installed version : %OTVER%
>>"%DIAG%" echo Target (stuck) version : %TGT%
>>"%DIAG%" echo Verdict : %VERDICT%
>>"%DIAG%" echo.
>>"%DIAG%" echo [Windows]
ver >> "%DIAG%"
>>"%DIAG%" echo.
>>"%DIAG%" echo [Updater cache] %UPD%
if exist "%UPD%" >>"%DIAG%" echo cache exists : YES
if not exist "%UPD%" >>"%DIAG%" echo cache exists : NO
>>"%DIAG%" echo [Pending files]
if exist "%UPD%\pending" dir /b "%UPD%\pending" >> "%DIAG%" 2>nul
>>"%DIAG%" echo.
>>"%DIAG%" echo [Update log - WHY it looped before / 과거 루프 이력]
if exist "%ULOG%" type "%ULOG%" >> "%DIAG%" 2>nul
if not exist "%ULOG%" >>"%DIAG%" echo (no update log on this version - will exist after next update)
echo     Saved / 저장됨: %DIAG%
echo.
echo [2/4] Closing OrangeTalk... / 오렌지톡을 종료합니다...
taskkill /F /T /IM "OrangeTalk.exe" >nul 2>&1
taskkill /F /T /IM "OrangePharmDiary.exe" >nul 2>&1
taskkill /F /T /IM "MyHealthDiary.exe" >nul 2>&1
echo [3/4] Waiting... / 잠시 기다립니다...
timeout /t 3 /nobreak >nul
echo [4/4] Deleting stuck update cache... / 멈춘 업데이트 캐시를 삭제합니다...
rmdir /S /Q "%LOCALAPPDATA%\my-health-diary-updater" >nul 2>&1
rmdir /S /Q "%LOCALAPPDATA%\OrangeTalk-updater" >nul 2>&1
rmdir /S /Q "%LOCALAPPDATA%\OrangePharmDiary-updater" >nul 2>&1
>>"%DIAG%" echo [Repair] cache deleted
echo     Done / 완료.
echo.
echo ====================== RESULT / 판정 ======================
echo  Installed / 설치 버전 : %OTVER%
echo  Target / 막혔던 대상 버전 : %TGT%
echo.
if "%VERDICT%"=="STUCK" echo  ^>^> THIS PC WAS STUCK in the update loop. Now repaired.
if "%VERDICT%"=="STUCK" echo     이 PC는 업데이트 무한루프에 막혀 있었습니다. 방금 복구했습니다.
if "%VERDICT%"=="OK" echo  ^>^> This PC is OK (already on the latest version).
if "%VERDICT%"=="OK" echo     이 PC는 정상입니다 (이미 최신 버전입니다).
echo ===========================================================
echo.
echo  1) Please restart OrangeTalk. / 오렌지톡을 다시 실행해 주세요.
echo  2) If it still loops, the diagnostic is on your clipboard (Ctrl+V),
echo     or send Desktop\OrangeTalk-Diagnostic.txt to OrangePharm.
echo  2) 그래도 반복되면, 진단 결과가 클립보드에 복사돼 있으니
echo     오렌지팜에 붙여넣기(Ctrl+V) 하거나 바탕화면의
echo     OrangeTalk-Diagnostic.txt 파일을 보내주세요.
echo.
type "%DIAG%" | clip
echo  Diagnostic copied to clipboard. / 진단 결과가 클립보드에 복사되었습니다.
echo  Press any key to finish... / 계속하려면 아무 키나 누르세요...
pause >nul
start "" notepad "%DIAG%"
