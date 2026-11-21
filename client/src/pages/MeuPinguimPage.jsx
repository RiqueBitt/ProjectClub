import { useEffect, useRef, useState } from 'react';
import { PageHero, Skeleton, Toast, Price, EmptyState } from '../components/PagesKit.jsx';
import PetPenguinSvg, { PET_MOODS } from '../components/pet/PetPenguinSvg.jsx';
import { invalidatePetCache } from '../components/pet/ProfilePet.jsx';
import { PENGUIN_COLORS } from '../components/PenguinAvatar.jsx';
import { getMyPet, getPetCatalog, careForPet, updateMyPet, buyPetAccessory, equipPetAccessory } from '../api/fase8';
import { useAuth } from '../context/AuthContext.jsx';
import '../styles/pages-kit.css';
import '../styles/fase8.css';

// Página "Meu pinguim" (Fase 8): cuidar todo dia, trocar nome/cor e
// comprar/equipar acessórios. Regras no servidor (services/pet.js).

const COLOR_NAMES = { blue: 'Azul', red: 'Vermelho', green: 'Verde', yellow: 'Amarelo', pink: 'Rosa', purple: 'Roxo', orange: 'Laranja', black: 'Preto' };
const SLOT_NAMES = { cabeca: 'Cabeça', rosto: 'Rosto', pescoco: 'Pescoço', mao: 'Na mão' };

