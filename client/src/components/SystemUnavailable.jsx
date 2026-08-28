// Mostrada no lugar de Economia/Casas/Figurinhas quando a staff desliga
// aquele sistema (ver adminController.adminUpdateSystemToggles) — a
// própria chamada da API já retorna 503 com { systemDisabled }, então cada
// página só precisa checar esse erro e renderizar isso no lugar do conteúdo.
export default function SystemUnavailable({ icon = '🚧' }) {
  return (
    <div className="economy-page" style={{ textAlign: 'center', paddingTop: 80 }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>{icon}</div>
      <h2>Indisponível no momento</h2>
      <p className="dim">A equipe desativou temporariamente esta seção. Volte mais tarde.</p>
    </div>
  );
}
