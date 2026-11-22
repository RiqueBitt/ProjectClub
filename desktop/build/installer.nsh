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

  ; Instalação com a janela do Project Club (desktop/setupWindow.js): as telas
  ; do Windows não aparecem; os arquivos são copiados em silêncio e, no fim,
  ; o app abre a janela própria ("Aceitar & Instalar", opções, progresso).
  ; Atualização automática (--updated) e instalação com /S seguem como antes.
  ${IfNot} ${Silent}
  ${AndIfNot} ${isUpdated}
    SetSilent silent
  ${EndIf}
!macroend

!macro customInstall
  ; o silêncio foi nosso (não veio /S nem --updated): abre o app pra mostrar
  ; o instalador do Project Club
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/S" $R1
  ${If} ${Errors}
  ${AndIfNot} ${isUpdated}
    Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  ${EndIf}
!macroend

; Desinstalar: abre a janela do Project Club e espera a escolha.
;   0 = desinstalar   3 = desinstalar e apagar os dados deste PC
;   1 = cancelar      2 = reinstalar (a janela já baixou e abriu o instalador)
; Qualquer outro resultado (app com defeito, arquivo faltando) cai na
; desinstalação padrão do Windows, pra ninguém ficar sem conseguir desinstalar.
!macro customUnInit
  ${IfNot} ${Silent}
    ClearErrors
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --pc-uninstall' $R0
    ${IfNot} ${Errors}
      ${If} $R0 == 1
      ${OrIf} $R0 == 2
        Quit
      ${ElseIf} $R0 == 0
      ${OrIf} $R0 == 3
        SetSilent silent
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

; "Excluir meus dados": a janela grava o caminho da pasta de dados; apaga
; aqui, depois que o app já foi fechado pelo desinstalador.
!macro customUnInstall
  ReadRegStr $R1 HKCU "Software\ProjectClub" "DeleteData"
  ${If} $R1 != ""
    RMDir /r "$R1"
    DeleteRegValue HKCU "Software\ProjectClub" "DeleteData"
  ${EndIf}
!macroend
