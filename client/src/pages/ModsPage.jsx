import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ModsLibrary, { useModsLibrary } from './mods/ModsLibrary.jsx';
import GameManager from './mods/GameManager.jsx';
import { NxmLinkHandler } from './mods/NexusViews.jsx';
import { peekPendingModpack, peekAnyPendingModpack, clearPendingModpack } from './mods/modpackShared.js';
import { useLibraryUpdates } from './mods/modUpdates.js';
import '../styles/mods.css';

// Item pedido: "Project Club → Apps → Mods → detectar Steam → detectar
// jogos instalados → mostrar os jogos do usuário → escolher um jogo →
// mostrar os mods disponíveis → instalar e gerenciar mods." — esta é a
// página inteira desse fluxo, com navegação interna própria (mesmo
// padrão de JogosPage.jsx: um estado de "view" em vez de várias rotas
// separadas, já que tudo isso é uma experiência só e contínua).
//
// Item pedido: "faça um novo sistema na aba mods mostrando um álbum de
// jogos que o user tem e quando clicar vai abrir um menu mostrando mods,
// gerenciar etc... tudo parecido com o CurseForge" — agora são só duas
// telas:
// - Biblioteca (mods/ModsLibrary.jsx): álbum com a capa de TODOS os
//   jogos da Steam detectados, com ou sem suporte a mods.
// - Gerenciador do jogo (mods/GameManager.jsx): capa grande + abas
//   Explorar (mods compatíveis de cada fonte: mod.io, Steam Workshop,
//   GameBanana, Thunderstore), Instalados, Modpacks e Arquivos.
//
// Thunderstore: item pedido "pegue a interface e tudo do Gale
// [Thunderstore Mod Manager] e funda com o que eu já tenho" —
// implementação própria, direto contra a API pública do Thunderstore,
// nenhum código do Gale (GPL-3.0) foi copiado.
export default function ModsPage() {
  const navigate = useNavigate();
  const library = useModsLibrary();
  const updates = useLibraryUpdates(library);
  const [selectedGame, setSelectedGame] = useState(null);
  const [openOpts, setOpenOpts] = useState(null); // { tab, mod } vindos da tela inicial
  const [notice, setNotice] = useState('');
  const scrollRef = useRef(null);
  const albumScroll = useRef(0);

  const openGame = (game, opts) => {
    albumScroll.current = scrollRef.current?.scrollTop || 0;
    setOpenOpts(opts || null);
    setSelectedGame(game);
    requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; });
  };
  // "Ver modpack" no perfil: quando a biblioteca termina de carregar,
  // abre direto o jogo do modpack pedido (a aba Modpacks abre o pack).
  // Sem o jogo no PC (ou no navegador): avisa em vez de ficar parado.
  useEffect(() => {
    if (selectedGame || library.loading) return;
    const pending = peekAnyPendingModpack();
    if (!pending) return;
    const target = library.games.find((g) => peekPendingModpack(g.steamAppId));
    if (target) { openGame(target); return; }
    if (!pending.autoInstall) return;
    clearPendingModpack();
    setNotice(library.desktopReady
      ? `Não encontramos o jogo deste modpack${pending.name ? ` (${pending.name})` : ''} na sua Steam. Instale o jogo e tente de novo pelo perfil.`
      : 'Instalar modpacks precisa do app do Project Club no PC.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library.loading, library.games]);

  const backToLibrary = () => {
    setSelectedGame(null);
    setOpenOpts(null);
    library.refreshCounts();
    updates.refresh();
    requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = albumScroll.current; });
  };

  return (
    <div className="mdx-page" ref={scrollRef}>
      {selectedGame ? (
        <GameManager
          key={selectedGame.steamAppId}
          game={selectedGame}
          onBack={backToLibrary}
          scrollRef={scrollRef}
          initialTab={openOpts?.tab || null}
          initialMod={openOpts?.mod || null}
          onUpdatesChanged={updates.refresh}
        />
      ) : (
        <ModsLibrary
          library={library}
          updates={updates}
          onBack={() => navigate('/jogos')}
          onOpenGame={openGame}
          notice={notice}
          onDismissNotice={() => setNotice('')}
        />
      )}
      <NxmLinkHandler games={library.games} loading={library.loading} />
    </div>
  );
}
