import { useEffect, useState } from 'react';
import Modal from '../Modal.jsx';
import { listAchievements, setDisplayedAchievements as saveDisplayed } from '../../api/endpoints';
import defaultIcon from '../../assets/icons/nav-achievements.png';

// Seletor de conquistas em destaque — perfil completo aceita até 6,
// miniperfil até 4 (ver requisito). Só mostra conquistas JÁ
// desbloqueadas pra escolher (o backend também valida isso, mas nem
// oferece a opção de escolher uma bloqueada aqui). Salva na conta —
// sobrevive a sair/entrar de novo (ver User.displayedAchievements(Mini)
// no schema).
export default function AchievementPickerModal({ slot, currentIds, onClose, onSaved }) {
  const limit = slot === 'profile' ? 6 : 4;
  const [achievements, setAchievements] = useState(null);
  const [selected, setSelected] = useState(currentIds || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { listAchievements().then((d) => setAchievements(d.achievements.filter((a) => a.unlocked))); }, []);

  const toggle = (key) => {
    setSelected((list) => {
      if (list.includes(key)) return list.filter((k) => k !== key);
      if (list.length >= limit) return list;
      return [...list, key];
    });
  };

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      const { user } = await saveDisplayed(slot, selected);
      const field = slot === 'profile' ? 'displayedAchievements' : 'displayedAchievementsMini';
      const chosen = achievements.filter((a) => selected.includes(a.key));
      // Mantém a ORDEM que a pessoa escolheu, não a ordem do catálogo.
      chosen.sort((a, b) => selected.indexOf(a.key) - selected.indexOf(b.key));
      onSaved(field, chosen);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Escolher conquistas — ${slot === 'profile' ? 'Perfil (até 6)' : 'Miniperfil (até 4)'}`} onClose={onClose}>
      {!achievements ? <p className="dim">Carregando...</p> : achievements.length === 0 ? (
        <p className="dim">Você ainda não desbloqueou nenhuma conquista.</p>
      ) : (
        <div className="achievement-picker-grid">
          {achievements.map((a) => {
            const isSelected = selected.includes(a.key);
            return (
              <button
                key={a.key}
                type="button"
                className={`achievement-picker-item ${isSelected ? 'selected' : ''}`}
                onClick={() => toggle(a.key)}
              >
                <img className="achievement-picker-icon" src={a.iconUrl || defaultIcon} alt="" />
                <span className="truncate">{a.name}</span>
              </button>
            );
          })}
        </div>
      )}
      <p className="dim" style={{ marginTop: 8 }}>{selected.length}/{limit} escolhidas</p>
      {error && <div className="auth-error">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="btn-link" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn-primary" disabled={saving} onClick={submit}>{saving ? 'Salvando...' : 'Salvar'}</button>
      </div>
    </Modal>
  );
}
