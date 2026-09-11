import { useEffect, useState } from 'react';
import {
  isProjectMcAvailable, getProjectMcStatus, checkProjectMcUpdate,
  installProjectMc, launchProjectMc, uninstallProjectMc, onProjectMcProgress,
} from '../utils/projectMc';
import '../styles/jogos-page.css';

// Item pedido: "crie uma nova categoria chamada Jogos... dentro de
// Jogos, crie duas opções: Jogos e Aplicativos... Na seção Jogos, crie
// uma área específica para o ProjectMC, onde o usuário poderá
// visualizar e baixar o launcher de Minecraft." — as duas "opções"
// viram abas dentro desta página (ver MainSidebar.jsx), e o ProjectMC
// é, por enquanto, o único item de verdade dentro da aba Jogos.
//
// Item pedido: "a arquitetura deve ser preparada para que futuramente
// outros jogos ou aplicativos também possam ser adicionados da mesma
// forma" — por isso a aba Jogos já é uma LISTA (GAME_MODULES), não um
// card fixo — adicionar um segundo jogo no futuro é só uma entrada
// nova aqui (e no catálogo MODULES do lado do Electron), sem mexer em
// mais nada desta tela.
const GAME_MODULES = [
  { id: 'projectmc', name: 'ProjectMC', description: 'Launcher de Minecraft do Project Club — instala e mantém suas modpacks, versões e mods organizados.' },
];

export default function JogosPage() {
  const [tab, setTab] = useState('games'); // 'games' | 'apps'

  return (
    <div className="jogos-page">
      <div className="jogos-page-header">
        <h1>Apps</h1>
        <p className="dim">Módulos opcionais que rodam dentro da instalação do Project Club — instale só o que você usa.</p>
      </div>

      <div className="jogos-page-tabs">
        <button type="button" className={`jogos-page-tab ${tab === 'games' ? 'active' : ''}`} onClick={() => setTab('games')}>Jogos</button>
        <button type="button" className={`jogos-page-tab ${tab === 'apps' ? 'active' : ''}`} onClick={() => setTab('apps')}>Aplicativos</button>
      </div>

      {tab === 'games' && (
        <div className="jogos-page-grid">
          {GAME_MODULES.map((mod) => (
            <ModuleCard key={mod.id} moduleId={mod.id} name={mod.name} description={mod.description} />
          ))}
        </div>
      )}

      {tab === 'apps' && (
        <div className="jogos-page-empty">
          <span className="jogos-page-empty-icon">🧩</span>
          <p>Nenhum aplicativo disponível ainda — esta aba já está pronta para receber os próximos módulos.</p>
        </div>
      )}
    </div>
  );
}

// Item pedido: "o usuário poderá visualizar e baixar o launcher...
// escolher se deseja ou não instalar... Ao clicar em Abrir ProjectMC,
// o sistema deve iniciar o módulo/janela própria do launcher" —
// card com 3 estados possíveis: não instalado (botão Instalar),
// instalado e atualizado (botão Abrir), instalado mas desatualizado
// (aviso + botão Atualizar). Só existe funcionalidade de verdade
// dentro do app desktop — na web/Android mostra por que não dá.
function ModuleCard({ moduleId, name, description }) {
  const desktopReady = isProjectMcAvailable();
  const [status, setStatus] = useState(null); // { installed, version }
  const [updateInfo, setUpdateInfo] = useState(null); // { updateAvailable, latest }
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { phase, percent }
  const [error, setError] = useState('');

  const refreshStatus = () => {
    if (!desktopReady) return;
    getProjectMcStatus(moduleId).then(setStatus).catch(() => {});
    checkProjectMcUpdate(moduleId).then((d) => (d.error ? setError(d.error) : setUpdateInfo(d))).catch((err) => setError(err.message));
  };

  useEffect(() => {
    refreshStatus();
    onProjectMcProgress((data) => {
      if (data.id !== moduleId) return;
      setProgress(data);
      if (data.phase === 'done') {
        setBusy(false);
        setProgress(null);
        refreshStatus();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const install = async () => {
    setError('');
    setBusy(true);
    setProgress({ phase: 'downloading', percent: 0 });
    try {
      const result = await installProjectMc(moduleId);
      if (!result.success) throw new Error(result.error || 'Falha desconhecida.');
    } catch (err) {
      setError(err.message);
      setBusy(false);
      setProgress(null);
    }
  };

  const open = async () => {
    setError('');
    try {
      const result = await launchProjectMc(moduleId);
      if (!result.success) throw new Error(result.error || 'Falha desconhecida.');
    } catch (err) {
      setError(err.message);
    }
  };

  // Item pedido: verificar todos os sistemas de Configurações e afins —
  // achado ao investigar "Invalid package ... app.asar" ao tentar abrir.
  // Não existia NENHUMA forma, pela tela, de se recuperar de uma
  // instalação já corrompida (isInstalled só confere se o .exe existe,
  // não a integridade interna — então, com a versão já batendo, só o
  // botão "Jogar" aparecia, sem "Atualizar" nem qualquer outra opção).
  // Reinstala do zero: desinstala (apaga a pasta inteira) e instala de
  // novo em seguida, mesmo que a versão já esteja "atualizada".
  const reinstall = async () => {
    if (!confirm(`Isso vai apagar e baixar ${name} de novo do zero. Continuar?`)) return;
    setError('');
    setBusy(true);
    setProgress({ phase: 'downloading', percent: 0 });
    try {
      await uninstallProjectMc(moduleId);
      const result = await installProjectMc(moduleId);
      if (!result.success) throw new Error(result.error || 'Falha desconhecida.');
    } catch (err) {
      setError(err.message);
      setBusy(false);
      setProgress(null);
    }
  };

  const installed = status?.installed;
  const updateAvailable = updateInfo?.updateAvailable;

  return (
    <div className="module-card">
      <div className="module-card-icon">🧱</div>
      <div className="module-card-body">
        <h3>{name}</h3>
        <p className="dim">{description}</p>

        {!desktopReady && (
          <p className="module-card-hint dim">Disponível apenas no aplicativo de desktop do Project Club (Windows).</p>
        )}

        {desktopReady && (
          <>
            {installed && <p className="module-card-version dim">Instalado — versão {status.version}</p>}
            {installed && updateAvailable && (
              <p className="module-card-update dim">Nova versão disponível: {updateInfo.latest}</p>
            )}
            {error && <p className="module-card-error">{error}</p>}

            {busy && progress && (
              <div className="module-card-progress">
                <div className="module-card-progress-label dim">
                  {progress.phase === 'downloading' ? 'Baixando...' : 'Concluindo...'}
                </div>
                <div className="module-card-progress-bar"><div style={{ width: `${progress.percent}%` }} /></div>
              </div>
            )}

            <div className="module-card-actions">
              {!installed && (
                <button type="button" className="btn-primary" disabled={busy} onClick={install}>
                  {busy ? 'Instalando...' : 'Instalar'}
                </button>
              )}
              {installed && updateAvailable && (
                <button type="button" className="btn-primary" disabled={busy} onClick={install}>
                  {busy ? 'Atualizando...' : 'Atualizar'}
                </button>
              )}
              {installed && (
                <button type="button" className="btn-play" onClick={open}>▶ Jogar</button>
              )}
              {installed && !busy && (
                <button type="button" className="btn-link" onClick={reinstall} title="Apaga e baixa de novo do zero — use se o jogo não abrir ou der erro ao abrir.">
                  🔧 Reinstalar
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
