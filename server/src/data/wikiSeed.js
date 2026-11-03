// Páginas iniciais da wiki (/wiki). Só são criadas quando a wiki está
// vazia (services/pingu/wiki.js → ensureSeed) — depois disso a equipe edita
// à vontade pelo site e nada aqui sobrescreve. Escritas a partir do que o
// código realmente faz (economy.js, xp.js, voiceRewards.js, automod.js…).
const WIKI_SEED = [
  {
    slug: 'regras',
    title: 'Regras',
    category: 'Comunidade',
    body: `
# Regras do Project Club

O Project Club é uma comunidade brasileira só: todo mundo divide os mesmos canais, cargos e moderação. Respeito em primeiro lugar.

## Convivência
Trate todo mundo com respeito. Nada de ofensas, assédio, preconceito, ameaças ou conteúdo sexual explícito. Discussões acontecem, mas ataque a ideia, não a pessoa.

## Spam e flood
Não mande várias mensagens seguidas iguais, texto todo em maiúsculas ou excesso de menções. Canais podem ter modo lento (um tempo mínimo entre mensagens). O filtro automático (AutoMod) pode bloquear palavras, links e envio rápido demais.

## Golpes e links
Links falsos de "Nitro grátis", sites que imitam Discord/Steam/Project Club e links com endereço disfarçado são bloqueados automaticamente. Nas mensagens diretas, convites de outras plataformas (Discord, WhatsApp, Telegram) não são enviados.

## Mensagens diretas
Palavrões em DM não bloqueiam a mensagem, mas ficam sinalizados para a equipe revisar. Cada pessoa escolhe nas Configurações quem pode mandar DM para ela.

## Punições
A equipe pode advertir, silenciar por um tempo (silêncio temporário), suspender ou banir. Viu algo errado? Use "Denunciar" no menu da mensagem ou abra um ticket em Suporte. O Pingu nunca pune ninguém: ele só avisa a equipe.

## Senhas e segurança
Ninguém da equipe (nem o Pingu) pede a sua senha. Ative a verificação em duas etapas nas Configurações.
`,
  },
  {
    slug: 'economia',
    title: 'Como funciona a economia',
    category: 'Economia',
    body: `
# Como funciona a economia

A Economia tem moedas, gemas, XP e níveis. A equipe pode desligar a Economia inteira; nesse caso nada disso conta.

## XP por mensagem
Mensagens em canais (não em DM) dão de 25 a 35 XP, no máximo uma vez a cada 30 segundos, e só se a mensagem tiver pelo menos 2 palavras de verdade (emoji e link sozinhos não contam). Subir de nível pode dar moedas de prêmio.

## XP e moedas na call
A cada 5 minutos seguidos numa call com 2 ou mais pessoas (sem estar ensurdecido) você ganha 15 XP e 3 moedas. Contam até 3 horas por dia.

## Baú diário
Na aba Economia dá para abrir um baú por dia (a cada 24 horas). Os baús vão do Comum ao Ultra Lendário e dão moedas e tickets. Abrir vários dias seguidos aumenta a sequência; com 5 dias seguidos vem o Mega Baú, que dá gemas. Ficar mais de 48 horas sem abrir zera a sequência.

## Missões
Missões diárias e semanais contam mensagens, reações, minutos em call, posts e comentários no Fórum, o baú diário e visitas à Loja. Ao completar, você resgata o prêmio.

## Loja
Na Loja você troca moedas ou gemas por molduras de avatar, efeitos de perfil e coleções. Assinantes e Super Assinantes ganham desconto e bônus de XP.

## Quiz do Pingu
Às vezes o Pingu faz uma pergunta num canal: quem acertar primeiro ganha moedas e XP.
`,
  },
  {
    slug: 'canais-de-voz',
    title: 'Canais de voz',
    category: 'Comunidade',
    body: `
# Canais de voz

Os canais de voz são salas de chamada com áudio, câmera e compartilhamento de tela.

## Entrar e conversar
Clique num canal de voz para entrar. Você pode silenciar o microfone, ensurdecer, ligar a câmera ou compartilhar a tela. Em Configurações → Voz dá para escolher microfone, redução de ruído e volumes.

## Salas temporárias
Qualquer membro pode criar a própria sala ("Sala de Fulano") numa categoria que já tenha canais de voz. O dono pode renomear e pôr limite de pessoas. A sala some sozinha quando fica vazia por 1 minuto.

## Canal AFK
Quem fica parado na voz pelo tempo configurado pela equipe é movido para o canal AFK e fica mudo lá.

## Rádio e Assistir juntos
A equipe pode transformar um canal de voz em rádio com músicas do YouTube tocando em sequência para todo mundo. Em qualquer call dá para assistir vídeos juntos, sincronizados.

## Recompensas
Ficar em call com outras pessoas dá XP e moedas (veja /wiki/economia).
`,
  },
  {
    slug: 'pingu',
    title: 'Pingu',
    category: 'Pingu',
    body: `
# Pingu, o assistente de IA

O Pingu (@pingu) é o assistente de IA do Project Club. A IA roda num servidor próprio da comunidade, então às vezes ele fica offline; quando isso acontece ele avisa.

## Como chamar
Escreva @pingu seguido da pergunta em qualquer canal, ou responda uma mensagem dele. Ele responde uma pergunta por vez, em texto curto. Se muita gente chamar ao mesmo tempo, ele pede para tentar de novo em um minutinho.

## Resumo do que você perdeu
No topo de um canal, o botão "Resumir o que perdi" (ou escrever @pingu resume) faz um resumo em tópicos das mensagens desde a sua última visita. Só você vê o resumo.

## Tradução
No menu de uma mensagem (botão direito), "Traduzir com o Pingu" mostra a tradução só para você.

## Quiz
A equipe pode iniciar um quiz num canal: o Pingu faz a pergunta e quem acertar primeiro ganha moedas e XP.

## O que ele não faz
O Pingu não cria imagens, não faz ações no site, nunca pede senha e nunca pune ninguém. Ele não lê mensagens diretas.
`,
  },
  {
    slug: 'apps',
    title: 'Apps',
    category: 'Apps',
    body: `
# Apps do Project Club

Na aba Apps do aplicativo para computador ficam os apps e launchers do ecossistema Project Club. Cada um é instalado, atualizado e aberto por ali, e a lista cresce conforme novos apps são lançados.

## Criação
WaveProject (editor de áudio), CanvasProject (pintura digital), PhotoProject (editor de imagem), CutProject (editor de vídeo), ForgeProject (estúdio 3D), TexelProject (pintura de texturas 3D) e GameProject (criação de jogos).

## Jogos
ProjectMC é o launcher de Minecraft (instâncias, mods, modpacks e shaders) e HyProject é o launcher de Hytale.

## Mods
Na aba Jogos → Mods dá para procurar e instalar mods de vários sites (mod.io, Steam Workshop, GameBanana, Thunderstore e outros) para os jogos suportados.

## Ajuda
Problema com algum app? Abra um ticket em Suporte.
`,
  },
];

module.exports = { WIKI_SEED };
