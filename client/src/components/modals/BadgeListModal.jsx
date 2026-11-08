import { useMemo, useState } from 'react';
import Modal from '../Modal.jsx';
import { BADGE_RARITIES, RARITY_LABEL, RARITY_COLOR } from '../../utils/badgeRarity';
import BadgeIcon from '../BadgeIcon.jsx';
import '../../styles/badges.css';

function formatAwardedAt(dateStr, long = false) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const label = d.toLocaleDateString('pt-BR', long ? { day: '2-digit', month: 'long', year: 'numeric' } : { month: 'short', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Como a insígnia é conseguida — só o que dá pra saber com certeza pelos
// dados (ver authController NEWCOMER, adminController STAFF, ageBadges).
function howObtained(b) {
  if (b.key === 'NEWCOMER') return 'Ganha ao criar a conta.';
  if (b.key === 'STAFF') return 'Automática pra quem faz parte da equipe.';
  if (b.ageYears) return `Tempo de conta: ${b.ageYears} ${b.ageYears === 1 ? 'ano' : 'anos'} no Project Club.`;
  return 'Concedida pela equipe do Project Club.';
}

const rarityOf = (b) => (BADGE_RARITIES.includes(b?.rarity) ? b.rarity : 'COMMON');
const rarityColor = (b) => RARITY_COLOR[rarityOf(b)];
const RARITY_RANK = { COMMON: 0, RARE: 1, EPIC: 2, LEGENDARY: 3 };

// Ícones de traço locais.
const B_ICONS = {
  medal: 'M8 3h8l-2 6h-4zM12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 12.5l1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3z',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  sparkle: 'M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8v.01',
  sort: 'M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3',
};
function BIcon({ name, size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={B_ICONS[name]} /></svg>
  );
}

function BadgeArt({ badge, size }) {
  return <BadgeIcon badge={badge} size={size} />;
}

// Abre ao clicar em qualquer insígnia do perfil (UserProfileModal.jsx) —
// mostra TODAS as insígnias da pessoa: grade com cor por raridade,
// filtro, contagem por raridade e um painel com os detalhes da escolhida.
export default function BadgeListModal({ userName, badges = [], onClose, initialId }) {
  const [filter, setFilter] = useState('ALL'); // ALL | RARE_UP | COMMON | RARE | EPIC | LEGENDARY
  const [sort, setSort] = useState('rarity'); // rarity | recent
  const [selectedId, setSelectedId] = useState(initialId ?? null);

  const counts = useMemo(() => {
    const c = { ALL: badges.length, RARE_UP: 0 };
    BADGE_RARITIES.forEach((r) => { c[r] = 0; });
    badges.forEach((b) => { const r = rarityOf(b); c[r] += 1; if (r !== 'COMMON') c.RARE_UP += 1; });
    return c;
  }, [badges]);

  const shown = useMemo(() => {
    const list = badges.filter((b) => {
      if (filter === 'ALL') return true;
      if (filter === 'RARE_UP') return rarityOf(b) !== 'COMMON';
      return rarityOf(b) === filter;
    });
    const time = (b) => (b.awardedAt ? new Date(b.awardedAt).getTime() || 0 : 0);
    return [...list].sort((a, b) => (sort === 'recent'
      ? time(b) - time(a)
      : RARITY_RANK[rarityOf(b)] - RARITY_RANK[rarityOf(a)] || time(b) - time(a)));
  }, [badges, filter, sort]);

  const selected = shown.find((b) => b.id === selectedId) || shown[0] || null;

  const FILTERS = [
    ['ALL', 'Todas'],
    ['RARE_UP', 'Raras ou melhores'],
    ...BADGE_RARITIES.map((r) => [r, RARITY_LABEL[r]]),
  ].filter(([k]) => k === 'ALL' || counts[k] > 0);

  return (
    <Modal title="" onClose={onClose} width="860px" className="bdg-modal-box">
      <div className="bdg">
        <header className="bdg-head">
          <span className="bdg-head-icon"><BIcon name="medal" size={20} /></span>
          <div className="bdg-head-text">
            <h2>Insígnias de {userName}</h2>
            <p>{badges.length === 1 ? '1 insígnia' : `${badges.length} insígnias`}</p>
          </div>
          {badges.length > 0 && (
            <div className="bdg-rarity-bar" aria-label="Insígnias por raridade">
              {BADGE_RARITIES.map((r) => counts[r] > 0 && (
                <span key={r} className="bdg-rarity-count" style={{ '--rc': RARITY_COLOR[r] }} title={RARITY_LABEL[r]}>
                  <i /> {counts[r]} <span>{RARITY_LABEL[r]}</span>
                </span>
              ))}
            </div>
          )}
        </header>

        {badges.length === 0 ? (
          <div className="bdg-empty">
            <span className="bdg-empty-icon"><BIcon name="medal" size={22} /></span>
            <strong>Nenhuma insígnia ainda</strong>
            <span>Quando {userName} ganhar uma insígnia, ela aparece aqui.</span>
          </div>
        ) : (
          <>
            <div className="bdg-toolbar">
              <div className="bdg-filters" role="tablist" aria-label="Filtrar por raridade">
                {FILTERS.map(([k, label]) => (
                  <button
                    key={k} type="button" role="tab" aria-selected={filter === k}
                    className={`bdg-filter ${filter === k ? 'active' : ''}`}
                    style={RARITY_COLOR[k] ? { '--rc': RARITY_COLOR[k] } : undefined}
                    onClick={() => setFilter(k)}
                  >
                    {RARITY_COLOR[k] && <i aria-hidden="true" />}
                    {label} <b>{counts[k]}</b>
                  </button>
                ))}
              </div>
              <button type="button" className="bdg-sort" onClick={() => setSort((v) => (v === 'rarity' ? 'recent' : 'rarity'))} title="Mudar a ordem">
                <BIcon name="sort" size={14} /> {sort === 'rarity' ? 'Mais raras primeiro' : 'Mais recentes primeiro'}
              </button>
            </div>

            <div className="bdg-body">
              <div className="bdg-grid" role="listbox" aria-label="Insígnias">
                {shown.map((b) => {
                  const date = formatAwardedAt(b.awardedAt);
                  return (
                    <button
                      key={b.id} type="button" role="option" aria-selected={selected?.id === b.id}
                      className={`bdg-tile rarity-${rarityOf(b).toLowerCase()} ${selected?.id === b.id ? 'is-selected' : ''}`}
                      style={{ '--rc': rarityColor(b) }}
                      onClick={() => setSelectedId(b.id)}
                    >
                      <span className="bdg-tile-art"><BadgeArt badge={b} size={44} /></span>
                      <span className="bdg-tile-name">{b.name}</span>
                      <span className="bdg-tile-rarity">{RARITY_LABEL[rarityOf(b)]}</span>
                      {/* Dica ao passar o mouse (no celular o painel abaixo já mostra tudo). */}
                      <span className="bdg-tip" role="tooltip">
                        <strong>{b.name}</strong>
                        <span>{b.description || howObtained(b)}</span>
                        {date && <em>Desde {date}</em>}
                      </span>
                    </button>
                  );
                })}
              </div>

              {selected && (
                <aside className="bdg-detail" style={{ '--rc': rarityColor(selected) }} aria-live="polite">
                  <div className="bdg-detail-art"><BadgeArt badge={selected} size={84} /></div>
                  <span className="bdg-detail-rarity"><i /> {RARITY_LABEL[rarityOf(selected)]}</span>
                  <h3>{selected.name}</h3>
                  <p className="bdg-detail-desc">{selected.description || 'Esta insígnia ainda não tem uma descrição.'}</p>
                  <dl className="bdg-detail-facts">
                    <div>
                      <dt><BIcon name="sparkle" size={14} /> Como conseguir</dt>
                      <dd>{howObtained(selected)}</dd>
                    </div>
                    <div>
                      <dt><BIcon name="calendar" size={14} /> Desbloqueada em</dt>
                      <dd>{formatAwardedAt(selected.awardedAt, true) || '—'}</dd>
                    </div>
                  </dl>
                </aside>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
