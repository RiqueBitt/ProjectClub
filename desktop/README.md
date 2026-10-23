# Project Club — App de Desktop (Windows)

Janela do Chromium (Electron) que carrega a versão web já hospedada do
Project Club — não reimplementa nada do site, é a mesma coisa que abrir no
navegador, só que como um app de verdade.

## O que ele faz
- Ícone na bandeja do sistema (com opção de ligar/desligar "iniciar com o Windows")
- Abre automaticamente ao ligar o PC (minimizado na bandeja, sem abrir janela)
- Fechar a janela (o "X") não encerra o app — ele continua rodando em
  segundo plano; só sai de vez pelo menu da bandeja ("Sair")
- Instalador (NSIS) pede permissão de administrador uma vez, na instalação
  — o app do dia a dia não pede UAC toda hora (isso quebraria rodar
  sozinho em segundo plano)

## Rodar localmente (desenvolvimento)
```bash
cd desktop
npm install
npm start
```

## Gerar o instalador .exe
```bash
cd desktop
npm install
npm run build:win
```
O instalador fica em `desktop/dist/Project Club Setup <versão>.exe`.

Isso normalmente roda sozinho via GitHub Actions (ver
`.github/workflows/build-windows.yml`) — não precisa fazer isso na mão a
cada atualização.
