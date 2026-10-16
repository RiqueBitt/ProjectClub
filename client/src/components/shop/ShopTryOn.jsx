import { useMemo, useState } from 'react';
import { Ico } from '../PagesKit.jsx';
import { MockProfile, decoValue, effectValue } from './ShopPreviews.jsx';
import { nameStyleProps } from '../../utils/nameStyle';

// Provador da Loja (igual ao "Painel de estilos de perfil" do Discord):
// combine moldura, efeito, estilo e fonte e veja no seu perfil antes de
// comprar. Mostra o que falta comprar e quanto custa tudo junto.
const KINDS = [['deco', 'Moldura'], ['effect', 'Efeito'], ['style', 'Estilo de perfil'], ['font', 'Fonte do nome']];
const styleKey = (i) => i?.data?.style || (i?.key || '').replace(/^style:/, '') || null;
const fontRaw = (i) => (i?.data?.family ? JSON.stringify({ id: i.id, family: i.data.family, url: i.data.url || null }) : null);
const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');

export default function ShopTryOn({ items, user, data, ctx }) {
  const equipped = useMemo(() => ({
    deco: items.find((i) => i.kind === 'deco' && i.id === data?.equippedId) || null,
    effect: items.find((i) => i.kind === 'effect' && i.id === data?.equippedEffectId) || null,
    style: items.find((i) => i.kind === 'style' && styleKey(i) === data?.equippedStyle) || null,
    font: items.find((i) => i.kind === 'font' && i.id === data?.equippedFontId) || null,
  }), [items, data]);
  const [pick, setPick] = useState(equipped);
  const [tab, setTab] = useState('deco');
  const [mode, setMode] = useState('full');

  const previewUser = { ...user, profileFont: pick.font ? fontRaw(pick.font) : null };
  const missing = Object.values(pick).filter((i) => i && !i.owned && !i.locked);
  const totalCoins = missing.reduce((s, i) => s + (i.pricing?.coins?.final ?? i.priceCoins ?? 0), 0);
  const allOwned = Object.values(pick).every((i) => !i || i.owned);
  const list = items.filter((i) => i.kind === tab && !i.locked);

  const useOwned = async () => {
    for (const k of ['deco', 'effect', 'style', 'font']) {
      const it = pick[k];
      const isOn = it && ctx.isEquipped(it);
      if (it && it.owned && !isOn) await ctx.equip(it, true);
    }
  };

  return (
    <div className="room-stack">
      <div className="room-page-head"><h1>Provador</h1><p>Combine itens e veja como fica no seu perfil antes de comprar. Nada muda até você usar.</p></div>
      <div className="tryon">
        <div className="tryon-stage">
          <div className="room-seg" role="tablist" aria-label="Prévia">
            {[['full', 'Perfil completo', 'monitor'], ['card', 'Mini perfil', 'frame']].map(([id, l, ic]) => (
              <button key={id} type="button" role="tab" aria-selected={mode === id} className={mode === id ? 'on' : ''} onClick={() => setMode(id)}><Ico name={ic} size={14} /> {l}</button>
            ))}
          </div>
          <div className={`tryon-preview m-${mode}`}>
            <MockProfile user={previewUser} size={mode} deco={pick.deco ? decoValue(pick.deco) : null} effect={pick.effect ? effectValue(pick.effect) : null} style={pick.style ? styleKey(pick.style) : null} wide={mode === 'full'} />
          </div>
          <div className="tryon-name" style={nameStyleProps(previewUser)}>{user?.displayName}</div>
          <div className="tryon-summary">
            {missing.length === 0 ? (
              <span>{allOwned ? 'Você já tem tudo desse visual.' : 'Escolha itens ao lado.'}</span>
            ) : (
              <span>Falta comprar {missing.length} {missing.length === 1 ? 'item' : 'itens'} · <b><Ico name="coin" size={13} /> {fmt(totalCoins)}</b></span>
            )}
            <div className="tryon-actions">
              {missing.map((i) => (
                <button key={`${i.kind}:${i.id}`} type="button" className="room-btn primary sm" onClick={() => ctx.open(i)}>Comprar {i.name}</button>
              ))}
              {Object.values(pick).some((i) => i?.owned) && <button type="button" className="room-btn ghost sm" onClick={useOwned}>Usar o que já tenho</button>}
              <button type="button" className="room-btn ghost sm" onClick={() => setPick(equipped)}>Voltar ao meu visual</button>
            </div>
          </div>
        </div>
        <div className="tryon-pick">
          <div className="room-chips" role="tablist">
            {KINDS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`room-chip${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{l}{pick[k] ? ' ✓' : ''}</button>)}
          </div>
          <div className="tryon-grid">
            <button type="button" className={`tryon-item${!pick[tab] ? ' on' : ''}`} onClick={() => setPick((p) => ({ ...p, [tab]: null }))}>
              <span className="tryon-item-art"><Ico name="close" size={20} /></span><span>Nenhum</span>
            </button>
            {list.map((i) => (
              <button key={i.id} type="button" className={`tryon-item${pick[tab]?.id === i.id ? ' on' : ''}`} onClick={() => setPick((p) => ({ ...p, [tab]: i }))} title={i.name}>
                <span className="tryon-item-art">
                  {i.kind === 'deco' || i.kind === 'effect' ? (i.imageUrl ? <img src={i.imageUrl} alt="" loading="lazy" /> : <Ico name="sparkles" size={20} />)
                    : i.kind === 'font' ? <span style={nameStyleProps({ ...user, profileFont: fontRaw(i) })}>Aa</span> : <Ico name="palette" size={20} />}
                </span>
                <span className="tryon-item-name">{i.name}</span>
                <small>{i.owned ? 'Você tem' : i.pricing?.coins?.final != null ? `${fmt(i.pricing.coins.final)} moedas` : i.priceGems != null ? `${fmt(i.priceGems)} gemas` : ''}</small>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
