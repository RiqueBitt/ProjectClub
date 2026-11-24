import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ico } from '../components/PagesKit.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { getShop } from '../api/decorations';
import { PLANS, COMPARE, TIER_NAME } from '../utils/subscriptionPlans';
import '../styles/assinatura.css';

// Assinatura (estilo da página do Nitro do Discord): abertura, os planos,
// o que cada vantagem faz, a tabela comparando e as perguntas frequentes.
// Fica nos canais em destaque (no topo). Antes era uma aba da Loja.
const HIGHLIGHTS = [
  { icon: 'tag', title: 'Desconto em toda a Loja', text: '10% ou 20% de desconto em todos os itens, aplicado sozinho na hora de comprar.' },
  { icon: 'bolt', title: 'Suba de nível mais rápido', text: 'Bônus de XP em tudo que dá XP: mensagens, calls, missões e eventos.' },
  { icon: 'trophy', title: 'Passe do clube', text: 'A temporada do passe com recompensas a cada nível, só para quem assina.' },
  { icon: 'store', title: 'Loja exclusiva', text: 'Itens que não são vendidos: ficam liberados enquanto você assina.' },
  { icon: 'sticker', title: 'Figurinhas personalizadas', text: 'Suas próprias figurinhas para usar no chat: 5 ou 15, conforme o plano.' },
  { icon: 'crown', title: 'Insígnia, decoração e destaque', text: 'Insígnia e decoração de avatar exclusivas e destaque na lista de membros.' },
];

const FAQ = [
  ['Como eu assino?', 'Clique em "Assinar" no plano que quiser. O pagamento é por Pix, pelo LivePix. Depois de pagar, a equipe libera as vantagens na sua conta.'],
  ['Quanto tempo vale?', 'Um mês por pagamento. Para continuar, é só pagar de novo no mês seguinte (o botão vira "Renovar"). Não tem cobrança automática.'],
  ['Posso trocar de plano?', 'Pode. Pague o outro plano e avise a equipe: as vantagens passam a ser as do plano novo.'],
  ['Gemas servem para assinar?', 'Não. Gemas são a moeda da plataforma e servem para a Loja. A assinatura é paga só por Pix.'],
  ['O que continua grátis?', 'Toda a personalização básica: cores, fontes padrão, banner, bio, status e o resto do perfil. A assinatura é um extra para quem quer apoiar.'],
];

function Cell({ v }) {
  if (v === true) return <span className="sub-yes" aria-label="Sim"><Ico name="check" size={16} strokeWidth={2.8} /></span>;
  if (v === false) return <span className="sub-no" aria-label="Não">—</span>;
  return <span className="sub-val">{v}</span>;
}

