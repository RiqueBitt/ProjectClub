// Peças visuais compartilhadas pelo editor de cargos e pelo editor de
// permissões de canais/categorias (estilo Discord).
import { PERMISSION_INFO, matchesSearch } from '../../utils/permissionCatalog';
import '../../styles/permissions.css';

export function Switch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={label}
      disabled={disabled}
      className={`pm-switch ${checked ? 'on' : ''}`}
      onClick={() => !disabled && onChange(!checked)}
    >
      <span className="pm-switch-knob">{checked ? '✓' : '✕'}</span>
    </button>
  );
}

// ✕ negar · / herdar · ✓ permitir — igual aos canais do Discord.
export function TriState({ value, onChange, disabled }) {
  const opt = (v, cls, glyph, title) => (
    <button
      type="button"
      className={`pm-tri-btn ${cls} ${value === v || (!value && v === null) ? 'active' : ''}`}
      onClick={() => !disabled && onChange(v)}
      disabled={disabled}
      title={title}
      aria-pressed={value === v || (!value && v === null)}
    >{glyph}</button>
  );
  return (
    <div className="pm-tri" role="group">
      {opt('deny', 'deny', '✕', 'Negar')}
      {opt(null, 'neutral', '/', 'Herdar (neutro)')}
      {opt('allow', 'allow', '✓', 'Permitir')}
    </div>
  );
}

export function PermRow({ permKey, control, warn }) {
  const [name, desc] = PERMISSION_INFO[permKey] || [permKey, ''];
  return (
    <div className="pm-row">
      <div className="pm-row-head">
        <span className="pm-row-name">{name}</span>
        {control}
      </div>
      {desc && <p className="pm-row-desc">{desc}</p>}
      {warn && <p className="pm-row-warn">{warn}</p>}
    </div>
  );
}

// Lista agrupada com busca; renderControl(key) devolve o controle de cada linha.
export function PermissionList({ groups, search, renderControl, warnFor }) {
  const visible = groups
    .map((g) => ({ ...g, keys: g.keys.filter((k) => PERMISSION_INFO[k] && matchesSearch(k, search)) }))
    .filter((g) => g.keys.length);
  if (!visible.length) return <p className="pm-empty">Nenhuma permissão encontrada.</p>;
  return visible.map((g) => (
    <section key={g.label} className="pm-group">
      <h4 className="pm-group-title">{g.label}</h4>
      {g.keys.map((k) => <PermRow key={k} permKey={k} control={renderControl(k)} warn={warnFor?.(k)} />)}
    </section>
  ));
}

export function SearchBox({ value, onChange, placeholder = 'Buscar permissões' }) {
  return (
    <div className="pm-search">
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {value ? <button type="button" onClick={() => onChange('')} aria-label="Limpar busca">✕</button> : <span aria-hidden>⌕</span>}
    </div>
  );
}

// Barra "você tem alterações não salvas" que sobe no rodapé.
export function SaveBar({ show, saving, error, onReset, onSave }) {
  if (!show) return null;
  return (
    <div className={`pm-savebar ${error ? 'error' : ''}`}>
      <span>{error || 'Cuidado — você tem alterações não salvas!'}</span>
      <div className="pm-savebar-actions">
        <button type="button" className="btn-link" onClick={onReset} disabled={saving}>Redefinir</button>
        <button type="button" className="pm-btn-green" onClick={onSave} disabled={saving}>{saving ? 'Salvando...' : 'Salvar alterações'}</button>
      </div>
    </div>
  );
}

export function RoleDot({ color, size = 12 }) {
  return <span className="pm-dot" style={{ width: size, height: size, background: color || '#99AAB5' }} />;
}