export default function MeuPinguimPage() {
  const { user } = useAuth();
  const [pet, setPet] = useState(null);
  const [coins, setCoins] = useState(0);
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [hop, setHop] = useState(0);
  const [preview, setPreview] = useState(null); // acessório em "provador"

  const toastTimer = useRef(0);
  const flash = (msg) => { setToast(msg); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(''), 3200); };
  const apply = (r) => { setPet(r.pet); setCoins(r.coins ?? 0); invalidatePetCache(user?.id); };

  useEffect(() => {
    Promise.all([getMyPet(), getPetCatalog()])
      .then(([p, c]) => { apply(p); setCatalog(c); setNameDraft(p.pet.name); })
      .catch(() => setError('Não foi possível carregar o seu pinguim agora.'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      const r = await fn();
      apply(r);
      if (okMsg) flash(typeof okMsg === 'function' ? okMsg(r) : okMsg);
      return r;
    } catch (err) {
      flash(err?.response?.data?.error || 'Algo deu errado. Tente de novo.');
      return null;
    } finally { setBusy(false); }
  };

  const care = () => run(careForPet, (r) => {
    setHop((h) => h + 1);
    if (r.evolved) return `${r.pet.name} evoluiu para ${r.pet.stageLabel}! 🎉`;
    return `+${r.gained.petXp} pontos pro pinguim e +${r.gained.accountXp} XP pra você${r.gained.streak > 1 ? ` · ${r.gained.streak} dias seguidos!` : ''}`;
  });

  if (error) return <div className="pk-page"><div className="pk-inner"><EmptyState icon="question" title="Ops" text={error} /></div></div>;
  if (!pet || !catalog) return <div className="pk-page"><div className="pk-inner"><Skeleton rows={4} height={90} /></div></div>;

  const equippedView = preview ? { ...pet.equipped, [preview.slot]: preview.id } : pet.equipped;

  return (
    <div className="pk-page">
      <div className="pk-inner">
        <PageHero icon="heart" eyebrow="Mascote" title="Meu pinguim" desc="Cuide dele todo dia: ele cresce com a sua participação no clube (nível da conta, cuidados e sequência de dias)." aside={<Price value={coins} />} />
        <Toast>{toast}</Toast>
        <div className="pet-page-grid">
          <aside className="pet-stage-panel" aria-label="Seu pinguim">
            <div key={hop} className={hop ? 'pet-hop' : ''}>
              <PetPenguinSvg size={200} color={pet.color} stage={pet.stage} mood={pet.mood} equipped={equippedView} title={pet.name} />
            </div>
            <h2>{pet.name}</h2>
            <span className={`pet-stage-chip${pet.stage >= 3 ? ' is-legend' : ''}`}>{pet.stageLabel}</span>
            <span className="pet-mood">Humor: {PET_MOODS[pet.mood] || 'Tranquilo'}</span>
            {pet.next ? (
              <div className="pet-progress">
                <div className="pet-progress-label"><span>Rumo a {pet.next.label}</span><span>faltam {pet.next.missing}</span></div>
                <div className="pet-progress-track"><span style={{ width: `${pet.next.progress}%` }} /></div>
              </div>
            ) : <span className="pet-mood">Estágio máximo alcançado. Lendário! ✨</span>}
            <div className="pet-stats">
              <div><b>{pet.streak}</b><span>Sequência</span></div>
              <div><b>{pet.bestStreak}</b><span>Recorde</span></div>
              <div><b>{pet.careCount}</b><span>Cuidados</span></div>
            </div>
            <button type="button" className="pet-care-btn" disabled={busy || pet.caredToday} onClick={care}>
              {pet.caredToday ? 'Já cuidou hoje — volte amanhã 💙' : 'Cuidar do pinguim'}
            </button>
          </aside>

          <div>
            <section className="pet-section">
              <h3>Evolução</h3>
              <div className="pet-stage-road">
                {catalog.stages.map((s) => (
                  <div key={s.key} className={pet.stage >= s.index ? 'reached' : ''}>
                    <PetPenguinSvg size={48} color={pet.color} stage={s.index} animated={false} mood="feliz" />
                    <strong>{s.label}</strong>
                    <span>{s.minScore} pts</span>
                  </div>
                ))}
              </div>
              <p className="pet-mood" style={{ marginTop: 10 }}>Pontos = cuidados ({pet.xp}) + nível da conta × 20. Total: <b>{pet.score}</b>. O pinguim nunca volta de estágio.</p>
            </section>

            <section className="pet-section">
              <h3>Nome e cor</h3>
              <div className="pet-name-row">
                <input value={nameDraft} maxLength={20} onChange={(e) => setNameDraft(e.target.value)} aria-label="Nome do pinguim" placeholder="Nome do pinguim" />
                <button type="button" className="pet-btn primary" disabled={busy || nameDraft.trim() === pet.name} onClick={() => run(() => updateMyPet({ name: nameDraft }), 'Nome salvo!')}>Salvar nome</button>
              </div>
              <div className="pet-colors" style={{ marginTop: 12 }} role="radiogroup" aria-label="Cor do pinguim">
                {catalog.colors.map((c) => (
                  <button
                    key={c} type="button" role="radio" aria-checked={pet.color === c} title={COLOR_NAMES[c] || c} aria-label={COLOR_NAMES[c] || c}
                    className={`pet-color${pet.color === c ? ' active' : ''}`} style={{ background: PENGUIN_COLORS[c] }}
                    disabled={busy} onClick={() => pet.color !== c && run(() => updateMyPet({ color: c }))}
                  />
                ))}
              </div>
            </section>

            {catalog.slots.map((slot) => (
              <section key={slot} className="pet-section">
                <h3>{SLOT_NAMES[slot] || slot}</h3>
                <div className="pet-acc-grid">
                  {catalog.accessories.filter((a) => a.slot === slot).map((a) => {
                    const owned = pet.owned.includes(a.id);
                    const equipped = pet.equipped[slot] === a.id;
                    const locked = pet.stage < a.minStage;
                    return (
                      <div
                        key={a.id} className={`pet-acc${equipped ? ' is-equipped' : ''}${locked ? ' is-locked' : ''}`}
                        onMouseEnter={() => setPreview({ slot, id: a.id })} onMouseLeave={() => setPreview(null)}
                      >
                        <PetPenguinSvg size={64} color={pet.color} stage={Math.max(pet.stage, 2)} animated={false} mood="feliz" equipped={{ [slot]: a.id }} />
                        <span>{a.name}</span>
                        {locked && <small>A partir de {catalog.stages[a.minStage].label}</small>}
                        {!owned ? (
                          <button type="button" className="pet-btn primary" disabled={busy || coins < a.price} onClick={() => run(() => buyPetAccessory(a.id), `${a.name} comprado!`)}>
                            Comprar · {a.price} 🪙
                          </button>
                        ) : equipped ? (
                          <button type="button" className="pet-btn" disabled={busy} onClick={() => run(() => equipPetAccessory(slot, null))}>Tirar</button>
                        ) : (
                          <button type="button" className="pet-btn" disabled={busy || locked} onClick={() => run(() => equipPetAccessory(slot, a.id))}>Usar</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
