// Flags de funcionalidades desativadas por decisão do dono da comunidade,
// mas mantidas no código (nada foi apagado) — só a UI/efeito fica
// desligado. Reative trocando o valor de volta pra `true`.
//
// CUSTOM_BACKGROUND_ENABLED: controla o "Fundo personalizado" (degradê)
// em Configurações → Aparência. Com `false`, o checkbox some da UI e o
// App.jsx para de aplicar o degradê salvo no backdrop, mesmo que algum
// usuário já tenha um `customBackground` salvo no store de antes.
export const CUSTOM_BACKGROUND_ENABLED = false;
