import { memo } from 'react';

// Visual das cartas do Jogo de Cartas. Sem imagem enviada pela staff, a arte
// é gerada (SVG determinístico a partir do elemento + nome), então toda
// carta nova já nasce com uma arte própria.

export const ELEMENTS = {
  FOGO: { label: 'Fogo', color: '#ff5a3c', dark: '#5a1206', glyph: 'M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-4-1-6 1-9z' },
  AGUA: { label: 'Água', color: '#3aa0ff', dark: '#06264f', glyph: 'M12 2s7 8 7 13a7 7 0 0 1-14 0c0-5 7-13 7-13z' },
  TERRA: { label: 'Terra', color: '#62c24a', dark: '#12360b', glyph: 'M3 20l6-11 4 6 3-4 5 9z' },
  AR: { label: 'Ar', color: '#5fe0d0', dark: '#073a36', glyph: 'M3 9h11a3 3 0 1 0-3-3M3 14h15a3 3 0 1 1-3 3M3 19h8' },
  LUZ: { label: 'Luz', color: '#ffd34d', dark: '#4a3600', glyph: 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z' },
  SOMBRA: { label: 'Sombra', color: '#a46bff', dark: '#22094a', glyph: 'M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z' },
};

export const RARITIES = {
  COMUM: { label: 'Comum', color: '#9aa3ad' },
  INCOMUM: { label: 'Incomum', color: '#4cc76b' },
  RARA: { label: 'Rara', color: '#3b8bff' },
  EPICA: { label: 'Épica', color: '#b55cff' },
  LENDARIA: { label: 'Lendária', color: '#ffb020' },
  MITICA: { label: 'Mítica', color: '#ff4fa3' },
};
export const RARITY_ORDER = ['COMUM', 'INCOMUM', 'RARA', 'EPICA', 'LENDARIA', 'MITICA'];

export const ABILITIES = {
  NONE: { label: '', desc: '' },
  GUARDA: { label: 'Guarda', desc: 'Inimigos precisam atacar esta unidade primeiro.', icon: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z' },
  INVESTIDA: { label: 'Investida', desc: 'Pode atacar no turno em que entra.', icon: 'M13 2 4 14h7l-1 8 9-12h-7z' },
  ESCUDO: { label: 'Escudo', desc: 'Ignora o primeiro dano que receber.', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v10M7 12h10' },
  ROUBO_VIDA: { label: 'Roubo de vida', desc: 'O dano que causa cura o seu herói.', icon: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z' },
  VENENO: { label: 'Veneno', desc: 'Destrói qualquer unidade em que causar dano.', icon: 'M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11zM10 14h.01M14 14h.01' },
  FURIA: { label: 'Fúria', desc: 'Pode atacar duas vezes por turno.', icon: 'M5 19 19 5M9 5h10v10M5 13l6 6' },
  GRITO_DANO: { label: 'Explosão', desc: 'Ao entrar: causa {v} de dano ao herói inimigo.', icon: 'M12 2v4M12 18v4M2 12h4M18 12h4M12 8l2 4-2 4-2-4z' },
  GRITO_CURA: { label: 'Bênção', desc: 'Ao entrar: cura {v} de vida do seu herói.', icon: 'M12 5v14M5 12h14' },
  GRITO_COMPRA: { label: 'Sabedoria', desc: 'Ao entrar: compra {v} carta(s).', icon: 'M4 5h7a3 3 0 0 1 3 3v12a3 3 0 0 0-3-3H4zM20 5h-6' },
  GRITO_RAIO: { label: 'Raio', desc: 'Ao entrar: causa {v} de dano à unidade inimiga mais forte.', icon: 'M13 2 6 13h6l-1 9 7-12h-6z' },
  AURA: { label: 'Inspirar', desc: 'Ao entrar: suas outras unidades ganham +{v} de ataque.', icon: 'M12 2l3 6 6 1-4.5 4 1 6.5L12 16l-5.5 3.5 1-6.5L3 9l6-1z' },
  REGENERA: { label: 'Regenerar', desc: 'No início do seu turno, cura {v} de vida desta unidade.', icon: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5' },
  ULTIMO_SUSPIRO: { label: 'Último suspiro', desc: 'Ao morrer: causa {v} de dano ao herói inimigo.', icon: 'M12 3a7 7 0 0 0-7 7v4l2 2v4h10v-4l2-2v-4a7 7 0 0 0-7-7zM9 11h.01M15 11h.01' },
  ENERGIA: { label: 'Canalizar', desc: 'Ao entrar: ganha {v} de energia neste turno.', icon: 'M12 2 4 7v10l8 5 8-5V7z' },
  FURTIVO: { label: 'Furtivo', desc: 'Não pode ser alvo de ataques nem feitiços até atacar.', icon: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM3 3l18 18' },
  CONGELA: { label: 'Gélido', desc: 'Congela as unidades em que causa dano (perdem o próximo ataque).', icon: 'M12 2v20M4.9 6.9l14.2 10.2M19.1 6.9 4.9 17.1M9 4l3 3 3-3M9 20l3-3 3 3' },
  INVOCAR: { label: 'Convocar', desc: 'Ao entrar: invoca {v} Recruta(s) 1/1.', icon: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 11a3 3 0 1 0 0-6M3 20v-1a5 5 0 0 1 10 0v1M15 14a5 5 0 0 1 6 5v1' },
  ESPINHOS: { label: 'Espinhos', desc: 'Quem a atacar recebe +{v} de dano.', icon: 'M12 2l2 6h6l-5 4 2 6-5-4-5 4 2-6-5-4h6z' },
  PROTEGER: { label: 'Proteger', desc: 'Ao entrar: suas outras unidades ganham Escudo.', icon: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4' },
  FEITICO_DANO: { label: 'Disparo', desc: 'Causa {v} de dano a uma unidade ou ao herói inimigo.', icon: 'M13 2 6 13h6l-1 9 7-12h-6z', spell: true, target: 'ENEMY' },
  FEITICO_AREA: { label: 'Tempestade', desc: 'Causa {v} de dano a todas as unidades inimigas.', icon: 'M4 14a4 4 0 0 1 2-7.5A6 6 0 0 1 18 8a4 4 0 0 1 0 8H7M9 18l-1 3M13 18l-1 3M17 18l-1 3', spell: true },
  FEITICO_CURA: { label: 'Cura', desc: 'Cura {v} de vida do seu herói.', icon: 'M12 5v14M5 12h14', spell: true },
  FEITICO_COMPRA: { label: 'Visão', desc: 'Compra {v} carta(s).', icon: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', spell: true },
  FEITICO_BUFF: { label: 'Equipamento', desc: 'Uma unidade sua ganha +{v} de ataque e +{v} de vida.', icon: 'M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4', spell: true, target: 'FRIENDLY' },
  FEITICO_ESCUDO: { label: 'Barreira', desc: 'Uma unidade sua ganha Escudo.', icon: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', spell: true, target: 'FRIENDLY' },
  FEITICO_CONGELAR: { label: 'Congelar', desc: 'Congela uma unidade inimiga e causa {v} de dano.', icon: 'M12 2v20M4.9 6.9l14.2 10.2M19.1 6.9 4.9 17.1', spell: true, target: 'ENEMY_UNIT' },
};

export function abilityText(ability, value) {
  return (ABILITIES[ability]?.desc || '').replace(/\{v\}/g, String(value ?? 0));
}

export function Icon({ d, size = 16, fill = false, sw = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export const UI = {
  sword: 'M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2',
  heart: 'M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11z',
  coin: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5c0-1 1-1.8 2.5-1.8s2.5.8 2.5 1.8c0 2.5-5 1.6-5 4.3 0 1 1 1.9 2.5 1.9s2.5-.8 2.5-1.9M12 6.5v1.2M12 16.3v1.2',
  gem: 'M6 3h12l4 6-10 12L2 9zM2 9h20M12 21 8 9l4-6 4 6z',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  deck: 'M7 3h11a2 2 0 0 1 2 2v13M4 7h11a2 2 0 0 1 2 2v11H6a2 2 0 0 1-2-2z',
  star: 'M12 2l3 6.5 7 .8-5.2 4.8 1.5 7L12 17.5 5.7 21l1.5-7L2 9.3l7-.8z',
  swap: 'M7 7h13l-4-4M17 17H4l4 4',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4',
  bot: 'M12 3v3M7 8h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3zM9 13h.01M15 13h.01M9.5 17h5',
  users: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  pack: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10',
  close: 'M6 6l12 12M18 6 6 18',
  back: 'M15 18l-6-6 6-6',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  up: 'M12 19V5M5 12l7-7 7 7',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5',
  check: 'M5 12l5 5L20 7',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  wand: 'M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5',
};

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Arte gerada: fundo no tom do elemento, formas decorativas e o símbolo.
export const CardArt = memo(function CardArt({ card }) {
  const el = ELEMENTS[card.element] || ELEMENTS.FOGO;
  if (card.imageUrl) return <img className="tcg-art-img" src={card.imageUrl} alt="" loading="lazy" draggable="false" />;
  const h = hash(`${card.slug || card.cardId || ''}${card.name}`);
  const shapes = Array.from({ length: 7 }, (_, i) => {
    const v = (h >>> (i * 4)) & 0xff;
    return { x: (v * 37 + i * 53) % 100, y: (v * 71 + i * 29) % 100, r: 6 + (v % 18), o: 0.08 + ((v >> 3) % 10) / 60 };
  });
  const gid = `g${h.toString(36)}`;
  return (
    <svg className="tcg-art-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id={gid} cx={`${30 + (h % 40)}%`} cy="35%" r="85%">
          <stop offset="0%" stopColor={el.color} stopOpacity="0.95" />
          <stop offset="100%" stopColor={el.dark} />
        </radialGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${gid})`} />
      {shapes.map((s, i) => (i % 2
        ? <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" opacity={s.o} />
        : <rect key={i} x={s.x - s.r / 2} y={s.y - s.r / 2} width={s.r} height={s.r} rx="2" fill="#fff" opacity={s.o} transform={`rotate(${(h >> i) % 90} ${s.x} ${s.y})`} />))}
      <g transform="translate(26 22) scale(2.0)" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.92">
        <path d={el.glyph} />
      </g>
    </svg>
  );
});

/**
 * Carta completa (coleção, loja, mão). Aceita definição (attack/health)
 * ou instância de batalha (atk/hp).
 */
export function CardView({ card, size = 'md', className = '', onClick, quantity, showQty = false, dim = false, badge, children, style, foil, ...rest }) {
  if (!card) return null;
  const el = ELEMENTS[card.element] || ELEMENTS.FOGO;
  const rar = RARITIES[card.rarity] || RARITIES.COMUM;
  const atk = card.atk ?? card.attack;
  const hp = card.hp ?? card.health;
  const value = card.value ?? card.abilityValue;
  const ab = ABILITIES[card.ability];
  const spell = card.kind === 'SPELL';
  const shiny = !!(foil ?? card.foil);
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`tcg-card tcg-${size} tcg-r-${card.rarity}${dim ? ' is-dim' : ''}${spell ? ' is-spell' : ''}${shiny ? ' is-foil' : ''} ${className}`}
      {...rest}
      style={{ '--el': el.color, '--el-dark': el.dark, '--rar': rar.color, ...style }}
      onClick={onClick}
    >
      <span className="tcg-frame">
        <span className="tcg-cost" title="Custo de energia">{card.cost}</span>
        <span className="tcg-art"><CardArt card={card} /></span>
        <span className="tcg-name" data-no-translate>{card.name}</span>
        <span className="tcg-type">
          <span className="tcg-el" title={el.label}><Icon d={el.glyph} size={11} /></span>
          {spell ? 'Feitiço' : rar.label}{card.level > 1 ? ` · Nv ${card.level}` : ''}
        </span>
        <span className="tcg-text">
          {ab?.label ? <><b>{ab.label}.</b> {abilityText(card.ability, value)}</> : <i>{card.flavor || ''}</i>}
        </span>
        {spell ? (
          <span className="tcg-spell-tag" title={RARITIES[card.rarity]?.label}>{rar.label}</span>
        ) : (
          <>
            <span className="tcg-atk" title="Ataque"><Icon d={UI.sword} size={12} />{atk}</span>
            <span className={`tcg-hp${card.maxHp && hp < card.maxHp ? ' is-hurt' : ''}`} title="Vida"><Icon d={UI.heart} size={12} fill />{hp}</span>
          </>
        )}
        {shiny && <span className="tcg-foil-sheen" aria-hidden="true" />}
      </span>
      {showQty && quantity > 0 && <span className="tcg-qty">x{quantity}</span>}
      {showQty && card.foil > 0 && <span className="tcg-foil-badge" title={`${card.foil} brilhante(s)`}>✦ {card.foil}</span>}
      {showQty && !quantity && <span className="tcg-missing">Não tem</span>}
      {badge}
      {children}
    </Tag>
  );
}

export function CardBack({ className = '', small = false }) {
  return (
    <span className={`tcg-back${small ? ' is-small' : ''} ${className}`} aria-hidden="true">
      <span className="tcg-back-inner"><Icon d={UI.star} size={small ? 12 : 26} /></span>
    </span>
  );
}
