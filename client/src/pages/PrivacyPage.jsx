import { Navigate, useLocation } from 'react-router-dom';

// /termos e /privacidade (endereços antigos): os termos e a política de
// privacidade agora são artigos do Blog. Mantém a âncora (#dados etc.).
const TERMS_IDS = new Set(['resumo', 'termos', 'mudancas', 'contato']);

export default function PrivacyPage() {
  const { hash } = useLocation();
  const id = decodeURIComponent((hash || '').slice(1));
  const slug = TERMS_IDS.has(id) ? 'termos-de-uso' : 'politica-de-privacidade';
  return <Navigate to={`/blog/${slug}${hash || ''}`} replace />;
}
