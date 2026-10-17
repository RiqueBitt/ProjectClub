import { Link } from 'react-router-dom';
import DocShell from './public/DocShell.jsx';
import { Facts, Note } from './public/blogContent.jsx';

// Termos de uso + política de privacidade (/termos, e /privacidade, o
// endereço antigo, que continua valendo).
//
// Tudo aqui foi conferido no código antes de entrar no texto:
// - dados: server/prisma/schema.prisma (User, MembershipApplication,
//   RefreshToken.ipAddress/userAgent, SecurityLog.ipHash, PushToken,
//   Message/Attachment/FileAsset, EconomyTransaction, GamePlaytime,
//   Report/AutomodFlag, HoneypotHit/BlockedIp);
// - IP mascarado: maskIp() em controllers/authController.js; hash do IP:
//   services/securityLog.js; erros: services/errorRing.js (50 em memória)
//   e routes/system.js (/client-error);
// - prazos: códigos de e-mail (15 min, 48 h na aprovação), link de senha
//   (1 h), cookie de sessão (REFRESH_TOKEN_TTL_DAYS, 30 dias por padrão),
//   pcKeep (60 dias, services/sessionKeep.js). NÃO existe rotina de
//   limpeza automática de dados antigos: se uma for criada, atualize a
//   seção "Quanto tempo guardamos";
// - exclusão: deleteAccount() só DESATIVA (accountDisabledAt);
// - terceiros: config/b2.js, pushNotifications (FCM),
//   youtube-nocookie (YouTubeWatch), Klipy (GifPicker), GitHub (releases),
//   mod.io/Nexus/GameBanana/Thunderstore/Steam (services/*Service.js),
//   Shard Cloud (hospedagem, projectclub.shardweb.app);
// - moderação: services/automod.js, dmAutomod.js, reportController.js,
//   middleware/honeypot.js.

const UPDATED = 'Atualizado em 12 de outubro de 2026';

function DataTable({ rows }) {
  return (
    <div className="tm-table" role="table" aria-label="Dados coletados">
      <div className="tm-row is-head" role="row">
        <span role="columnheader">Dado</span><span role="columnheader">Para quê</span><span role="columnheader">Por quanto tempo</span>
      </div>
      {rows.map(([what, why, keep]) => (
        <div className="tm-row" role="row" key={what}>
          <span role="cell"><b>{what}</b></span>
          <span role="cell">{why}</span>
          <span role="cell">{keep}</span>
        </div>
      ))}
    </div>
  );
}

function Store({ rows }) {
  return (
    <dl className="tm-store">
      {rows.map(([name, kind, d]) => (
        <div key={name}><dt><code>{name}</code><small>{kind}</small></dt><dd>{d}</dd></div>
      ))}
    </dl>
  );
}

