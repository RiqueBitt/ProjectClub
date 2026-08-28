import logoImg from '../assets/icons/logo-project-club.png';

// Logo do Project Club — imagem enviada pelo usuário (branca, fundo
// transparente), colocada dentro de um cartão arredondado na cor da marca
// pra funcionar em qualquer tema.
export default function Logo({ size = 36 }) {
  return (
    <div
      style={{
        width: size, height: size, borderRadius: size * 0.3, background: 'var(--brand)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden',
      }}
    >
      <img src={logoImg} alt="Project Club" style={{ width: '72%', height: '72%', objectFit: 'contain' }} />
    </div>
  );
}
