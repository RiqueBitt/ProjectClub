// Alfinete pequeno que marca uma conversa fixada na lista de DMs.
export default function PinGlyph({ size = 12 }) {
  return (
    <svg className="dm-pin-glyph" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Fixada">
      <title>Fixada</title>
      <path d="M9 4h6l-1 6 3 3v2H7v-2l3-3z" />
      <path d="M12 15v6" />
    </svg>
  );
}
