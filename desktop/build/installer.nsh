; Instalador do Project Club para Windows: ganchos do electron-builder.
;
; O que sai do build (ver "win", "nsis" e "nsisWeb" no package.json):
;   - um instalador pequeno (ProjectClub-Setup-Windows.exe), com telas em português, que baixa o
;     pacote do app da própria release e instala em  %LOCALAPPDATA%\Programs\Project Club;
;   - instalação sempre "só para mim": nunca pede senha de administrador.
;
; As versões antigas eram um .exe de "um clique" que instalava sem mostrar nada na pasta
; ...\Programs\project-club-desktop. Como fica a passagem:
;   - atualização automática (o app chama o instalador com --updated): continua na pasta em que
;     já está, pra não mexer em atalho nem em ícone fixado de ninguém sem a pessoa pedir;
;   - instalador aberto pela pessoa: passa pra pasta "Project Club" e a antiga é apagada.

!define PC_LEGACY_DIR_NAME "project-club-desktop"

!ifndef BUILD_UNINSTALLER
  ; Pasta antiga que esta instalação está substituindo ("" = nenhuma).
  Var pcLegacyDir
!endif

!macro customInit
  ; Antes ainda, o app instalava pra todos os usuários (C:\Program Files\Project Club) e toda
  ; atualização pedia permissão de administrador. Se sobrou uma instalação dessas, tira (um único
  ; aviso do Windows, uma vez só) antes de instalar a nova.
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

  ; Sempre "só para mim". Sem isto, um resto de instalação antiga em "Arquivos de Programas" faria
  ; o instalador escolher "todos os usuários" sozinho e pedir administrador.
  !ifndef ONE_CLICK
    StrCpy $hasPerMachineInstallation "0"
  !endif
  !insertmacro setInstallModePerUser

  ; Pasta antiga -> pasta "Project Club" (só quando a pessoa abriu o instalador; ver o topo).
  ; $INSTDIR aqui é a pasta gravada no registro pela instalação anterior, ou a padrão nova.
  StrCpy $pcLegacyDir ""
  ${IfNot} ${isUpdated}
    ${If} $INSTDIR == $perUserInstallationFolder
      StrLen $R7 "\${PC_LEGACY_DIR_NAME}"
      StrCpy $R8 "$INSTDIR" "" -$R7
      ${If} $R8 == "\${PC_LEGACY_DIR_NAME}"
        StrCpy $pcLegacyDir "$INSTDIR"
        StrCpy $R8 "$INSTDIR" -$R7
        StrCpy $INSTDIR "$R8\${APP_FILENAME}"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

; Página "para quem instalar": não aparece. No instalador, o modo e a pasta já foram decididos no
; customInit; não dá pra usar $isForceCurrentInstall ali porque ele relê a pasta do registro e
; desfaria a troca de pasta.
!macro customInstallMode
  !ifdef BUILD_UNINSTALLER
    StrCpy $isForceCurrentInstall "1"
  !else
    Abort
  !endif
!macroend

; Primeira tela: diz o que vai acontecer e onde o app vai ficar.
!macro customWelcomePage
  ; A instalação começa logo depois desta tela (a de "para quem instalar" é pulada), então o
  ; botão daqui já é o "Instalar", e não "Avançar".
  Function pcWelcomeShow
    GetDlgItem $0 $HWNDPARENT 1
    SendMessage $0 ${WM_SETTEXT} 0 "STR:$(^InstallBtn)"
  FunctionEnd

  !define MUI_WELCOMEPAGE_TITLE "Instalar o Project Club"
  !define MUI_WELCOMEPAGE_TEXT "Este instalador baixa o Project Club da internet e instala nesta pasta:$\r$\n$\r$\n$INSTDIR$\r$\n$\r$\nNão precisa de senha de administrador.$\r$\n$\r$\nClique em Instalar para começar."
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW pcWelcomeShow
  !insertmacro skipPageIfUpdated
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInstall
  ; As versões antigas guardavam uma cópia inteira do instalador (mais de 100 MB) pra, na
  ; atualização, baixar só a diferença. Agora quem fica guardado é o pacote (package.7z, na mesma
  ; pasta); a cópia antiga não serve mais pra nada.
  !ifdef APP_PACKAGE_STORE_FILE
    !searchreplace PC_OLD_INSTALLER_COPY "${APP_PACKAGE_STORE_FILE}" "package.7z" "installer.exe"
    Delete "$LOCALAPPDATA\${PC_OLD_INSTALLER_COPY}"
  !endif

  ${If} $pcLegacyDir != ""
    ; O desinstalador antigo já apagou os arquivos; RMDir sem /r só tira a pasta se ela ficou vazia.
    RMDir "$pcLegacyDir"
    ; O app (desktop/main.js) usa isto pra passar o "Iniciar com o Windows" e o ícone fixado na
    ; barra de tarefas pro .exe da pasta nova.
    WriteRegStr HKCU "Software\ProjectClub" "OldExe" "$pcLegacyDir\${APP_EXECUTABLE_FILENAME}"
  ${EndIf}
!macroend
