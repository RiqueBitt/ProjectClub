import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import UserAvatar from '../UserAvatar.jsx';
import { Ico } from '../PagesKit.jsx';
import { MockProfile, decoValue, effectValue } from './ShopPreviews.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useStore } from '../../store/useStore';
import { getShop, equipDecoration, equipEffect, equipFont, equipStyle } from '../../api/decorations';
import { nameStyleProps } from '../../utils/nameStyle';
import '../../styles/profile-shop-items.css';

// Configurações → Perfil → "Itens da Loja": troca moldura, efeito, fonte
// do nome e estilo de perfil sem sair das configurações. Só mostra o que a
// pessoa já tem (comprado, ganhado ou liberado pelo apoio).
const TABS = [
  { id: 'style', label: 'Estilo de perfil', icon: 'palette', none: 'Visual padrão' },
  { id: 'deco', label: 'Moldura', icon: 'frame', none: 'Sem moldura' },
  { id: 'effect', label: 'Efeito', icon: 'sparkles', none: 'Sem efeito' },
  { id: 'font', label: 'Fonte do nome', icon: 'font', none: 'Fonte escolhida no perfil' },
];
const EQUIP = { deco: equipDecoration, effect: equipEffect, font: equipFont, style: equipStyle };
const styleKey = (i) => i?.data?.style || (i?.key || '').replace(/^style:/, '') || null;
const fontValue = (i) => (i?.data?.family ? JSON.stringify({ id: i.id, family: i.data.family, url: i.data.url || null }) : null);

export default function ProfileShopItems() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('style');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);

  const load = useCallback(() => getShop().then(setData).catch((e) => setMsg({ bad: true, text: e?.response?.data?.error || 'Não deu pra carregar seus itens.' })), []);
  useEffect(() => { load(); }, [load]);

  const owned = useMemo(() => {
    if (!data) return null;
    const pick = (list) => (list || []).filter((i) => i.owned);
    return { deco: pick(data.decorations), effect: pick(data.effects), font: pick(data.fonts), style: pick(data.styles) };
  }, [data]);

  const isOn = (kind, i) => {
    if (!data) return false;
    if (kind === 'deco') return i.id === data.equippedId;
    if (kind === 'effect') return i.id === data.equippedEffectId;
    if (kind === 'font') return i.id === data.equippedFontId;
    return !!data.equippedStyle && styleKey(i) === data.equippedStyle;
  };
  const noneOn = (kind) => (kind === 'deco' ? !data?.equippedId : kind === 'effect' ? !data?.equippedEffectId : kind === 'font' ? !data?.equippedFontId : !data?.equippedStyle);

  const equip = async (kind, item) => {
    setBusy(`${kind}:${item?.id || 'none'}`); setMsg(null);
    try {
      const r = await EQUIP[kind](item ? item.id : null);
      if (r?.user) {
        setUser((u) => ({ ...u, ...r.user }));
        useStore.getState().patchUserEverywhere?.(r.user);
      }
      setMsg({ text: item ? `"${item.name}" aplicado no seu perfil.` : 'Removido do perfil.' });
      await load();
    } catch (e) { setMsg({ bad: true, text: e?.response?.data?.error || 'Não deu certo.' }); }
    setBusy('');
  };

  const t = TABS.find((x) => x.id === tab);
  const list = owned?.[tab] || [];

  const preview = (kind, item) => {
    if (kind === 'style') return <MockProfile user={user} style={item ? styleKey(item) : null} size="card" />;
    if (kind === 'effect') return <MockProfile user={user} effect={item ? effectValue(item) : null} style={null} size="card" />;
    if (kind === 'deco') return <div className="psi-art-deco"><UserAvatar user={{ ...user, avatarDecoration: item ? decoValue(item) : null }} size={64} /></div>;
    return <div className="psi-art-font"><span style={nameStyleProps({ ...user, profileFont: item ? fontValue(item) : null })}>{user?.displayName || 'Seu nome'}</span></div>;
  };

  return (
    <div className="settings-block psi">
      <div className="psi-head">
        <div>
          <h3>Itens da Loja</h3>
          <p>Troque o estilo do perfil, a moldura, o efeito e a fonte do nome com o que você já tem.</p>
        </div>
        <button type="button" className="btn-secondary psi-store" onClick={() => { useStore.getState().closeSettings?.(); navigate('/loja'); }}>
          <Ico name="store" size={15} /> Ir pra Loja
        </button>
      </div>
      <div className="psi-tabs" role="tablist">
        {TABS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'on' : ''} onClick={() => setTab(x.id)}>
            <Ico name={x.icon} size={15} /> {x.label}{owned ? <em>{owned[x.id].length}</em> : null}
          </button>
        ))}
      </div>
      {msg && <div className={`psi-msg${msg.bad ? ' bad' : ''}`} role="status">{msg.text}</div>}
      {!owned ? <p className="dim">Carregando seus itens…</p> : (
        <div className="psi-grid">
          <button type="button" className={`psi-item${noneOn(tab) ? ' on' : ''}`} disabled={!!busy} onClick={() => !noneOn(tab) && equip(tab, null)}>
            <span className="psi-art">{preview(tab, null)}</span>
            <span className="psi-name">{t.none}</span>
            {noneOn(tab) && <span className="psi-check"><Ico name="check" size={12} strokeWidth={3} /></span>}
          </button>
          {list.map((i) => {
            const on = isOn(tab, i);
            return (
              <button key={i.id} type="button" className={`psi-item${on ? ' on' : ''}`} disabled={!!busy} onClick={() => !on && equip(tab, i)} title={i.description || i.name}>
                <span className="psi-art">{preview(tab, i)}</span>
                <span className="psi-name">{i.name}{i.serial ? <small> #{i.serial}</small> : null}</span>
                {on && <span className="psi-check"><Ico name="check" size={12} strokeWidth={3} /></span>}
                {busy === `${tab}:${i.id}` && <span className="psi-busy">Aplicando…</span>}
              </button>
            );
          })}
          {list.length === 0 && (
            <div className="psi-empty">
              <span>Você ainda não tem {t.label.toLowerCase()}.</span>
              <button type="button" className="btn-link" onClick={() => { useStore.getState().closeSettings?.(); navigate('/loja'); }}>Ver na Loja</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
