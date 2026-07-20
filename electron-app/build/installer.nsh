; ─────────────────────────────────────────────────────────────────────────────
; Custom NSIS hooks for OrangeTalk installer (electron-builder)
;
; 핵심 동작:
; - preInit : NSIS 가 옛 InstallLocation 레지스트리에서 캐시된 경로 (예:
;   $LOCALAPPDATA\Programs\MyHealthDiary\OrangePharmDiary) 를 기본값으로
;   제안하면 컴맹 사용자가 그대로 수락 → 정리 hook 충돌로 새 설치까지 손상.
;   preInit 에서 $INSTDIR 를 무조건 표준 경로로 덮어써서 그 경로 사고 자체를 차단.
;
; - customInit / customUnInit : 옛 프로세스 트리 단위 강제 종료 (파일 락 해제).
;
; - customInstall : 새 OrangeTalk 설치 직후 옛 설치 흔적을 "자동 발견·자동 정리".
;   각 옛 productName 별로:
;     1. HKCU/HKLM 레지스트리에서 InstallLocation 읽기 (사용자 커스텀 경로도 OK)
;     2. $INSTDIR 와 충돌(같거나 부모) 검사 — 충돌하면 정리 skip (자기 보호)
;     3. 옛 UninstallString silent 실행 (가장 깔끔)
;     4. Uninstaller 없으면 RMDir 폴백
;   추가로 표준 경로 (Programs\<name>) 와 표준 바로가기·레지스트리도 한 번 더 정리.
;
; ⚠ 절대 안 건드림 : %APPDATA%\MyHealthDiary  (= userData)
;    학생·교직원·보건일지 기록·설정·Kakao 키·키오스크 채널·백업 등이 보관되는
;    위치. 옛 Uninstaller 도 deleteAppDataOnUninstall:false 설정으로 만들어졌으므로
;    이 폴더 절대 안 지움. 새 OrangeTalk 이 그대로 인계받음.
;    NSIS 스크립트 어디에서도 $APPDATA 변수를 RMDir 으로 호출하지 않는다.
; ─────────────────────────────────────────────────────────────────────────────

!include "LogicLib.nsh"

; ─────────────────────────────────────────────────────────────────────────────
; WaitProcGone — 지정 exe 가 tasklist 에서 "완전히 사라질 때까지" 대기 (플러그인 없이).
;   자동 업데이트 무한루프의 실제 원인: taskkill 후 0.3초(Sleep 300)만 기다리고 파일을
;   덮어써서, Windows 가 핸들을 채 놓기 전(헬퍼 프로세스·백신 스캔)에 NSIS 가 잠긴 파일을
;   만나 복사 도중 설치가 중단(진행바가 다 차기 전에 꺼짐)→롤백→옛 버전 유지→"반복하면 됨".
;   → find 종료코드(0=발견,1=없음)로 프로세스가 없어질 때까지 taskkill+대기 반복. (2026-07-02)
; ─────────────────────────────────────────────────────────────────────────────
!macro WaitProcGone EXE
  Push $R0
  Push $R1
  StrCpy $R0 0
  ${Do}
    nsExec::Exec 'cmd /c tasklist /FI "IMAGENAME eq ${EXE}" /NH | find /I "${EXE}"'
    Pop $R1
    ${If} $R1 <> 0
      ${Break}
    ${EndIf}
    nsExec::ExecToLog 'taskkill /F /IM "${EXE}" /T'
    Sleep 500
    IntOp $R0 $R0 + 1
  ${LoopUntil} $R0 >= 20
  Pop $R1
  Pop $R0
!macroend

; 앱의 모든 명칭(현재+옛) 프로세스를 확실히 종료하고, 핵심 exe 가 사라질 때까지 대기 후 정착.
!macro KillAllAndSettle
  nsExec::ExecToLog 'taskkill /F /IM "OrangePharmDiary.exe" /T'
  nsExec::ExecToLog 'taskkill /F /IM "OrangefarmDiary.exe" /T'
  nsExec::ExecToLog 'taskkill /F /IM "MyHealthDiary.exe" /T'
  !insertmacro WaitProcGone "OrangeTalk.exe"
  !insertmacro WaitProcGone "OrangePharmDiary.exe"
  !insertmacro WaitProcGone "OrangefarmDiary.exe"
  !insertmacro WaitProcGone "MyHealthDiary.exe"
  Sleep 2000   ; 핸들 해제·백신 스캔 정착 여유 (복사 중 잠금 방지)
!macroend

!macro preInit
  SetShellVarContext current
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\OrangeTalk"
!macroend

!macro customInit
  !insertmacro KillAllAndSettle
!macroend

!macro customUnInit
  !insertmacro KillAllAndSettle
!macroend

