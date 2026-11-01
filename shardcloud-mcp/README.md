# shardcloud-mcp

Servidor MCP da **Shard Cloud** pro Claude gerenciar a conta: apps, variáveis,
logs, shell no container, bancos, backups, **deploy direto do GitHub** e
**migração MySQL → MySQL** (Square Cloud → Shard Cloud).

Usa a API REST oficial (`https://shardcloud.app/api`, Bearer token — as mesmas
rotas do [CLI oficial](https://github.com/shard-cloud/cli)).

## 1. Subir o MCP na própria Shard Cloud (5 min)

1. Dashboard → **Config → Integrações** → gere o **token da API**.
2. Gere um segredo pro MCP: `openssl rand -hex 24`.
3. Dashboard → **New app** → envie um ZIP desta pasta (`shardcloud-mcp/`, sem
   `node_modules`). O `.shardcloud` já está pronto (`SUBDOMAIN=projectclub-mcp`
   — troque se quiser).
4. No app criado → **Variáveis de ambiente**:
   - `SHARDCLOUD_API_KEY` = token da API
   - `MCP_TOKEN` = o segredo gerado
   - (opcional) `GITHUB_TOKEN` = token do GitHub se o repositório for privado
5. Ligue o acesso web do app. A URL do MCP fica:
   `https://projectclub-mcp.shardweb.app/mcp/<MCP_TOKEN>`

Teste: `https://projectclub-mcp.shardweb.app/health` → `{"ok":true}`.

## 2. Conectar no Claude

Claude → **Configurações → Conectores → Adicionar conector personalizado** →
cole a URL acima (com o token no caminho). Pronto: as ferramentas `shard_*`
e `mysql_*` aparecem na conversa.

## 3. Migração do Project Club (Square Cloud → Shard Cloud)

Ordem recomendada (o Claude faz pelas ferramentas; você só aprova):

1. **Banco MySQL novo**: `shard_create_database` (type `mysql`, RAM ≥ 512,
   senha forte). Guarde a `connection_url` (precisa de `?ssl=true` — a Shard
   exige SSL).
2. **Redis novo**: `shard_create_database` (type `redis`). Não precisa migrar
   dados (presença, cache, limites — tudo temporário).
3. **App novo do Project Club**: `shard_deploy_from_github` com
   `owner=RiqueBitt repo=ProjectClub ref=deploy` (branch já com o `client/dist`
   pronto) e `.shardcloud`:
   ```
   DISPLAY_NAME=Project Club
   MAIN=server/src/index.js
   LANGUAGE=node
   MEMORY=2048
   VERSION=recommended
   SUBDOMAIN=projectclub
   CUSTOM_COMMAND=npm run deploy:start
   ```
4. **Variáveis**: `shard_set_envs` no app novo com TODAS as variáveis da Square
   (copie com o MCP da Square: `list_app_envs`), trocando `DATABASE_URL` e
   `REDIS_URL` pelas novas. O B2 (arquivos) continua igual.
5. **Criar o esquema**: inicie o app uma vez (`shard_app_action start`) — o
   `deploy:start` roda `prisma db push` e cria as tabelas. Pode parar depois.
6. **Copiar os dados**: `mysql_copy` com `source_url` = URL da Square e
   `target_url` = URL da Shard. Primeiro com `dry_run=true` (só conta), depois
   de verdade. Reexecutar é seguro (upsert por chave).
7. **Conferir**: `mysql_compare` (contagem por tabela deve bater).
8. **Domínio**: aponte o DNS pro app da Shard (Dashboard → Domínios) e ligue o
   app. Deixe a Square ligada mais um dia; depois pare.

Dica: faça a cópia com a Square em **modo manutenção** pra ninguém escrever no
banco antigo durante a migração (o Project Club tem isso no painel).

## Ferramentas

| Grupo | Ferramentas |
|---|---|
| Conta | `shard_me` |
| Apps | `shard_list_apps` `shard_get_app` `shard_app_status` `shard_app_action` `shard_app_logs` `shard_app_http_logs` `shard_app_exec` `shard_app_metrics` `shard_app_deploys` `shard_app_restore_deploy` `shard_app_update_config` `shard_app_set_version` `shard_language_versions` `shard_app_web` `shard_delete_app` |
| Variáveis | `shard_get_envs` (mascaradas) `shard_set_envs` (merge; `null` remove) `shard_replace_envs` |
| Deploy | `shard_deploy_from_github` (cria ou atualiza; aceita subpasta) `shard_render_shardcloud` |
| Bancos | `shard_list_databases` `shard_get_database` `shard_create_database` `shard_database_connection_url` `shard_database_status` `shard_database_action` `shard_database_metrics` `shard_database_password` `shard_database_resources` `shard_delete_database` |
| Backups | `shard_list_backups` `shard_create_backup` `shard_restore_backup` `shard_backup_download_url` |
| MySQL | `mysql_tables` `mysql_copy` `mysql_compare` |
| VMs | `shard_list_vms` |

Ações destrutivas (apagar, restaurar backup) exigem `confirm=true`.

## Rodar local

```
cp .env.example .env   # preencha
npm install && npm start
npm test               # testes com API falsa
```
