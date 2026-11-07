import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';

// "Perfil" na barra lateral principal abre o perfil completo do próprio
// usuário numa área grande — reaproveita o UserProfileModal.jsx já
// existente (que já é renderizado em tela cheia, ver
// .profile-fullscreen-overlay no CSS), só que agora disparado direto pela
// navegação principal em vez de um clique no avatar. UserProfileModal.jsx
// já é montado globalmente em MainApp.jsx e reage a `viewingProfileUserId`.
export default function ProfilePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const openProfile = useStore((s) => s.openProfile);
  const closeProfile = useStore((s) => s.closeProfile);
  const viewingProfileUserId = useStore((s) => s.viewingProfileUserId);
  // Marca que já vimos o perfil de fato abrir pelo menos uma vez — evita
  // que o efeito de "voltar pro Chat" logo abaixo dispare na hora do
  // PRIMEIRO render, antes de openProfile() sequer ter tido chance de
  // atualizar o estado global (viewingProfileUserId ainda seria o valor
  // antigo de antes de entrar nesta página nesse instante).
  const hasOpenedRef = useRef(false);

  useEffect(() => {
    openProfile(user.id);
    // BUG CORRIGIDO: `viewingProfileUserId` é um estado GLOBAL (o modal do
    // perfil é montado uma vez só, lá em cima em MainApp.jsx, não dentro
    // desta página) — antes, sair da seção Perfil clicando em outro item
    // da barra lateral (Chat, Amigos, etc) desmontava ESTA página mas
    // nunca avisava o estado global disso, então o perfil ficava preso
    // aberto por cima da seção nova pra onde você tinha acabado de
    // navegar. Essa função de limpeza fecha o perfil quando esta página
    // desmonta — só se o que estiver aberto ainda for o SEU PRÓPRIO
    // perfil (o mesmo que esta página abriu); se nesse meio tempo você
    // clicou no avatar de outra pessoa e o modal está mostrando o perfil
    // DELA, não fecha à toa.
    return () => {
      if (useStore.getState().viewingProfileUserId === user.id) closeProfile();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  // Se o usuário fechar o perfil pelo X enquanto ainda está nesta seção,
  // volta pro Chat em vez de deixar a área de conteúdo em branco — o X
  // aqui funciona como "sair da seção Perfil", não só "fechar o modal".
  useEffect(() => {
    if (viewingProfileUserId === user.id) {
      hasOpenedRef.current = true;
    } else if (hasOpenedRef.current) {
      navigate('/', { replace: true });
    }
  }, [viewingProfileUserId, user.id, navigate]);

  return null;
}
