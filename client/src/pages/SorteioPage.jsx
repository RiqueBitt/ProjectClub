import { useCallback, useEffect, useState } from 'react';
import { getRaffle, buyRaffleTickets, errText } from '../api/community';
import HubTabs, { ECONOMY_HUB_TABS } from '../components/HubTabs.jsx';
import { EmptyState, Ico, PageHero, Skeleton, Unavailable } from '../components/PagesKit.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import { Countdown, SectionCard, fmt, useFlash } from '../components/community/CommunityBits.jsx';
import { useLiveRefresh } from '../utils/liveRefresh';
import '../styles/community4.css';

// Sorteio semanal: compra de bilhetes com moedas e resultado da semana
// passada. O sorteio acontece sozinho na virada da semana (segunda, horário
// de Brasília), no servidor, com aleatoriedade segura.
export default function SorteioPage() {
  const [data, setData] = useState(null);
  const [off, setOff] = useState(false);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [flash, show] = useFlash();

  const load = useCallback(() => getRaffle().then(setData).catch((e) => { if (e?.response?.status === 503) setOff(true); else setData((d) => d || { error: true }); }), []);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(() => load(), { interval: 30000 });

  if (off) return <Unavailable icon="gift" />;
  const r = data?.rules;
  const left = r ? Math.max(0, r.maxPerWeek - (data.myTickets || 0)) : 0;
  const maxNow = r ? Math.min(left, r.maxPerPurchase) : 1;
  const cost = r ? qty * r.ticketPrice : 0;

  const buy = async () => {
    setBusy(true);
    try {
      const res = await buyRaffleTickets(qty);
      show(`${res.bought} bilhete(s) comprado(s)! Boa sorte.`);
      setQty(1);
      await load();
    } catch (e) { show(errText(e), 'bad'); } finally { setBusy(false); }
  };

  return (
    <div className="pk-page c4-page">
      <HubTabs tabs={ECONOMY_HUB_TABS} value="sorteio" label="Economia e Loja" />
      <div className="pk-inner narrow">
        <PageHero
          icon="gift" eyebrow="Toda semana" title="Sorteio da semana"
          desc="Compre bilhetes com moedas. Na virada da semana um bilhete é sorteado e leva o prêmio acumulado."
          aside={data && !data.error ? (
            <div className="c4-prize">
              <small>Prêmio atual</small>
              <strong><Ico name="coin" size={22} /> {fmt(data.prize)}</strong>
              <Countdown to={data.endsAt} prefix="sorteio em" />
            </div>
          ) : null}
        />
        {!data && <Skeleton rows={2} height={120} />}
        {data?.error && <EmptyState icon="gift" title="Não deu pra carregar o sorteio" text="Tente de novo daqui a pouco." />}
        {data && !data.error && (
          <>
            <SectionCard icon="tag" title="Seus bilhetes">
              <div className="c4-stats">
                <div><strong>{fmt(data.myTickets)}</strong><small>seus bilhetes</small></div>
                <div><strong>{fmt(data.totalTickets)}</strong><small>bilhetes no total</small></div>
                <div><strong>{fmt(data.participants)}</strong><small>participantes</small></div>
                <div><strong>{data.myTickets ? `${(data.chance * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—'}</strong><small>sua chance</small></div>
              </div>
              {left > 0 ? (
                <div className="c4-buy">
                  <div className="c4-stepper" role="group" aria-label="Quantidade de bilhetes">
                    <button type="button" className="pk-btn icon sm" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} aria-label="Menos um"><Ico name="minus" size={16} /></button>
                    <output aria-live="polite">{qty}</output>
                    <button type="button" className="pk-btn icon sm" onClick={() => setQty((q) => Math.min(maxNow, q + 1))} disabled={qty >= maxNow} aria-label="Mais um"><Ico name="plus" size={16} /></button>
                  </div>
                  <button type="button" className="pk-btn primary" disabled={busy} onClick={buy}>
                    {busy ? 'Comprando…' : <>Comprar por <Ico name="coin" size={15} /> {fmt(cost)}</>}
                  </button>
                </div>
              ) : <p className="pk-muted">Você já tem o máximo de bilhetes desta semana ({r.maxPerWeek}). Boa sorte!</p>}
              <p className="c4-small">
                Cada bilhete custa {fmt(r.ticketPrice)} moedas, até {r.maxPerWeek} por semana. O prêmio é {fmt(r.basePrize)} moedas
                + {Math.round(r.potShare * 100)}% de tudo que foi gasto em bilhetes. Com menos de {r.minParticipants} participantes
                não tem sorteio e as moedas voltam pra todo mundo.
              </p>
            </SectionCard>
            <SectionCard icon="trophy" title="Semana passada">
              {data.lastWinner ? (
                <div className="c4-list-row">
                  <UserAvatar user={data.lastWinner.user} size={40} />
                  <div className="c4-list-main">
                    <strong>{data.lastWinner.user?.displayName || 'Alguém'}</strong>
                    <small>Levou {fmt(data.lastWinner.prize)} moedas entre {fmt(data.lastWinner.tickets)} bilhetes de {data.lastWinner.participants} pessoas.</small>
                  </div>
                  <span className="pk-chip green"><Ico name="trophy" size={13} /> Ganhou</span>
                </div>
              ) : (
                <p className="pk-muted">{data.lastDraw?.refunded ? 'Faltou gente na semana passada — as moedas foram devolvidas.' : 'Ainda não teve sorteio. Que tal ser o primeiro a ganhar?'}</p>
              )}
            </SectionCard>
          </>
        )}
      </div>
      {flash}
    </div>
  );
}
