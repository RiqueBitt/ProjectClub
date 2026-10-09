import ClanIcon from './ClanIcon.jsx';
import PageIcon from './PageIcons.jsx';

// Peças compartilhadas da área de Clubes (lista e página do clube).
export const ICON_COLORS = ['#80848E', '#4C9FFF', '#EB459E', '#ED4245', '#FEE75C', '#57F287', '#00B0F4', '#9147FF', '#F0883E'];

export const PRIVACY = {
  PUBLIC: { label: 'Público', hint: 'Qualquer pessoa entra direto', icon: 'user' },
  FRIENDS_ONLY: { label: 'Só amigos', hint: 'Só amigos do dono podem entrar', icon: 'shield' },
  INVITE_ONLY: { label: 'Só convite', hint: 'Entrada apenas com convite', icon: 'lock' },
};

export function privacyOf(clan) {
  return clan?.privacyType || (clan?.isPublic === false ? 'INVITE_ONLY' : 'PUBLIC');
}

// Ícone do clube num quadrado com a cor dele bem suave por trás.
export function ClubTile({ clan, icon, color, size = 56 }) {
  const c = color || clan?.iconColor || ICON_COLORS[0];
  const ic = icon !== undefined ? icon : clan?.icon;
  return (
    <span className="cb-tile" style={{ '--club-color': c, width: size, height: size }}>
      {ic ? <ClanIcon icon={ic} color={c} size={Math.round(size * 0.58)} /> : <span style={{ color: c, display: 'inline-flex' }}><PageIcon name="shield" size={Math.round(size * 0.5)} /></span>}
    </span>
  );
}

export function PrivacyChip({ clan }) {
  const p = PRIVACY[privacyOf(clan)] || PRIVACY.PUBLIC;
  return <span className={`cb-chip privacy-${privacyOf(clan).toLowerCase()}`}><PageIcon name={p.icon} size={13} /> {p.label}</span>;
}

// Formulário de aparência/identidade usado em "Criar clube" e em Configurações.
export function ClubForm({ form, setForm, icons }) {
  return (
    <div className="cb-form">
      <div className="cb-form-preview">
        <ClubTile icon={icons.find((i) => i.id === form.iconId) || null} color={form.iconColor} size={84} />
        <div className="cb-form-preview-text">
          <strong className="truncate">{form.name.trim() || 'Nome do clube'}</strong>
          <span className="truncate">{form.description.trim() || 'Uma descrição curta aparece aqui'}</span>
        </div>
      </div>

      <label className="cb-field">
        <span>Nome</span>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={40} placeholder="Ex.: Os Construtores" />
        <small>{form.name.length}/40</small>
      </label>
      <label className="cb-field">
        <span>Descrição <em>(opcional)</em></span>
        <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={200} rows={2} placeholder="Sobre o que é o seu clube" />
        <small>{form.description.length}/200</small>
      </label>

      <div className="cb-field">
        <span>Ícone</span>
        <div className="cb-icon-grid">
          <button type="button" className={`cb-icon-opt${!form.iconId ? ' active' : ''}`} onClick={() => setForm({ ...form, iconId: '' })} title="Padrão">
            <span style={{ color: form.iconColor, display: 'inline-flex' }}><PageIcon name="shield" size={22} /></span>
          </button>
          {icons.map((i) => (
            <button key={i.id} type="button" className={`cb-icon-opt${form.iconId === i.id ? ' active' : ''}`} onClick={() => setForm({ ...form, iconId: i.id })} title={i.name}>
              <ClanIcon icon={i} color={form.iconColor} size={24} />
            </button>
          ))}
        </div>
      </div>

      <div className="cb-field">
        <span>Cor</span>
        <div className="cb-swatches">
          {ICON_COLORS.map((c) => (
            <button
              key={c} type="button" aria-label={`Cor ${c}`}
              className={`cb-swatch${form.iconColor === c ? ' active' : ''}`} style={{ '--sw': c }}
              onClick={() => setForm({ ...form, iconColor: c })}
            />
          ))}
        </div>
      </div>

      <div className="cb-field">
        <span>Quem pode entrar</span>
        <div className="cb-privacy">
          {Object.entries(PRIVACY).map(([key, p]) => (
            <button key={key} type="button" className={`cb-privacy-opt${form.privacyType === key ? ' active' : ''}`} onClick={() => setForm({ ...form, privacyType: key })}>
              <PageIcon name={p.icon} size={18} />
              <strong>{p.label}</strong>
              <small>{p.hint}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
