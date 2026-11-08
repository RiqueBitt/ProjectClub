import { useEffect, useMemo, useState } from 'react';
import AchievementIcon from '../AchievementIcon.jsx';
import Modal from '../Modal.jsx';
import { listAchievements, setDisplayedAchievements, updateProfile } from '../../api/endpoints';
import { getGameLibrary } from '../../api/games';
import { getShop, equipDecoration, equipEffect } from '../../api/decorations';
import { proxyImage } from '../../utils/imageProxy';
import { GameCapsule } from '../games/GameLibraryParts.jsx';
import { PfIcon } from './profileParts.jsx';
import '../../styles/profile-edit.css';

// "Editar vitrine" do próprio perfil: escolhe as conquistas em destaque
// (mesmo campo de Configurações → Perfil Completo), até 4 jogos em
// destaque (User.profileShowcase) e qual moldura/efeito da Loja usar.
// Cada aba salva sozinha com o botão "Salvar" do rodapé.
export const SHOWCASE_MAX_GAMES = 4;
const MAX_ACH = 6;

export function parseShowcase(raw) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { games: Array.isArray(v?.games) ? v.games.slice(0, SHOWCASE_MAX_GAMES) : [] };
  } catch { return { games: [] }; }
}

const TABS = [
  { id: 'achievements', label: 'Conquistas', icon: 'trophy' },
  { id: 'games', label: 'Jogos', icon: 'grid' },
  { id: 'decor', label: 'Decorações', icon: 'sparkle' },
];

function Picker({ selected, onToggle, children, disabled, title }) {
  return (
    <button
      type="button" className={`pfv-pick ${selected ? 'is-on' : ''}`} aria-pressed={selected} disabled={disabled && !selected}
      title={title} onClick={onToggle}
    >
      {children}
      <span className="pfv-pick-check" aria-hidden="true"><PfIcon name={selected ? 'star' : 'plus'} size={12} strokeWidth={2.4} /></span>
    </button>
  );
}

