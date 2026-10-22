; Extra NSIS pieces for the ADActive installer (per-user install, no admin rights).
; Finish page: an optional (unchecked) box "Start ADActive when Windows starts". The uninstaller removes the entry.
; electron-builder defines PRODUCT_FILENAME on the makensis command line (the exe is "<PRODUCT_FILENAME>.exe").

!macro customHeader
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Start ADActive when Windows starts"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION ADActiveEnableAutoStart
!macroend

; Only the installer pass uses this function; the separate uninstaller pass would warn about an unreferenced
; function (and electron-builder treats warnings as errors).
!ifndef BUILD_UNINSTALLER
Function ADActiveEnableAutoStart
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ADActive" '"$INSTDIR\${PRODUCT_FILENAME}.exe"'
FunctionEnd
!endif

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ADActive"
!macroend
