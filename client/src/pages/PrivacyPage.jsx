import { useNavigate } from 'react-router-dom';
import logo from '../assets/icons/logo-project-club.png';

// Página pública de transparência — "Proteção e Privacidade" + "Sistema
// de segurança e denúncia", linkada no rodapé da LandingPage. Reusa as
// classes .landing-* já existentes (mesmo fundo/nav/tipografia da home)
// pra não introduzir um segundo estilo visual só pra esta página —
// só o conteúdo central muda pra um layout de artigo (mais estreito,
// pensado pra leitura de texto corrido em vez de seções de marketing).
//
// Conteúdo escrito a partir do que o servidor realmente faz hoje — cada
// afirmação aqui foi conferida contra o código antes de publicar:
// - Dados de acesso: authController.js (email), canais públicos são
//   sempre visíveis à staff (mensagens/imagens/gifs, inclusive clãs/
//   grupos — não são privados).
// - Sem telemetria/IP: não há nenhum serviço de analytics/tracking no
//   projeto; honeypot.js registra IP só de quem bate em rotas-isca
//   (scanners), não de uso normal.
// - Chamadas de voz: Agora.io é usado só pra transporte em tempo real,
//   não há gravação/armazenamento de áudio em lugar nenhum do código.
// - 2FA: authController.js (ativar/desativar, verificação no login) —
//   real e funcional.
// - Gatilhos de canal público: services/automod.js — automático (a
//   staff já tem acesso a canais públicos de qualquer forma, então
//   bloquear na hora protege sem violar privacidade nenhuma).
// - Gatilhos de DM: services/dmAutomod.js + model AutomodFlag — a
//   mensagem É enviada normalmente, só fica sinalizada pra staff
//   revisar depois (revisão manual de verdade, não automática).
// - Denúncia manual: controllers/reportController.js + model Report —
//   qualquer usuário pode denunciar uma mensagem de canal ou DM.
// - Punição após revisão: hoje é um passo separado da resolução do
//   caso — a staff marca "ação tomada" e aplica o castigo/banimento
//   pelo menu de Usuários, não é uma única ação automática.
// - Pote de Mel: middleware/honeypot.js — sistema à parte, de defesa
//   de infraestrutura contra bots/scanners tentando achar painéis de
//   admin falsos; não tem relação com moderação de mensagens.
export default function PrivacyPage() {
  const navigate = useNavigate();

  return (
    <div className="landing-page">
      <div className="landing-bg-grid" />

      <nav className="landing-nav">
        <div className="landing-brand" style={{ cursor: 'pointer' }} onClick={() => navigate('/')}>
          <img className="landing-brand-mark" src={logo} alt="" /><span>PROJECT CLUB</span>
        </div>
        <button className="landing-nav-cta" onClick={() => navigate('/login')}>Entrar</button>
      </nav>

      <main>
        <section className="legal-doc">
          <h1>Proteção e Privacidade</h1>
          <p className="legal-doc-updated">Como o Project Club lida com os dados e mensagens da comunidade.</p>

          <h2>🟢 Dados que temos acesso</h2>
          <p><em>Clãs e grupos não são privados — temos acesso a eles como qualquer outro canal público.</em></p>
          <ul>
            <li>E-mail</li>
            <li>Mensagens de canais públicos (Comunidade, Clãs, Feeds e Grupos)</li>
            <li>Imagens e GIFs enviados em canais públicos</li>
          </ul>

          <h2>🔴 Dados que não temos acesso</h2>
          <p><em>Não existe telemetria de dados na plataforma — essa função nem existe aqui.</em></p>
          <ul>
            <li>Endereço de IP</li>
            <li>Gravações ou registros de chamadas de voz</li>
            <li>
              Fotos, mensagens e mensagens de voz de chats privados
              (só temos acesso caso sejam denunciadas ou acionem nosso sistema de gatilhos — ver abaixo)
            </li>
          </ul>

          <h2>🔐 Implementações de segurança</h2>
          <ul>
            <li><b>Autenticação de dois fatores (2FA)</b> — pode ser ativada nas configurações da conta.</li>
          </ul>

          <h2>Sistema de segurança e denúncia</h2>
          <p>
            As únicas mensagens privadas que existem são as de chats privados entre amigos.
            Só temos acesso a uma mensagem privada quando ela é <b>denunciada</b> por alguém
            ou aciona nosso <b>sistema de gatilhos</b> — nunca por acompanhamento de rotina.
          </p>

          <h3>Gatilhos</h3>
          <p>
            Em canais públicos, certas mensagens (spam, links não permitidos, palavras
            bloqueadas, envio excessivo) são bloqueadas automaticamente no momento do envio —
            já que a staff tem acesso normal a canais públicos de qualquer forma, isso protege
            a comunidade sem precisar de revisão antes.
          </p>
          <p>
            Em mensagens privadas, o critério é mais conservador: a mensagem é enviada
            normalmente (quem manda e quem recebe não percebem nada diferente), mas se
            contiver uma palavra sinalizada, fica registrada para um membro da staff revisar
            depois — sem entrar na conversa a menos que isso aconteça.
          </p>

          <h3>Formulário de denúncia</h3>
          <p>
            Qualquer mensagem, de canal público ou privado, pode ser denunciada diretamente
            pelo menu de ações dela, com um motivo. A denúncia entra na mesma fila de revisão
            manual da staff.
          </p>

          <h3>Como funciona a revisão</h3>
          <ol>
            <li>Uma mensagem é sinalizada (por gatilho) ou denunciada por alguém.</li>
            <li>Um membro da staff analisa o caso — no caso de mensagem privada, só o
              necessário da conversa para entender o contexto, e ninguém envolvido é avisado
              dessa análise.</li>
            <li>A staff decide se a mensagem é uma infração ou está segura.</li>
            <li>
              Se for uma infração, a staff aplica a penalidade conforme a gravidade:{' '}
              <b>Castigo</b> (fica temporariamente impedido de enviar mensagens ou entrar em
              chamadas) ou <b>Banimento</b>.
            </li>
          </ol>

          <h3>Pote de mel (Honeypot)</h3>
          <p>
            Sistema à parte, sem relação com mensagens de usuários — defende a infraestrutura
            contra bots e scanners automatizados que tentam encontrar painéis administrativos,
            arquivos de configuração ou credenciais vazadas. Qualquer tentativa de acesso a
            essas rotas-isca bloqueia o IP de origem automaticamente por um período.
          </p>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-footer-col">
          <div className="landing-footer-brand landing-pixel">PROJECT CLUB</div>
          <div className="landing-footer-note">Feito pela comunidade, para a comunidade.</div>
        </div>
      </footer>
    </div>
  );
}
