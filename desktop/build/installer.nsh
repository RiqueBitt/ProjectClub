; Project Club — instalação por usuário (sem pedir permissão de administrador).
;
; Antes o app era instalado "pra todos os usuários" (Arquivos de Programas):
; toda atualização pedia o aviso azul/amarelo do Windows ("Deseja permitir que
; este app faça alterações?"). Agora ele fica em %LOCALAPPDATA%\Programs e as
; atualizações instalam sozinhas, sem aviso nenhum.
;
; Migração: se ainda existir a instalação antiga em Arquivos de Programas, ela
; é removida UMA vez (é o último aviso do Windows que aparece). Seus dados,
; login e configurações ficam (ficam em %APPDATA%, não na pasta do programa).
!macro customInit
  ReadRegStr $R8 HKCU "Software\ProjectClub" "PerMachineMigrated"
  ${If} $R8 != "1"
    ReadRegStr $R9 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $R9 != ""
    ${AndIf} ${FileExists} "$R9\${UNINSTALL_FILENAME}"
      WriteRegStr HKCU "Software\ProjectClub" "PerMachineMigrated" "1"
      ; O app (desktop/main.js) usa isto pra manter o "Iniciar com o Windows".
      WriteRegStr HKCU "Software\ProjectClub" "OldExe" "$R9\${APP_EXECUTABLE_FILENAME}"
      ExecShellWait "runas" "$R9\${UNINSTALL_FILENAME}" "/S /allusers _?=$R9"
      RMDir /r "$R9"
    ${EndIf}
  ${EndIf}
!macroend