; 지정 hive(HKCU/HKLM) 에서 옛 productName 의 InstallLocation 을 읽어
; $INSTDIR 와 충돌 없으면 옛 Uninstaller silent 실행 → 안전 정리.
!macro SafeCleanInstallLocation HIVE REG_NAME
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  ReadRegStr $R0 ${HIVE} "Software\Microsoft\Windows\CurrentVersion\Uninstall\${REG_NAME}" "InstallLocation"
  ${If} $R0 != ""
    StrLen $R1 $R0
    StrCpy $R2 $INSTDIR $R1
    ${If} $R2 != $R0
      ReadRegStr $R3 ${HIVE} "Software\Microsoft\Windows\CurrentVersion\Uninstall\${REG_NAME}" "UninstallString"
      ${If} $R3 != ""
        ExecWait '$R3 /S _?=$R0'
      ${EndIf}
      RMDir /r $R0
    ${EndIf}
  ${EndIf}
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

; 표준 설치 경로 ($LOCALAPPDATA\Programs\<name>) 가 남아 있는 경우 정리.
; $INSTDIR 와 충돌 시 skip.
!macro SafeRmStandardFolder OLD_PATH
  Push $R0
  Push $R1
  StrLen $R0 "${OLD_PATH}"
  StrCpy $R1 $INSTDIR $R0
  ${If} $R1 != "${OLD_PATH}"
    RMDir /r "${OLD_PATH}"
  ${EndIf}
  Pop $R1
  Pop $R0
!macroend

!macro customInstall
  ; ── 1단계: 레지스트리 기반 자동 발견·정리 (커스텀 경로 포함) ──
  !insertmacro SafeCleanInstallLocation HKCU "OrangePharmDiary"
  !insertmacro SafeCleanInstallLocation HKLM "OrangePharmDiary"
  !insertmacro SafeCleanInstallLocation HKCU "OrangefarmDiary"
  !insertmacro SafeCleanInstallLocation HKLM "OrangefarmDiary"
  !insertmacro SafeCleanInstallLocation HKCU "MyHealthDiary"
  !insertmacro SafeCleanInstallLocation HKLM "MyHealthDiary"

  ; ── 2단계: 표준 경로 잔재 폴더 한 번 더 검사 ──
  !insertmacro SafeRmStandardFolder "$LOCALAPPDATA\Programs\OrangePharmDiary"
  !insertmacro SafeRmStandardFolder "$LOCALAPPDATA\Programs\OrangefarmDiary"
  !insertmacro SafeRmStandardFolder "$LOCALAPPDATA\Programs\MyHealthDiary"

  ; ── 3단계: 바로가기 정리 ──
  Delete "$DESKTOP\OrangePharmDiary.lnk"
  Delete "$DESKTOP\OrangefarmDiary.lnk"
  Delete "$DESKTOP\MyHealthDiary.lnk"
  Delete "$SMPROGRAMS\OrangePharmDiary.lnk"
  Delete "$SMPROGRAMS\OrangefarmDiary.lnk"
  Delete "$SMPROGRAMS\MyHealthDiary.lnk"
  RMDir /r "$SMPROGRAMS\OrangePharmDiary"
  RMDir /r "$SMPROGRAMS\OrangefarmDiary"
  RMDir /r "$SMPROGRAMS\MyHealthDiary"

  ; ── 4단계: 레지스트리 잔재 정리 ──
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OrangePharmDiary"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OrangefarmDiary"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MyHealthDiary"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OrangePharmDiary"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OrangefarmDiary"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MyHealthDiary"

  ; ── 5단계: 멈춘 자동업데이트 캐시 정리 (다운그레이드 무한루프 원천 차단) ──
  ;  전국에서 보고된 증상: pending 에 옛 버전 설치파일이 남아 있으면 종료 시 자동설치가
  ;  그 묵은 exe 를 실행 → 옛 버전으로 다운그레이드 → 루프. (예: 1.0.16 → 1.0.2 사례)
  ;
  ;  ★ 현행 캐시 폴더($LOCALAPPDATA\my-health-diary-updater)는 여기서 절대 안 지운다. (2026-07-09 수정)
  ;    자동업데이트로 실행될 때 이 설치파일 자신이 바로 그 폴더 안(pending)에서 돌고 있어서,
  ;    RMDir /r 로 그 폴더를 지우면 실행 중 exe·설치 메타데이터가 잠겨 설치가 중단·롤백된다
  ;    → "다운로드는 됐으나 설치가 적용되지 않음(반복)" 발생. (1.0.17 자동업데이트 실패의 원인)
  ;    → 현행 캐시의 묵은 pending 정리는 새 버전 첫 부팅의 _purgeStalePending 이 안전하게 처리한다
  ;      (앱이 켜진 뒤라 설치파일 잠금이 없음). 이쪽이 유일하게 안전한 경로.
  ;
  ;  아래는 '지금 안 쓰는 옛 이름' 캐시 폴더들 — 실행 중일 리 없으므로 정리해도 안전.
  ;  · userData(%APPDATA%\MyHealthDiary) 는 여기서도 절대 안 건드림.
  RMDir /r "$LOCALAPPDATA\OrangeTalk-updater"
  RMDir /r "$LOCALAPPDATA\OrangePharmDiary-updater"
  RMDir /r "$LOCALAPPDATA\OrangefarmDiary-updater"
  RMDir /r "$LOCALAPPDATA\MyHealthDiary-updater"
!macroend
