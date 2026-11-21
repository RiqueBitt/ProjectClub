# Festas 2013-2017 da Praça (Club Penguin)

Ferramentas que montam as festas que o Waddle Forever não tem.

| Arquivo | O que faz |
| --- | --- |
| `parties.json` | Festas, datas (Club Penguin Wiki), nomes em português e quais são de outras marcas (só a staff liga). |
| `fetch.py` | Baixa salas, músicas e mapas da cópia da Club Penguin Archives → release `waddle-parties` (`media-parties.tar`). Roda no workflow `waddle-parties.yml`. |
| `fetch-ui.py` | Baixa as telas (close-ups, catálogos, avisos de sócio, `content/features.swf`), em português quando existe, e os `paths.json` originais do Wayback Machine → `media-parties-ui.tar`, `parties-ui-index.json`, `parties-paths-union.json`. Workflow `waddle-parties-ui.yml`. |
| `build-data.py` | `index.json` da release → `server/src/services/waddle/parties-data.json` (salas e músicas de cada festa). |
| `build-ui.py` | Telas de cada festa (`ui` no `parties-data.json`) + `server/src/services/waddle/parties-paths.json` (chaves do paths.json). |
| `party-commands.py` | Lista os comandos XT (`festa#acao`) das salas decompiladas (FFDec `-export script`). |
| `party-cookies.py` | Valores padrão do progresso de cada festa + `PARTY_SERVICE` → `server/waddle/src/server/game-data/party-cookies.ts`. |
| `party-keys.json` | Chaves de telas que as salas de cada festa pedem (tiradas do código das salas). |

O servidor baixa os pacotes da release sozinho (`server/src/services/waddle/parties.js`).