export default function AssinaturaPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [supporter, setSupporter] = useState(null);
  const [open, setOpen] = useState(0);
  const plansRef = useRef(null);
  useEffect(() => { getShop().then((d) => setSupporter(d?.supporter || { tier: 'NONE' })).catch(() => setSupporter({ tier: 'NONE' })); }, []);
  const tier = supporter?.tier || 'NONE';
  const subscribed = tier !== 'NONE';

  return (
    <div className="sub-page">
      <section className="sub-hero">
        <div className="sub-hero-glow" aria-hidden="true" />
        <div className="sub-hero-inner">
          <span className="sub-hero-crown" aria-hidden="true"><Ico name="crown" size={34} strokeWidth={2} /></span>
          <h1>Desbloqueie mais com a <span>Assinatura</span></h1>
          <p>Apoie o Project Club e ganhe desconto na Loja, mais XP, o passe do clube, a loja exclusiva e um visual que ninguém mais tem.</p>
          {subscribed ? (
            <p className="sub-hero-mine"><Ico name="crown" size={15} strokeWidth={2.4} /> Você é <strong>{TIER_NAME[tier]}</strong>{user?.displayName ? `, ${user.displayName}` : ''}. Obrigado por apoiar!</p>
          ) : null}
          <div className="sub-hero-ctas">
            <button type="button" className="sub-btn sub-btn-gold" onClick={() => plansRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Ver planos</button>
            <button type="button" className="sub-btn sub-btn-ghost" onClick={() => navigate('/loja')}>Ir para a Loja</button>
          </div>
        </div>
      </section>

      <section className="sub-plans" ref={plansRef} aria-label="Planos">
        {PLANS.map((p) => {
          const mine = tier === p.id;
          return (
            <article key={p.id} className={`sub-plan t-${p.id.toLowerCase()}${mine ? ' is-mine' : ''}${p.best ? ' is-best' : ''}`}>
              {p.best && <span className="sub-plan-ribbon">Mais vantagens</span>}
              <header>
                <span className="sub-plan-ico"><Ico name="crown" size={22} strokeWidth={2.2} /></span>
                <div>
                  <h2>{p.name}</h2>
                  <p className="sub-plan-tag">{p.tagline}</p>
                </div>
                {mine && <span className="sub-plan-mine">Seu plano</span>}
              </header>
              <p className="sub-plan-price"><b>R$ {p.price}</b><small>/mês</small></p>
              {p.note && <p className="sub-plan-note">{p.note}</p>}
              <ul>
                {p.perks.map((perk) => (
                  <li key={Array.isArray(perk) ? perk.join('') : perk}>
                    <Ico name="check" size={15} strokeWidth={2.8} />
                    <span>{Array.isArray(perk) ? <>{perk[0]}<strong>{perk[1]}</strong></> : perk}</span>
                  </li>
                ))}
              </ul>
              <a className="sub-btn sub-plan-cta" href={p.url} target="_blank" rel="noopener noreferrer">
                {mine ? 'Renovar' : 'Assinar'} {p.name}
              </a>
            </article>
          );
        })}
      </section>

      <section className="sub-section">
        <h2 className="sub-h2">O que você ganha</h2>
        <div className="sub-highlights">
          {HIGHLIGHTS.map((h) => (
            <div key={h.title} className="sub-highlight">
              <span className="sub-highlight-ico"><Ico name={h.icon} size={22} strokeWidth={2} /></span>
              <h3>{h.title}</h3>
              <p>{h.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="sub-section">
        <h2 className="sub-h2">Compare os planos</h2>
        <div className="sub-table-wrap">
          <table className="sub-table">
            <thead>
              <tr>
                <th scope="col">Vantagem</th>
                <th scope="col" className={tier === 'NONE' ? 'is-mine' : ''}>Grátis</th>
                <th scope="col" className={`t-subscriber${tier === 'SUBSCRIBER' ? ' is-mine' : ''}`}>Assinante</th>
                <th scope="col" className={`t-super${tier === 'SUPER' ? ' is-mine' : ''}`}>Super Assinante</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map(([label, a, b, c]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td><Cell v={a} /></td>
                  <td><Cell v={b} /></td>
                  <td><Cell v={c} /></td>
                </tr>
              ))}
              <tr className="sub-table-price">
                <th scope="row">Preço</th>
                <td>R$ 0</td>
                <td>R$ {PLANS[0].price}/mês</td>
                <td>R$ {PLANS[1].price}/mês</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="sub-section sub-faq-wrap">
        <h2 className="sub-h2">Perguntas frequentes</h2>
        <div className="sub-faq">
          {FAQ.map(([q, a], i) => (
            <div key={q} className={`sub-faq-item${open === i ? ' is-open' : ''}`}>
              <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>
                <span>{q}</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
              </button>
              {open === i && <p>{a}</p>}
            </div>
          ))}
        </div>
      </section>

      <section className="sub-final">
        <h2>Pronto para apoiar?</h2>
        <p>Escolha um plano: o pagamento é por Pix e as vantagens chegam na sua conta.</p>
        <div className="sub-hero-ctas">
          {PLANS.map((p) => (
            <a key={p.id} className={`sub-btn ${p.best ? 'sub-btn-gold' : 'sub-btn-ghost'}`} href={p.url} target="_blank" rel="noopener noreferrer">{tier === p.id ? 'Renovar' : 'Assinar'} {p.name}</a>
          ))}
        </div>
      </section>
    </div>
  );
}