const SECTIONS = [
  {
    id: 'resumo', group: 'Resumo', title: 'Em resumo',
    body: (
      <>
        <p className="wk-lead">A versão curta, antes dos detalhes:</p>
        <ul className="tm-short">
          <li><b>Guardamos o necessário para a comunidade funcionar:</b> conta, perfil, o que você publica e as sessões de login.</li>
          <li><b>Não vendemos dados, não mostramos anúncios e não usamos rastreadores</b> de análise ou publicidade.</li>
          <li><b>Mensagens privadas entre duas pessoas</b> só são vistas pela staff quando denunciadas ou quando acionam um gatilho de segurança.</li>
          <li><b>Chamadas de voz não são gravadas.</b></li>
          <li><b>Você pode corrigir, desativar e pedir a remoção</b> dos seus dados, como manda a LGPD.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'termos', group: 'Termos de uso', title: 'Termos de uso',
    body: (
      <>
        <p className="wk-lead">Ao criar uma conta ou usar o site, os apps de computador e o app de Android, você concorda com estes termos e com a política de privacidade abaixo.</p>
        <h3>A comunidade</h3>
        <p>O Project Club é uma comunidade privada e gratuita. A conta só existe depois que a staff aprova a sua inscrição, e a staff pode recusar uma inscrição sem precisar justificar.</p>
        <h3>Sua conta</h3>
        <p>A conta é pessoal. Você responde pelo que acontece nela, então use uma senha só sua (pelo menos 8 caracteres, com letras e números) e, se puder, ligue a verificação em duas etapas. Não compartilhe a conta nem crie contas para fugir de uma punição.</p>
        <h3>Regras de convivência</h3>
        <ul>
          <li>Trate as pessoas com respeito. Assédio, ameaça, discurso de ódio e exposição de dados de terceiros não são aceitos.</li>
          <li>Nada de spam, golpes, links maliciosos ou conteúdo ilegal.</li>
          <li>Conteúdo sexual explícito e violência gráfica não são permitidos.</li>
          <li>Não tente burlar a moderação, explorar falhas ou atrapalhar o serviço. Se achar uma falha, avise a staff pelo Suporte.</li>
        </ul>
        <h3>O que você publica</h3>
        <p>O que você posta continua sendo seu. Ao publicar, você permite que o Project Club guarde e mostre esse conteúdo para quem tem acesso a ele, só para fazer a comunidade funcionar. Publique apenas o que você tem direito de compartilhar.</p>
        <h3>Os apps</h3>
        <p>Os programas da aba Apps são versões de projetos de código aberto. Cada um segue a licença do projeto original (MIT, GPL, zlib e outras), que vale acima destes termos para o próprio programa. Eles são oferecidos como estão, sem garantia de funcionamento em todos os computadores.</p>
        <h3>Punições</h3>
        <p>Quem descumpre as regras pode receber castigo (sem mandar mensagens nem entrar em chamadas por um tempo), suspensão ou banimento, conforme a gravidade. Veja como funciona em <a href="#moderacao">Moderação</a>.</p>
      </>
    ),
  },
  {
    id: 'dados', group: 'Privacidade', title: 'Dados que coletamos',
    body: (
      <>
        <p className="wk-lead">Esta é a lista completa do que fica guardado no servidor, de onde vem e por quanto tempo.</p>
        <DataTable rows={[
          ['E-mail, nome de usuário, nome de exibição e senha', 'Criar a conta, entrar e mandar códigos e avisos. A senha nunca é guardada como texto: só um hash bcrypt.', 'Enquanto a conta existir.'],
          ['Data de nascimento e respostas da inscrição', 'A staff analisar a inscrição. A data também aparece em aniversariantes.', 'Enquanto a conta existir.'],
          ['Perfil', 'Foto, banners, bio, status, conexões e o que mais você escolher preencher, para mostrar aos outros.', 'Até você mudar ou apagar.'],
          ['Mensagens, posts, comentários, reações e enquetes', 'Entregar e exibir a conversa. Mensagens editadas guardam as versões anteriores.', 'Até você apagar. Ao apagar, o texto sai da conversa; versões anteriores de uma mensagem editada e os anexos continuam guardados.'],
          ['Arquivos enviados', 'Imagens, GIFs e anexos que você manda no chat, no perfil e no fórum.', 'Até você ou a staff removerem.'],
          ['Sessões de login', 'IP, navegador e sistema de cada aparelho conectado, com data de início e de último uso. Você vê o IP mascarado (só os dois primeiros blocos); a staff pode usar o IP completo para identificar abuso e contas duplicadas.', 'O registro fica no histórico da conta; a sessão em si expira em 30 dias sem uso.'],
          ['Registro de segurança', 'Troca de senha, sessões encerradas, e-mail alterado e conexões adicionadas, com o aparelho e um hash do IP (nunca o IP em si).', 'Enquanto a conta existir.'],
          ['Token de notificação', 'Um token por aparelho Android para entregar notificações com o app fechado.', 'Até você sair do aparelho ou o token deixar de valer.'],
          ['Economia e progresso', 'Moedas, gemas, XP, nível, conquistas, missões e o histórico de transações.', 'Enquanto a conta existir.'],
          ['Jogos (app de PC)', 'Jogos detectados no computador e tempo de jogo, para a biblioteca e o status "jogando".', 'Enquanto a conta existir.'],
          ['Denúncias e moderação', 'Denúncias, mensagens sinalizadas por gatilho, punições e o registro das ações da staff.', 'Enquanto for necessário para a segurança da comunidade.'],
          ['Erros de tela', 'Quando uma tela quebra, o app manda a mensagem do erro, o endereço da página e o trecho técnico do código. Sem dados da conversa.', 'Os últimos 50 ficam em memória e somem quando o servidor reinicia; também passam pelo log do servidor.'],
          ['Acessos a rotas-isca', 'IP, endereço e navegador de robôs que procuram painéis e arquivos sensíveis (pote de mel).', 'O bloqueio do IP vale por um período.'],
        ]} />
        <Note title="O que não coletamos">Não há ferramentas de análise, pixels de publicidade nem telemetria de uso. Chamadas de voz e telas compartilhadas não são gravadas. O seu token de acesso fica só na memória da aba, nunca no armazenamento do navegador.</Note>
      </>
    ),
  },
  {
    id: 'finalidade', group: 'Privacidade', title: 'Por que usamos',
    body: (
      <>
        <p className="wk-lead">Cada uso tem uma base na Lei Geral de Proteção de Dados (Lei 13.709/2018).</p>
        <Facts items={[
          ['Fazer o serviço funcionar', 'Conta, login, mensagens, voz, perfil e economia. Base: execução do contrato que você aceita ao se cadastrar.'],
          ['Proteger a comunidade', 'Sessões, IPs, registro de segurança, AutoMod, denúncias e pote de mel. Base: legítimo interesse em manter as contas e o serviço seguros.'],
          ['O que é opcional', 'Conexões, bio, banners, biblioteca de jogos e notificações. Base: o seu consentimento, que você retira apagando ou desligando.'],
          ['Quando a lei pedir', 'Guardar ou entregar dados a uma autoridade quando houver ordem legal. Base: cumprimento de obrigação legal.'],
        ]} />
        <p>Não usamos seus dados para publicidade, não traçamos perfil de consumo e não vendemos nem alugamos nada a ninguém.</p>
      </>
    ),
  },
  {
    id: 'retencao', group: 'Privacidade', title: 'Quanto tempo guardamos',
    body: (
      <>
        <p className="wk-lead">Os dados da conta ficam guardados enquanto a conta existir. Uma limpeza automática roda todo dia e apaga o que é temporário: sessões vencidas há mais de 30 dias, links de senha e códigos de e-mail vencidos há mais de 7 dias, códigos de recuperação já usados há mais de 90 dias, atividades com mais de 90 dias, avisos já lidos com mais de 90 dias e registros de erro sem ocorrência há mais de 30 dias.</p>
        <Facts items={[
          ['Código de verificação', '15 minutos. O que chega depois da aprovação da inscrição vale 48 horas.'],
          ['Link de nova senha', '1 hora, e só funciona uma vez.'],
          ['Sessão de login', 'O cookie expira em 30 dias sem uso. O "lembrar login" vale até 60 dias.'],
          ['Mensagem apagada', 'O texto sai da conversa na hora. Versões anteriores (se ela foi editada) e anexos continuam guardados até um pedido de remoção.'],
          ['Erros de tela', 'Os últimos 50, em memória, até o servidor reiniciar.'],
          ['Conta desativada', 'Os dados continuam guardados até você pedir a remoção (veja abaixo).'],
        ]} />
      </>
    ),
  },
  {
    id: 'direitos', group: 'Privacidade', title: 'Seus direitos',
    body: (
      <>
        <p className="wk-lead">A LGPD garante a você, a qualquer momento:</p>
        <ul className="tm-rights">
          <li><b>Confirmação e acesso</b><span>saber se tratamos seus dados e receber uma cópia deles.</span></li>
          <li><b>Correção</b><span>arrumar dados incompletos ou errados.</span></li>
          <li><b>Exclusão</b><span>pedir que dados desnecessários ou tratados com o seu consentimento sejam apagados ou anonimizados.</span></li>
          <li><b>Portabilidade</b><span>receber os seus dados num formato que dá para levar a outro serviço.</span></li>
          <li><b>Informação</b><span>saber com quem compartilhamos os dados (a lista está em <a href="#terceiros">Serviços de terceiros</a>).</span></li>
          <li><b>Revogação</b><span>retirar o consentimento do que é opcional.</span></li>
        </ul>
        <h3>Como pedir</h3>
        <Facts items={[
          ['Corrigir', 'Quase tudo se corrige sozinho em Configurações: nome, perfil, e-mail, senha e privacidade.'],
          ['Desativar a conta', 'Configurações → "Excluir conta", confirmando com a senha. A conta é desativada na hora, todas as sessões caem e ninguém mais consegue entrar nela. Para reativar, fale com a equipe.'],
          ['Cópia ou remoção dos dados', 'Abra um ticket no Suporte, dentro do app, dizendo o que você quer. Respondemos em até 15 dias.'],
          ['Sem acesso à conta', 'Use o contato do fim desta página. Não publique dados pessoais em lugar público.'],
        ]} />
        <Note>Desativar não é o mesmo que apagar: mensagens antigas continuam onde estavam para não quebrar as conversas dos outros. Se quiser que os dados sejam removidos ou anonimizados, peça pelo Suporte.</Note>
      </>
    ),
  },
  {
    id: 'cookies', group: 'Privacidade', title: 'Cookies e armazenamento local',
    body: (
      <>
        <p className="wk-lead">Usamos só dois cookies, os dois de login, e guardamos preferências no seu navegador. Nenhum cookie de publicidade ou de análise.</p>
        <Store rows={[
          ['refreshToken', 'cookie httpOnly · 30 dias', 'Renova o seu login sem pedir a senha de novo. O JavaScript da página não consegue ler, e ele só é enviado para o endereço de login do servidor.'],
          ['pcKeep', 'cookie httpOnly · até 60 dias', '"Lembrar login": criptografado e assinado pelo servidor, guarda só o seu identificador. Cai junto quando você sai de todas as sessões ou troca a senha.'],
          ['Preferências', 'armazenamento local', 'Tema, layout, zoom, estilo dos emojis, volume e fila do player, aba aberta e opções parecidas. Ficam só no seu aparelho.'],
        ]} />
        <p>O player do YouTube das chamadas usa o domínio youtube-nocookie.com, a versão do YouTube com menos cookies.</p>
      </>
    ),
  },
  {
    id: 'terceiros', group: 'Privacidade', title: 'Serviços de terceiros',
    body: (
      <>
        <p className="wk-lead">Alguns serviços externos fazem parte do funcionamento. Cada um recebe só o necessário para a sua parte.</p>
        <Facts items={[
          ['Shard Cloud', 'Hospeda o site e o servidor do Project Club.'],
          ['Backblaze B2', 'Guarda os arquivos enviados (fotos, banners, anexos). As imagens passam pelo nosso servidor antes de chegar a você, então o B2 não vê o seu IP.'],
          ['Chamadas de voz', 'Voz e tela das chamadas passam pelo servidor de mídia do próprio Project Club (nenhum provedor de voz externo). Nada é gravado.'],
          ['Firebase Cloud Messaging (Google)', 'Entrega as notificações do app de Android.'],
          ['YouTube', 'Vídeos assistidos juntos nas chamadas, o player de música e os vídeos do canal na página Início do app.'],
          ['Klipy', 'Busca de GIFs: o termo que você digita na busca de GIFs vai para eles.'],
          ['GitHub', 'Hospeda o código, os instaladores e as atualizações do app e dos programas.'],
          ['Fontes de mods', 'mod.io, Nexus Mods, GameBanana, Thunderstore e Steam, para buscar mods e capas de jogos. No ProjectMC, Modrinth e CurseForge.'],
          ['E-mail', 'Um servidor de envio de e-mail entrega códigos de verificação, links de senha e avisos de login novo.'],
        ]} />
        <p>Para montar a prévia de um link, quem visita a página é o nosso servidor, não o seu navegador.</p>
      </>
    ),
  },
  {
    id: 'seguranca', group: 'Privacidade', title: 'Segurança',
    body: (
      <>
        <p className="wk-lead">Nenhum sistema é perfeito, mas a conta tem várias camadas.</p>
        <Facts items={[
          ['Senhas', 'Guardadas só como hash bcrypt.'],
          ['Duas etapas', 'Verificação por app autenticador, com 10 códigos de recuperação de uso único guardados só como hash.'],
          ['Sessões', 'Tokens guardados como hash e trocados a cada renovação. Se um token antigo for reaproveitado, a sessão é derrubada como possível roubo.'],
          ['Avisos', 'Login de um aparelho ou rede nova gera um aviso por e-mail.'],
          ['Limites', 'Tentativas de login, de código e de cadastro têm limite por tempo.'],
          ['Prévias seguras', 'O servidor só busca links públicos e bloqueia endereços internos.'],
        ]} />
        <p>Se você perceber algo estranho na sua conta, troque a senha (isso encerra as outras sessões) e avise a staff pelo Suporte.</p>
      </>
    ),
  },
  {
    id: 'moderacao', group: 'Privacidade', title: 'Moderação e acesso da staff',
    body: (
      <>
        <p className="wk-lead">A staff vê o que é público na comunidade. Conversas privadas entre duas pessoas só chegam à staff em dois casos.</p>
        <Facts items={[
          ['Visível para a staff', 'Canais da comunidade, fórum, chats de clã e grupos, com as imagens e GIFs enviados neles.'],
          ['Privado', 'DMs entre duas pessoas. Só são vistas quando denunciadas ou quando acionam um gatilho.'],
          ['Canais públicos', 'O AutoMod barra na hora spam, links não permitidos, palavras bloqueadas e envio em excesso.'],
          ['DMs', 'A mensagem é entregue normalmente. Se tiver uma palavra sinalizada, fica registrada para revisão, sem ninguém entrar na conversa por isso.'],
        ]} />
        <h3>Como funciona a revisão</h3>
        <ol className="tm-flow">
          <li>Uma mensagem é sinalizada por gatilho ou denunciada pelo menu dela.</li>
          <li>Alguém da staff analisa. Numa DM, só o necessário da conversa para entender o contexto. Ninguém envolvido é avisado da análise.</li>
          <li>A staff decide se houve infração.</li>
          <li>Se houve, aplica castigo ou banimento conforme a gravidade.</li>
        </ol>
      </>
    ),
  },
  {
    id: 'menores', group: 'Privacidade', title: 'Menores de idade',
    body: (
      <>
        <p>A inscrição pede a data de nascimento, e a staff leva a idade em conta na análise. Se você tem menos de 18 anos, use o Project Club com o conhecimento de um responsável.</p>
        <p>Pais e responsáveis podem pedir acesso, correção ou remoção dos dados de um menor pelo contato abaixo. Dados de crianças e adolescentes são tratados no melhor interesse deles, como pede o artigo 14 da LGPD.</p>
      </>
    ),
  },
  {
    id: 'mudancas', group: 'Final', title: 'Mudanças nestes termos',
    body: (
      <p>Quando algo mudar aqui, a data no topo muda junto. Mudanças importantes, como um novo serviço de terceiros ou um novo tipo de dado, também são avisadas nos Anúncios da comunidade antes de valerem.</p>
    ),
  },
  {
    id: 'contato', group: 'Final', title: 'Contato',
    body: (
      <>
        <p>Para qualquer pedido sobre os seus dados ou sobre estes termos, abra um ticket no <b>Suporte</b>, dentro do app. É o canal mais rápido, e a conversa fica registrada só entre você e a staff.</p>
        <p>Sem acesso à conta, abra uma issue no <a href="https://github.com/RiqueBitt/ProjectClub/issues" target="_blank" rel="noreferrer">repositório do Project Club no GitHub</a> pedindo contato, sem escrever dados pessoais nela, e a staff responde por um canal privado.</p>
        <p className="tm-back"><Link to="/blog">Quer saber como cada parte funciona? Leia o Blog.</Link></p>
      </>
    ),
  },
];

function HeroArt() {
  return (
    <div className="tm-badges" aria-hidden="true">
      <div><strong>0</strong><span>anúncios e rastreadores</span></div>
      <div><strong>2</strong><span>cookies, os dois de login</span></div>
      <div><strong>bcrypt</strong><span>para as senhas</span></div>
      <div><strong>LGPD</strong><span>acesso, correção e exclusão</span></div>
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <DocShell
      page="termos"
      kicker="Termos de uso e política de privacidade"
      title="Termos de privacidade"
      lede="O que você combina com a gente ao usar o Project Club, quais dados ficam guardados, por quanto tempo e como pedir uma cópia, uma correção ou a exclusão."
      meta={UPDATED}
      heroArt={<HeroArt />}
      sections={SECTIONS}
    />
  );
}
