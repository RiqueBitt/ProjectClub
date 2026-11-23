import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import UserAvatar from '../UserAvatar.jsx';
import { Ico } from '../PagesKit.jsx';
import { MockProfile, decoValue, effectValue } from '../shop/ShopPreviews.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useStore } from '../../store/useStore';
import { getShop, equipDecoration, equipEffect, equipFont, equipStyle } from '../../api/decorations';
import { NAME_FONTS, FONT_FAMILY, nameStyleProps, nameStyleClassName } from '../../utils/nameStyle';

// Editor de perfil: os itens da Loja (moldura, estilo, efeito, fonte) entram
// direto nas seções do editor — sem a antiga caixa "Itens da Loja". Só lista
// o que a pessoa já tem (comprado, ganhado ou liberado pelo apoio).
const EQUIP = { deco: equipDecoration, effect: equipEffect, font: equipFont, style: equipStyle };
const NONE = { deco: 'Sem moldura', effect: 'Sem efeito', style: 'Visual padrão' };
export const styleKey = (i) => i?.data?.style || (i?.key || '').replace(/^style:/, '') || null;
export const fontValue = (i) => (i?.data?.family ? JSON.stringify({ id: i.id, family: i.data.family, url: i.data.url || null }) : null);

/** Itens da Loja que a pessoa tem + equipar. Um só por editor (passa pros pickers). */
export function useOwnedShop(enabled = true) {
  const { setUser } = useAuth();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const load = useCallback(() => getShop().then(setData).catch((e) => setMsg({ bad: true, text: e?.response?.data?.error || 'Não deu pra carregar seus itens da Loja.' })), []);
  useEffect(() => { if (enabled) load(); }, [load, enabled]);
  const owned = useMemo(() => {
    if (!data) return null;
    const pick = (list) => (list || []).filter((i) => i.owned);
    return { deco: pick(data.decorations), effect: pick(data.effects), font: pick(data.fonts), style: pick(data.styles) };
  }, [data]);
  const equippedId = (kind) => (kind === 'deco' ? data?.equippedId : kind === 'effect' ? data?.equippedEffectId : kind === 'font' ? data?.equippedFontId : null);
  const isOn = (kind, item) => {
    if (!data) return false;
    if (kind === 'style') return item ? !!data.equippedStyle && styleKey(item) === data.equippedStyle : !data.equippedStyle;
    return item ? item.id === equippedId(kind) : !equippedId(kind);
  };
  const equip = async (kind, item) => {
    setBusy(`${kind}:${item?.id || 'none'}`); setMsg(null);
    try {
      const r = await EQUIP[kind](item ? item.id : null);
      if (r?.user) {
        setUser((u) => ({ ...u, ...r.user }));
        useStore.getState().patchUserEverywhere?.(r.user);
      }
      await load();
    } catch (e) { setMsg({ bad: true, text: e?.response?.data?.error || 'Não deu certo.' }); }
    setBusy('');
  };
  return { data, owned, busy, msg, isOn, equip };
}

function GoShop({ label = 'Mais na Loja' }) {
  const navigate = useNavigate();
  return (
    <button type="button" className="pe-tile pe-tile-shop" onClick={() => { useStore.getState().closeProfileEditor?.(); navigate('/loja'); }}>
      <span className="pe-tile-art"><Ico name="store" size={22} /></span>
      <span className="pe-tile-name">{label}</span>
    </button>
  );
}

/** Grade de cartões: "nenhum" + os itens da Loja que a pessoa tem + atalho pra Loja. */
export function ShopTileGrid({ kind, shop, user }) {
  const list = shop.owned?.[kind] || [];
  const art = (item) => {
    if (kind === 'style') return <MockProfile user={user} style={item ? styleKey(item) : null} size="card" />;
    if (kind === 'effect') return <MockProfile user={user} effect={item ? effectValue(item) : null} style={null} size="card" />;
    return <span className="pe-tile-deco"><UserAvatar user={{ ...user, avatarDecoration: item ? decoValue(item) : null }} size={52} /></span>;
  };
  if (!shop.owned) return <p className="dim pe-loading">Carregando seus itens…</p>;
  const tile = (item) => {
    const on = shop.isOn(kind, item);
    const id = item?.id || 'none';
    return (
      <button
        key={id} type="button" className={`pe-tile pe-tile-${kind}${on ? ' is-on' : ''}`} disabled={!!shop.busy}
        aria-pressed={on} title={item ? (item.description || item.name) : NONE[kind]}
        onClick={() => !on && shop.equip(kind, item)}
      >
        <span className="pe-tile-art">{art(item)}</span>
        <span className="pe-tile-name">{item ? item.name : NONE[kind]}{item?.serial ? <small> #{item.serial}</small> : null}</span>
        {on && <span className="pe-tile-check" aria-hidden="true"><Ico name="check" size={11} strokeWidth={3} /></span>}
        {shop.busy === `${kind}:${id}` && <span className="pe-tile-busy">Aplicando…</span>}
      </button>
    );
  };
  return (
    <div className={`pe-tiles pe-tiles-${kind}`}>
      {tile(null)}
      {list.map(tile)}
      <GoShop />
    </div>
  );
}

/**
 * Fonte do nome: as fontes padrão e as compradas na Loja numa lista só.
 * Padrão = campo profileNameFont (salva com o resto do perfil); comprada =
 * equipar na Loja (profileFont, que tem prioridade). Escolher uma padrão
 * tira a comprada.
 */
export function NameFontGrid({ form, setForm, shop, user }) {
  const shopFonts = shop.owned?.font || [];
  const shopOn = !!shop.data?.equippedFontId;
  const sample = form.displayName || user?.displayName || 'Abc';
  const base = { ...form, profileFont: null };
  return (
    <div className="pe-font-grid" role="radiogroup" aria-label="Fonte do nome">
      {NAME_FONTS.map((f) => {
        const on = !shopOn && form.profileNameFont === f.value;
        const u = { ...base, profileNameFont: f.value };
        return (
          <button
            key={f.value} type="button" role="radio" aria-checked={on} className={`pe-font${on ? ' is-on' : ''}`} disabled={!!shop.busy}
            onClick={() => { setForm((s) => ({ ...s, profileNameFont: f.value })); if (shopOn) shop.equip('font', null); }}
          >
            <span className={`pe-font-sample ${nameStyleClassName(u, { fullEffect: true })}`} style={{ ...nameStyleProps(u, { fullEffect: true }), fontFamily: FONT_FAMILY[f.value] }}>{sample}</span>
            <span className="pe-font-label">{f.label}</span>
          </button>
        );
      })}
      {shopFonts.map((i) => {
        const on = shop.data?.equippedFontId === i.id;
        const u = { ...form, profileFont: fontValue(i) };
        return (
          <button
            key={i.id} type="button" role="radio" aria-checked={on} className={`pe-font is-shop${on ? ' is-on' : ''}`} disabled={!!shop.busy}
            onClick={() => !on && shop.equip('font', i)} title={i.description || i.name}
          >
            <span className={`pe-font-sample ${nameStyleClassName(u, { fullEffect: true })}`} style={nameStyleProps(u, { fullEffect: true })}>{sample}</span>
            <span className="pe-font-label">{i.name}</span>
          </button>
        );
      })}
    </div>
  );
}
