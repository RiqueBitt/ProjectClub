// Planos de assinatura do Project Club (pagos por Pix no LivePix; a equipe
// libera as vantagens). Página: pages/AssinaturaPage.jsx (/assinatura).
export const PLANS = [
  {
    id: 'SUBSCRIBER', name: 'Assinante', price: '13,50', url: 'https://livepix.gg/projectclubr/assinante',
    tagline: 'O básico pra apoiar e se destacar.',
    perks: [
      '10% de desconto em todos os itens da Loja',
      '5% de bônus de XP',
      ['Acesso ao ', 'passe do clube'],
      ['Acesso à ', 'loja exclusiva'],
      'Pacote de 5 figurinhas personalizadas',
      ['Insígnia exclusiva de ', 'Assinante'],
      ['Decoração exclusiva de ', 'Assinante'],
      'Destaque na lista de membros',
    ],
  },
  {
    id: 'SUPER', name: 'Super Assinante', price: '20,50', url: 'https://livepix.gg/projectclubr/super-assinante',
    tagline: 'Tudo do Assinante, em dobro.', note: 'Todas as vantagens de Assinante +', best: true,
    perks: [
      '20% de desconto em todos os itens da Loja',
      '15% de bônus de XP',
      'Pacote de 15 figurinhas personalizadas',
      ['Insígnia exclusiva de ', 'Super Assinante'],
      ['Decoração exclusiva de ', 'Super Assinante'],
    ],
  },
];

/** Linhas da tabela "Compare os planos": [vantagem, grátis, assinante, super]. */
export const COMPARE = [
  ['Personalização básica do perfil (cores, fontes, banner, bio)', true, true, true],
  ['Desconto na Loja', false, '10%', '20%'],
  ['Bônus de XP', false, '+5%', '+15%'],
  ['Passe do clube', false, true, true],
  ['Loja exclusiva', false, true, true],
  ['Figurinhas personalizadas', false, '5', '15'],
  ['Insígnia exclusiva', false, 'Assinante', 'Super Assinante'],
  ['Decoração de avatar exclusiva', false, 'Assinante', 'Super Assinante'],
  ['Destaque na lista de membros', false, true, true],
];

export const TIER_NAME = { NONE: 'Grátis', SUBSCRIBER: 'Assinante', SUPER: 'Super Assinante' };
