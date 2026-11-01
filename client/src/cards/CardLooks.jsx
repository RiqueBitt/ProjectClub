import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CardBack, Icon, UI } from './CardView.jsx';
import { cardsCosmetics, cardsEquipCosmetic, errMsg } from './api';

// "Sua aparência" na Coleção: versos que você tem (comprados na Loja →
// Versos de Cartas) e molduras do herói que já eram suas — tudo salvo na
// conta, é só escolher o que usar nas partidas. Molduras do herói não são
// mais vendidas; quem comprou continua usando normalmente.
export default function CardLooks() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  useEffect(() => { cardsCosmetics().then(setData).catch(() => setData(null)); }, []);
  if (!data) return null;
  const backs = data.items.filter((i) => i.kind === 'BACK' && i.owned);
  const frames = data.items.filter((i) => i.kind === 'FRAME' && i.owned);
  const use = async (i) => {
    setBusy(i.key); setMsg(null);
    try { setData(await cardsEquipCosmetic(i.key)); setMsg({ ok: true, text: `${i.name} em uso nas suas partidas.` }); } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
    setBusy('');
  };
  return (
    <section className="tcg-looks" aria-label="Sua aparência nas partidas">
      <div className="tcg-looks-head">
        <h3 className="tcg-h3">Sua aparência</h3>
        <button type="button" className="tcg-btn tcg-btn-sm tcg-hero-shop" onClick={() => navigate('/loja?cat=versos')}><Icon d={UI.pack} size={14} />Mais versos na Loja</button>
      </div>
      {msg && <p className={msg.ok ? 'tcg-ok' : 'tcg-error'}>{msg.text}</p>}
      <div className="tcg-looks-row" role="list" aria-label="Versos de carta">
        {backs.map((i) => {
          const on = data.equipped.back === i.key;
          return (
            <button key={i.id} type="button" role="listitem" className={`tcg-look${on ? ' is-on' : ''}`} disabled={on || !!busy} onClick={() => use(i)} title={on ? `${i.name} (em uso)` : `Usar ${i.name}`}>
              <span className="tcg-look-prev"><CardBack variant={i.key} /></span>
              <b>{i.name}</b>
              <small>{on ? 'Em uso' : busy === i.key ? 'Aplicando…' : 'Usar'}</small>
            </button>
          );
        })}
      </div>
      {frames.length > 1 && (
        <>
          <p className="tcg-dim tcg-looks-sub">Molduras do herói que já são suas</p>
          <div className="tcg-looks-row" role="list" aria-label="Molduras do herói">
            {frames.map((i) => {
              const on = data.equipped.frame === i.key;
              return (
                <button key={i.id} type="button" role="listitem" className={`tcg-look is-frame${on ? ' is-on' : ''}`} disabled={on || !!busy} onClick={() => use(i)}>
                  <span className="tcg-look-prev"><span className={`tcgpass-frame f-${i.key.replace('frame:', '')}`}><span /></span></span>
                  <b>{i.name}</b>
                  <small>{on ? 'Em uso' : 'Usar'}</small>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
