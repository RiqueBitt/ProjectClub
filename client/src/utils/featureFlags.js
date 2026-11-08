// Flags de funcionalidades desativadas por decisão do dono da comunidade,
// mas mantidas no código (nada foi apagado) — só a UI/efeito fica
// desligado. Reative trocando o valor de volta pra `true`.
//
// CUSTOM_BACKGROUND_ENABLED: controla o "Fundo personalizado" (degradê)
// em Configurações → Aparência. Com `false`, o checkbox some da UI e o
// App.jsx para de aplicar o degradê salvo no backdrop, mesmo que algum
// usuário já tenha um `customBackground` salvo no store de antes.
export const CUSTOM_BACKGROUND_ENABLED = false;

// CLAN_TAGS_ENABLED: item pedido: "não mostre as tags [de clã] para
// os usuários ainda... mantenha toda a estrutura necessária pra ser
// ativado posteriormente sem precisar recriá-lo" — com `false`, o
// selo de tag de clã (ClanTagBadge.jsx) nunca aparece em lugar
// nenhum do app (chat, perfil, lista de membros, etc), e a aba
// "Tags" dentro da gestão do clã (ClanPage.jsx) fica visível só pra
// quem já tem permissão de gerenciar — criar/apagar tag continua
// funcionando normalmente por trás, só a visibilidade pra usuários
// comuns fica desligada.
// Reativado — item pedido: "quero que a tag do clã apareça no
// Exibição -> Tag da comunidade" (integrado na mesma seção da tag de
// comunidade já existente, ver UserSettingsModal.jsx).
export const CLAN_TAGS_ENABLED = true;
