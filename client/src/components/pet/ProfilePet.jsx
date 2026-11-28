import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PetPenguinSvg, { PET_MOODS } from './PetPenguinSvg.jsx';
import { getUserPet } from '../../api/fase8';

// Pinguim de alguém no perfil completo e no miniperfil (Fase 8). Cache
// curto por pessoa: abrir/fechar o perfil não busca tudo de novo.
const cache = new Map(); // userId -> { at, pet }
const TTL = 60_000;

export function invalidatePetCache(userId) { cache.delete(userId); }

function usePet(userId) {
  const hit = userId ? cache.get(userId) : null;
  const [pet, setPet] = useState(hit ? hit.pet : undefined);
  useEffect(() => {
    if (!userId) return undefined;
    const c = cache.get(userId);
    if (c && Date.now() - c.at < TTL) { setPet(c.pet); return undefined; }
    let alive = true;
    getUserPet(userId)
      .then((d) => { cache.set(userId, { at: Date.now(), pet: d.pet || null }); if (alive) setPet(d.pet || null); })
      .catch(() => { if (alive) setPet(null); });
    return () => { alive = false; };
  }, [userId]);
  return pet;
}

// Card no perfil completo.
export default function ProfilePet({ userId, isMe, onNavigate }) {
  const navigate = useNavigate();
  const pet = usePet(userId);
  if (pet === undefined) return null;
  if (!pet) {
    if (!isMe) return null;
    return (
      <div className="pet-profile-card">
        <div className="pet-profile-figure"><PetPenguinSvg size={84} stage={0} mood="feliz" /></div>
        <div className="pet-profile-info">
          <strong>Adote seu pinguim!</strong>
          <span className="pet-profile-meta">Um mascote que evolui junto com a sua participação no clube.</span>
          <button type="button" className="pet-profile-link" onClick={() => { onNavigate?.(); navigate('/meu-pinguim'); }}>Conhecer meu pinguim →</button>
        </div>
      </div>
    );
  }
  return (
    <div className="pet-profile-card">
      <div className="pet-profile-figure">
        <PetPenguinSvg size={88} color={pet.color} stage={pet.stage} mood={pet.mood} equipped={pet.equipped} title={`${pet.name}, o pinguim`} />
      </div>
      <div className="pet-profile-info">
        <strong>{pet.name}</strong>
        <span className={`pet-stage-chip${pet.stage >= 3 ? ' is-legend' : ''}`}>{pet.stageLabel}</span>
        <span className="pet-profile-meta">
          {PET_MOODS[pet.mood] || 'Tranquilo'}
          {pet.streak > 1 ? ` · ${pet.streak} dias seguidos de carinho` : ''}
        </span>
        {pet.next && (
          <div className="pet-profile-bar" title={`Faltam ${pet.next.missing} pontos para ${pet.next.label}`}><span style={{ width: `${pet.next.progress}%` }} /></div>
        )}
        {isMe && (
          <button type="button" className="pet-profile-link" onClick={() => { onNavigate?.(); navigate('/meu-pinguim'); }}>
            {pet.caredToday ? 'Personalizar meu pinguim →' : 'Cuidar do pinguim hoje →'}
          </button>
        )}
      </div>
    </div>
  );
}

// Versão pequena (miniperfil): só o pinguim e o nome.
export function MiniProfilePet({ userId }) {
  const pet = usePet(userId);
  if (!pet) return null;
  return (
    <span className="pet-mini" title={`${pet.name} · ${pet.stageLabel}`}>
      <PetPenguinSvg size={30} color={pet.color} stage={pet.stage} mood={pet.mood} equipped={pet.equipped} animated={false} />
      <span>{pet.name} · {pet.stageLabel}</span>
    </span>
  );
}
