; OrangeTalk installer hooks.
; Preserve legacy install folders and registry entries: an old path may contain user data.
; Never execute an arbitrary legacy uninstaller or recursively remove its install directory.
; Keep current-install process handling and only remove known shortcuts / obsolete updater caches.

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

!macro customInstall
  ; Legacy installs remain available for explicit manual removal.

  ; ── 3단계: 바로가기 정리 ──
  Delete "$DESKTOP\OrangePharmDiary.lnk"
  Delete "$DESKTOP\OrangefarmDiary.lnk"
  Delete "$DESKTOP\MyHealthDiary.lnk"
  Delete "$SMPROGRAMS\OrangePharmDiary.lnk"
  Delete "$SMPROGRAMS\OrangefarmDiary.lnk"
  Delete "$SMPROGRAMS\MyHealthDiary.lnk"
  RMDir "$SMPROGRAMS\OrangePharmDiary"
  RMDir "$SMPROGRAMS\OrangefarmDiary"
  RMDir "$SMPROGRAMS\MyHealthDiary"

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
