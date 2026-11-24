# Como contribuir

Vale para quem contribui de fora, e também para o Claude quando abrir um PR.

## Fluxo

1. Faça um fork e clone. Aponte `upstream` para este repositório:
   `git remote add upstream https://github.com/RiqueBitt/ProjectClub.git`
2. Antes de começar, atualize: `git fetch upstream && git rebase upstream/main`.
3. Um branch por mudança: `fix/...`, `feat/...`, `docs/...`, `chore/...`.
4. Commits no padrão Conventional Commits (`fix(chat): ...`). O número da versão
   sai deles (ver "Versões" no README).
5. Abra o PR contra `main` preenchendo o modelo.

## PR bom aqui

- **Pequeno e com um assunto só.** Se passar de ~400 linhas, divida.
- **Explica o porquê**, não só o quê. O dono usa o Claude para revisar e
  continuar o trabalho, então o motivo e como testar precisam estar escritos no PR.
- **Mudou uma rota que já está em Rust? Mude nos dois** (`server/src` e
  `rust/pc-server/src/routes`). As rotas portadas estão em `rust/pc-server/src/lib.rs`.
- **Arte e imagens:** siga as regras do `CLAUDE.md`. Nada de imagem gerada por IA.
- **Nunca commite segredo**: `.env`, chaves, certificados (`*.pem`), tokens.
- Coisas grandes ou arriscadas ficam num branch separado até o dono liberar.

## Rodar e testar

Veja "Rodar localmente" no README. Testes do servidor: `npm test` em `server/`.
Testes do Rust: `cd rust && ./verificar.sh`.
