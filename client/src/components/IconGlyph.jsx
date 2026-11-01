// Ícone reutilizável — mesma técnica de mask-image usada na barra
// lateral/topo (ver MainSidebar.jsx/TopSearchBar.jsx): o PNG (preto
// sólido, pacote de ícones do usuário) vira uma "máscara" preenchida com
// currentColor, então herda a cor do texto ao redor automaticamente (só
// escrever CSS `color`) em vez de ficar preto fixo destoando do tema.
// Usado pra ir trocando emojis de interface por ícones sem repetir esse
// bloco de estilo em cada lugar.
export default function IconGlyph({ src, size = 16, className = '', style = {}, alt = '' }) {
  return (
    <span
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      className={`icon-glyph ${className}`}
      style={{
        display: 'inline-block', width: size, height: size, flexShrink: 0,
        backgroundColor: 'currentColor',
        WebkitMaskImage: `url(${src})`, maskImage: `url(${src})`,
        WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center', maskPosition: 'center',
        WebkitMaskSize: 'contain', maskSize: 'contain',
        verticalAlign: 'middle',
        ...style,
      }}
    />
  );
}
