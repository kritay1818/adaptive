; Extra NSIS pieces for the ADActive installer (per-user install, no admin rights).
; The installer asks once (skipped for silent installs, default "No") whether to start ADActive when Windows starts.
; The uninstaller removes that entry. electron-builder defines PRODUCT_FILENAME ("<PRODUCT_FILENAME>.exe" is the app).

!macro customInstall
  IfSilent adactiveSkipAutoStart
  MessageBox MB_YESNO|MB_ICONQUESTION "Start ADActive automatically when Windows starts?" /SD IDNO IDNO adactiveSkipAutoStart
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ADActive" '"$INSTDIR\${PRODUCT_FILENAME}.exe"'
  adactiveSkipAutoStart:
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ADActive"
!macroend