export default function ProfileShowcaseModal({ user, displayedAchievements = [], onClose, onSaved }) {
  const [tab, setTab] = useState('achievements');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Conquistas
  const [achList, setAchList] = useState(null);
  const [achSel, setAchSel] = useState(() => displayedAchievements.map((a) => a.key).filter(Boolean));
  useEffect(() => {
    listAchievements().then((d) => setAchList((d.achievements || []).filter((a) => a.unlocked))).catch(() => setAchList([]));
  }, []);

  // Jogos
  const [library, setLibrary] = useState(null);
  const [gameSel, setGameSel] = useState(() => parseShowcase(user.profileShowcase).games);
  useEffect(() => {
    getGameLibrary('me').then((d) => setLibrary(d.games || [])).catch(() => setLibrary([]));
  }, []);

  // Decorações (moldura do avatar + efeito do perfil)
  const [shop, setShop] = useState(null);
  const [decoSel, setDecoSel] = useState(undefined); // undefined = não mexeu
  const [effectSel, setEffectSel] = useState(undefined);
  useEffect(() => {
    getShop().then(setShop).catch(() => setShop({ decorations: [], effects: [] }));
  }, []);
  const ownedDecos = useMemo(() => (shop?.decorations || []).filter((d) => d.owned), [shop]);
  const ownedEffects = useMemo(() => (shop?.effects || []).filter((e) => e.owned), [shop]);
  const curDeco = decoSel !== undefined ? decoSel : shop?.equippedId ?? null;
  const curEffect = effectSel !== undefined ? effectSel : shop?.equippedEffectId ?? null;

  const toggleAch = (key) => setAchSel((l) => (l.includes(key) ? l.filter((k) => k !== key) : l.length >= MAX_ACH ? l : [...l, key]));
  const toggleGame = (g) => setGameSel((l) => (l.some((x) => x.gameKey === g.gameKey)
    ? l.filter((x) => x.gameKey !== g.gameKey)
    : l.length >= SHOWCASE_MAX_GAMES ? l : [...l, { gameKey: g.gameKey, name: g.name, ...(g.steamAppId ? { steamAppId: String(g.steamAppId) } : {}), ...(g.iconUrl ? { iconUrl: g.iconUrl } : {}) }]));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const patch = {};
      // Só manda o que mudou.
      const oldAch = displayedAchievements.map((a) => a.key).join(',');
      if (achList && achSel.join(',') !== oldAch) {
        await setDisplayedAchievements('profile', achSel);
        const chosen = achList.filter((a) => achSel.includes(a.key)).sort((a, b) => achSel.indexOf(a.key) - achSel.indexOf(b.key));
        patch.displayedAchievements = chosen;
      }
      const oldGames = JSON.stringify(parseShowcase(user.profileShowcase).games);
      if (JSON.stringify(gameSel) !== oldGames) {
        const showcase = gameSel.length ? JSON.stringify({ games: gameSel }) : null;
        const { user: updated } = await updateProfile({ profileShowcase: showcase });
        patch.user = { ...updated, profileShowcase: showcase };
      }
      if (shop && decoSel !== undefined && decoSel !== (shop.equippedId ?? null)) {
        const r = await equipDecoration(decoSel);
        if (r?.user) patch.user = { ...(patch.user || {}), ...r.user };
      }
      if (shop && effectSel !== undefined && effectSel !== (shop.equippedEffectId ?? null)) {
        const r = await equipEffect(effectSel);
        if (r?.user) patch.user = { ...(patch.user || {}), ...r.user };
      }
      onSaved?.(patch);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.error || 'Não foi possível salvar a vitrine.');
    } finally {
      setSaving(false);
    }
  };

  const loadingBlock = <div className="pfv-loading" aria-label="Carregando"><span className="pf-sk" /><span className="pf-sk" /><span className="pf-sk" /></div>;

  return (
    <Modal title="Editar vitrine" onClose={onClose} width="720px" className="pfv-modal">
      <p className="pfv-intro">Escolha o que aparece em destaque no seu perfil completo.</p>
      <div className="pfv-tabs" role="tablist" aria-label="Partes da vitrine">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`pfv-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            <PfIcon name={t.icon} size={15} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'achievements' && (
        <section className="pfv-panel">
          <div className="pfv-panel-head"><strong>Conquistas em destaque</strong><span>{achSel.length}/{MAX_ACH}</span></div>
          {!achList ? loadingBlock : achList.length === 0 ? (
            <div className="pfv-empty"><PfIcon name="trophy" size={18} /> Você ainda não desbloqueou nenhuma conquista.</div>
          ) : (
            <div className="pfv-grid">
              {achList.map((a) => (
                <Picker key={a.key} selected={achSel.includes(a.key)} disabled={achSel.length >= MAX_ACH} onToggle={() => toggleAch(a.key)} title={a.description}>
                  <AchievementIcon achievement={a} size={32} className="pfv-ach-icon" />
                  <span className="pfv-pick-name">{a.name}</span>
                </Picker>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'games' && (
        <section className="pfv-panel">
          <div className="pfv-panel-head"><strong>Jogos em destaque</strong><span>{gameSel.length}/{SHOWCASE_MAX_GAMES}</span></div>
          <p className="pfv-note">Aparecem pra quem pode ver seu perfil completo, mesmo se a sua biblioteca estiver escondida.</p>
          {!library ? loadingBlock : library.length === 0 ? (
            <div className="pfv-empty"><PfIcon name="grid" size={18} /> Nenhum jogo na sua biblioteca ainda. Os jogos aparecem aqui depois que o app de computador detectar você jogando.</div>
          ) : (
            <div className="pfv-grid is-games">
              {library.map((g) => (
                <Picker key={g.gameKey} selected={gameSel.some((x) => x.gameKey === g.gameKey)} disabled={gameSel.length >= SHOWCASE_MAX_GAMES} onToggle={() => toggleGame(g)} title={g.name}>
                  <GameCapsule game={g} size="sm" />
                  <span className="pfv-pick-name">{g.name}</span>
                </Picker>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'decor' && (
        <section className="pfv-panel">
          {!shop ? loadingBlock : (
            <>
              <div className="pfv-panel-head"><strong>Moldura do avatar</strong></div>
              <div className="pfv-grid is-decor">
                <Picker selected={!curDeco} onToggle={() => setDecoSel(null)}>
                  <span className="pfv-none"><PfIcon name="close" size={18} /></span>
                  <span className="pfv-pick-name">Sem moldura</span>
                </Picker>
                {ownedDecos.map((d) => (
                  <Picker key={d.id} selected={curDeco === d.id} onToggle={() => setDecoSel(d.id)}>
                    <img className="pfv-decor-img" src={proxyImage(d.imageUrl)} alt="" />
                    <span className="pfv-pick-name">{d.name}</span>
                  </Picker>
                ))}
              </div>
              <div className="pfv-panel-head"><strong>Efeito do perfil</strong></div>
              <div className="pfv-grid is-decor">
                <Picker selected={!curEffect} onToggle={() => setEffectSel(null)}>
                  <span className="pfv-none"><PfIcon name="close" size={18} /></span>
                  <span className="pfv-pick-name">Sem efeito</span>
                </Picker>
                {ownedEffects.map((e) => (
                  <Picker key={e.id} selected={curEffect === e.id} onToggle={() => setEffectSel(e.id)}>
                    <img className="pfv-decor-img" src={proxyImage(e.imageUrl)} alt="" />
                    <span className="pfv-pick-name">{e.name}</span>
                  </Picker>
                ))}
              </div>
              {ownedDecos.length === 0 && ownedEffects.length === 0 && (
                <div className="pfv-empty"><PfIcon name="sparkle" size={18} /> Você ainda não tem molduras nem efeitos. Eles ficam na Loja.</div>
              )}
            </>
          )}
        </section>
      )}

      {error && <div className="pfv-error" role="alert"><PfIcon name="alert" size={14} /> {error}</div>}
      <div className="modal-actions pfv-actions">
        <button type="button" className="btn-link" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Salvando…' : 'Salvar vitrine'}</button>
      </div>
    </Modal>
  );
}
