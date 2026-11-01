// Aviso de anúncio/evento novo ('broadcast:notify' do servidor): a pessoa
// desligou em Configurações → Notificações? (ligado por padrão)
const PREF_BY_KIND = { announcement: 'notifyAnnouncements', event: 'notifyEvents' };

export function wantsBroadcastNotify(extra, kind) {
  const pref = PREF_BY_KIND[kind];
  if (!pref) return false;
  return extra?.[pref] !== false;
}
