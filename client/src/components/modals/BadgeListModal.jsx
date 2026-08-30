import { useState } from 'react';
import Modal from '../Modal.jsx';
import { RARITY_LABEL, RARITY_COLOR, badgeHasImage } from '../../utils/badgeRarity';
import { proxyImage } from '../../utils/imageProxy';

function formatAwardedAt(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Opened by clicking ANY badge chip on a profile (see UserProfileModal.jsx)
// — shows every badge that same user has, not just the one clicked.
// Two-panel browser: a grid of every unlocked badge on the left, and a
// detail view for whichever one is selected on the right (icon, name,
// when it was unlocked, its rarity, and its description).
export default function BadgeListModal({ userName, badges, onClose }) {
  const [selectedId, setSelectedId] = useState(badges[0]?.id ?? null);
  const selected = badges.find((b) => b.id === selectedId) || badges[0] || null;
  const rarityColor = (b) => RARITY_COLOR[b?.rarity] || RARITY_COLOR.COMMON;

  return (
    <Modal title="" onClose={onClose} width="700px" className="badge-browser-modal-box">
      <div className="badge-browser-layout">
        <div className="badge-browser-sidebar">
          <h2 className="badge-browser-sidebar-title">Insígnias de {userName}</h2>
          {badges.length > 0 ? (
            <div className="badge-browser-grid">
              {badges.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={`badge-browser-tile ${selected?.id === b.id ? 'is-selected' : ''}`}
                  onClick={() => setSelectedId(b.id)}
                  title={b.name}
                >
                  {badgeHasImage(b) ? <img src={proxyImage(b.iconUrl)} alt="" /> : <span>{b.icon}</span>}
                </button>
              ))}
            </div>
          ) : (
            <p className="dim">Nenhuma insígnia ainda.</p>
          )}
        </div>

        {selected && (
          <div className="badge-browser-detail">
            <div className="badge-browser-detail-icon" style={{ '--badge-rarity-color': rarityColor(selected) }}>
              {badgeHasImage(selected) ? <img src={proxyImage(selected.iconUrl)} alt="" /> : <span>{selected.icon}</span>}
            </div>
            <h3 className="badge-browser-detail-name">{selected.name}</h3>

            <div className="badge-browser-detail-chips">
              <div className="badge-browser-chip">
                <b>{formatAwardedAt(selected.awardedAt) || '—'}</b>
                <span>Data desbloqueada</span>
              </div>
              <div className="badge-browser-chip">
                <span
                  className="badge-browser-rarity-pill"
                  style={{ color: rarityColor(selected), borderColor: rarityColor(selected) }}
                >
                  <i style={{ background: rarityColor(selected) }} />
                  {(RARITY_LABEL[selected.rarity] || RARITY_LABEL.COMMON).toUpperCase()}
                </span>
                <span>Raridade</span>
              </div>
            </div>

            <div className="badge-browser-description-box">
              <p>{selected.description || 'Esta insígnia ainda não tem uma descrição.'}</p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
