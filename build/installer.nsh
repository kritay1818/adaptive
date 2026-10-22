; Extra NSIS pieces for the ADActive installer (per-user install, no admin rights).
; Finish page: an optional (unchecked) box "Start ADActive when Windows starts". The uninstaller removes the entry.

!macro customHeader
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Start ADActive when Windows starts"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION ADActiveEnableAutoStart
!macroend

Function ADActiveEnableAutoStart
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ADActive" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
FunctionEnd

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ADActive"
!macroend
