import { Link } from 'react-router-dom';
import coinIcon from '../../assets/icons/currency-coin.png';
import gemIcon from '../../assets/icons/gem.png';

// Conteúdo do Blog (/blog): o guia do Project Club inteiro numa página.
// Tudo aqui foi conferido no código antes de entrar no texto:
// - recursos desligados em utils/features.js (casas, figurinhas
//   colecionáveis, navegador, filmes e séries, Guerra das Cartas)
//   aparecem como "em breve", nunca como se funcionassem;
// - textos dos apps vêm de server/src/services/builtinApps.js
//   (BUILTIN_APPS e LEGACY_APP_PAGES);
// - economia: services/economy.js e data/chestsCatalog.js; níveis:
//   data/levelsCatalog.js; missões: services/missions.js;
// - conta: controllers/authController.js e applicationsController.js;
// - chat: ChannelSearchPanel.jsx (filtros), services/unfurl.js (prévia),
//   model MessageEdit (histórico de edição), Poll, Reaction.
// Ao mudar uma funcionalidade, atualize o trecho correspondente aqui.

// ---------- Pecinhas de layout ----------
export function Facts({ items }) {
  return (
    <dl className="wk-facts">
      {items.map(([t, d]) => <div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}
    </dl>
  );
}
export function Fig({ src, alt, caption, wide = false, ratio }) {
  return (
    <figure className={`wk-fig ${wide ? 'is-wide' : ''}`}>
      <img src={src} alt={alt} loading="lazy" decoding="async" width="1600" height="1000" style={ratio ? { aspectRatio: ratio } : undefined} />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
export function Gallery({ items, cols = 2 }) {
  return (
    <div className={`wk-gallery is-${cols}`}>
      {items.map((it) => <Fig key={it.src} {...it} />)}
    </div>
  );
}
export function Note({ title, children, tone }) {
  return (
    <aside className={`wk-note ${tone ? `is-${tone}` : ''}`}>
      {title && <strong>{title}</strong>}
      <div>{children}</div>
    </aside>
  );
}
export function Soon({ children = 'Em breve' }) {
  return <span className="wk-soon">{children}</span>;
}
function Steps({ items }) {
  return (
    <ol className="wk-steps">
      {items.map(([t, d]) => <li key={t}><strong>{t}</strong><span>{d}</span></li>)}
    </ol>
  );
}
function Keys({ rows }) {
  return (
    <dl className="wk-keys">
      {rows.map(([k, d]) => (
        <div key={k}>
          <dt>{k.split(' + ').map((part, i) => <span key={part}>{i > 0 && <i>+</i>}<kbd>{part}</kbd></span>)}</dt>
          <dd>{d}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------- Apps (aba Apps) ----------
export const GUIDE_APPS = [
  {
    id: 'gameproject', name: 'GameProject', what: 'Criação de jogos 2D e 3D', color: '#818CF8', base: 'Godot Engine', license: 'MIT', version: '1.0.0',
    text: 'Monte jogos 2D e 3D num editor completo, com cenas, física, animação, interface, áudio e scripts. Teste com um clique e exporte para várias plataformas.',
    features: ['Editor visual de cenas 2D e 3D com nós e cenas reutilizáveis', 'GDScript, parecido com Python, com autocompletar e depurador', 'Física, navegação, partículas, iluminação e pós-processamento', 'Editor de animação, tilemaps e interface com temas', 'Roda o jogo dentro do editor e exporta para Windows, Linux, Android e Web'],
    shot: '09-jogo-rodando', shotAlt: 'GameProject com um jogo rodando dentro do editor',
  },
  {
    id: 'photoproject', name: 'PhotoProject', what: 'Editor de imagem', color: '#A855F7', base: 'Patchy Image Editor', license: 'MIT', version: '0.98.3',
    text: 'Retoque fotos, monte artes com camadas, edite arquivos do Photoshop (PSD e PSB) e automatize tarefas.',
    features: ['Abre e salva PSD/PSB com camadas, máscaras, estilos, texto e vetores editáveis', 'Smart Objects, Smart Filters e ajustes não destrutivos', 'Curvas, níveis, matiz e saturação e dezenas de filtros', 'Pincéis, seleção, clonagem, correção, liquify e gradientes', 'Camera RAW, HEIF/AVIF, WebP, JPEG XL, TIFF, PNG, SVG e PDF'],
    shot: '08-pincel-camadas', shotAlt: 'PhotoProject com o pincel e o painel de camadas',
  },
  {
    id: 'projectmc', name: 'ProjectMC', what: 'Launcher de Minecraft', color: '#A3E635', base: 'X Minecraft Launcher', license: 'MIT', version: '1.6.0',
    text: 'Organize instâncias, instale mods, modpacks, resource packs e shaders e entre no jogo com a sua conta, tudo num lugar só.',
    features: ['Instâncias isoladas, cada uma com versão, mods e configurações próprias', 'Instala Forge, NeoForge, Fabric, Quilt e OptiFine sozinho', 'Mods, modpacks, resource packs e shaders do Modrinth e do CurseForge', 'Login com conta Microsoft, várias contas e skins', 'Escolhe o Java certo para cada versão do jogo'],
    shot: '08-loja-de-mods', shotAlt: 'Loja de mods do ProjectMC',
  },
  {
    id: 'hyproject', name: 'HyProject', what: 'Launcher de Hytale', color: '#FACC15', base: 'HyPrism', license: 'GPL v3', version: '1.1.0',
    text: 'Instale e atualize o jogo, organize perfis, gerencie mods e acompanhe as novidades.',
    features: ['Instala, atualiza e repara o jogo', 'Vários perfis, cada um com seus mods e configurações', 'Busca, instala, atualiza e liga ou desliga mods', 'Notícias e notas de atualização dentro do launcher', 'Memória, resolução e argumentos de inicialização ajustáveis'],
    shot: '07-painel', shotAlt: 'Painel inicial do HyProject',
  },
  {
    id: 'davinciproject', name: 'CutProject', what: 'Editor de vídeo', color: '#F87171', base: 'Sprocket', license: 'MIT', version: '1.1.0',
    text: 'Monte vídeos com várias faixas, corte, aplique efeitos, títulos e transições, corrija as cores e exporte para as redes ou em alta qualidade.',
    features: ['Linha do tempo multipista não destrutiva, com encaixe e zoom', 'Qualquer formato de sequência, inclusive vertical', 'Efeitos na GPU com keyframes, títulos e transições', 'Correção de cor com rodas, curvas, HSL e LUTs', 'Salvamento automático e recuperação depois de uma falha'],
    shot: '03-clipe-selecionado', shotAlt: 'CutProject com um clipe selecionado na linha do tempo',
  },
  {
    id: 'waveproject', name: 'WaveProject', what: 'Editor de áudio', color: '#22D3EE', base: 'Audacity 4', license: 'GPL v3', version: '1.0.0',
    text: 'Grave, corte, mixe e aplique efeitos em músicas, podcasts e vozes.',
    features: ['Gravação de microfone e entrada de linha com medidores', 'Edição multipista: cortar, copiar, dividir e mover clipes', 'Efeitos em tempo real: equalizador, compressor, reverb e redução de ruído', 'Forma de onda e espectrograma', 'WAV, MP3, FLAC, OGG, AIFF e Opus; plugins VST3, LV2 e Nyquist'],
    shot: '11-efeitos-em-tempo-real', shotAlt: 'WaveProject aplicando efeitos em tempo real',
  },
  {
    id: 'texelproject', name: 'TexelProject', what: 'Pintura de texturas 3D', color: '#FB923C', base: 'ArmorPaint', license: 'zlib', version: '1.0.0',
    text: 'Pinte direto em modelos 3D com materiais PBR, camadas, máscaras e pincéis, e exporte as texturas para jogos, mods e renders.',
    features: ['Pintura em tempo real sobre OBJ, FBX, glTF/GLB e BLEND', 'Materiais PBR e editor de nós', 'Camadas, grupos, máscaras e modos de mistura', 'Vista 2D da textura e vista 3D com iluminação HDR', 'Exporta com predefinições para Unreal, Unity e glTF'],
    shot: '08-vista-de-cima', shotAlt: 'Modelo 3D pintado no TexelProject',
  },
  {
    id: 'forgeproject', name: 'ForgeProject', what: 'Modelagem e render 3D', color: '#4ADE80', base: 'Bforartists e Blender', license: 'GPL', version: '1.0.0',
    text: 'Modelagem, escultura, UV, materiais, animação, simulação, render, composição e edição de vídeo.',
    features: ['Modelagem, modificadores, nós de geometria e escultura', 'Animação com esqueleto e editor de gráficos', 'Render Cycles (path tracing) e EEVEE (tempo real)', 'Física de tecido, fluidos, partículas e corpos rígidos', 'Importa e exporta FBX, OBJ, glTF, USD, STL e Alembic'],
    shot: '07-shading', shotAlt: 'Aba de shading do ForgeProject',
  },
  {
    id: 'canvasproject', name: 'CanvasProject', what: 'Pintura digital', color: '#F472B6', base: 'Krita 6', license: 'GPL v3', version: '1.0.0',
    text: 'Pincéis realistas, camadas, mesa digitalizadora, animação quadro a quadro, quadrinhos e pixel art.',
    features: ['Mais de 100 pincéis prontos e vários motores de pincel', 'Camadas de pintura, vetor, filtro e máscaras', 'Estabilizador de traço e assistentes de perspectiva', 'Animação quadro a quadro com papel cebola', 'Abre e salva KRA, PSD, PNG, JPEG, WebP, TIFF e EXR'],
    shot: '06-predefinicoes-de-pincel', shotAlt: 'Predefinições de pincel do CanvasProject',
  },
];

function AppsGuide() {
  return (
    <div className="wk-apps">
      {GUIDE_APPS.map((a) => (
        <article key={a.id} id={`app-${a.id}`} className="wk-app" style={{ '--c': a.color }}>
          <header>
            <img className="wk-app-icon" src={`/apps/${a.id}/icon.png`} alt="" width="56" height="56" loading="lazy" />
            <div>
              <h3>{a.name}</h3>
              <p>{a.what} · base {a.base} ({a.license}) · versão {a.version}</p>
            </div>
          </header>
          <img className="wk-app-shot" src={`/apps/${a.id}/shots/${a.shot}.jpg`} alt={a.shotAlt} loading="lazy" decoding="async" width="1600" height="1000" />
          <p className="wk-app-text">{a.text}</p>
          <ul>{a.features.map((f) => <li key={f}>{f}</li>)}</ul>
        </article>
      ))}
    </div>
  );
}

const MINIGAMES = [
  { src: '/minigames/pizzatron/cover.webp', alt: 'Capa do Pizzatron 3000', caption: 'Pizzatron 3000' },
  { src: '/minigames/sledracing/cover.webp', alt: 'Capa da Corrida de Trenó', caption: 'Corrida de Trenó' },
  { src: '/minigames/beancounters/cover.webp', alt: 'Capa do Pilha de Café', caption: 'Pilha de Café' },
  { src: '/minigames/flash/thinice/cover.webp', alt: 'Capa do Thin Ice', caption: 'Um dos fliperamas em Flash' },
];

// ---------- Seções ----------
// group: agrupa o índice lateral. Cada seção vira <section id={id}>.
export const GUIDE_SECTIONS = [
  {
    id: 'o-que-e', group: 'Começo', title: 'O que é o Project Club',
    body: (
      <>
        <p className="wk-lead">O Project Club é duas coisas que funcionam juntas: uma comunidade com chat, voz, fórum e amigos, e um app para computador que instala programas de criação com o nome e a cara do clube.</p>
        <p>A comunidade é uma só. Não existe criar servidor nem entrar em servidor de convite: todo mundo aprovado entra no mesmo lugar, com canais organizados pela staff. Ela funciona no navegador, no app de Windows e Linux e no app de Android.</p>
        <p>Os programas são versões de projetos de código aberto conhecidos (Godot, Krita, Blender, Audacity e outros), com tema do Project Club, interface em português e atualizações pela aba Apps. Tudo é gratuito: não tem plano pago nem anúncio.</p>
        <Gallery cols={3} items={[
          { src: '/apps/gameproject/banner.jpg', alt: 'Banner do GameProject', ratio: '16 / 5' },
          { src: '/apps/canvasproject/banner.jpg', alt: 'Banner do CanvasProject', ratio: '16 / 5' },
          { src: '/apps/forgeproject/banner.jpg', alt: 'Banner do ForgeProject', ratio: '16 / 5' },
        ]} />
      </>
    ),
  },
  {
    id: 'conta', group: 'Começo', title: 'Conta e inscrição',
    body: (
      <>
        <p className="wk-lead">O Project Club é uma comunidade privada. A conta só é criada depois que a staff aprova a sua inscrição.</p>
        <Steps items={[
          ['Inscrição', 'Você preenche e-mail, nome de usuário, nome de exibição, senha e data de nascimento, e responde um questionário curto: como conheceu o clube, interesses, o que você faz e por que quer entrar (pelo menos 20 caracteres).'],
          ['Análise', 'A staff lê a inscrição e aprova ou recusa. Enquanto isso, nada de conta.'],
          ['Primeiro login', 'Aprovada a inscrição, a conta nasce e um código de verificação vai para o seu e-mail. Ele vale por 48 horas, e dá para pedir outro na tela de verificação.'],
          ['Pronto', 'Com o e-mail confirmado, a comunidade inteira fica liberada.'],
        ]} />
        <h3>Verificação em duas etapas</h3>
        <p>Em Configurações, você liga a verificação em duas etapas com um app autenticador (códigos de 6 dígitos que mudam a cada 30 segundos). A partir daí, o login pede a senha e o código.</p>
        <p>Ao ligar, você recebe <b>10 códigos de recuperação</b> de uso único. Eles aparecem uma vez só: guarde num lugar seguro. Se perder o celular, um desses códigos entra no lugar do código do app. Dá para gerar uma lista nova a qualquer momento, e a antiga deixa de valer.</p>
        <h3>Sessões e aparelhos</h3>
        <Facts items={[
          ['Lista de sessões', 'Mostra cada aparelho conectado, com navegador, sistema e um IP parcial (os dois primeiros blocos), para você reconhecer a sua rede.'],
          ['Encerrar', 'Derrube uma sessão específica ou todas as outras de uma vez.'],
          ['Login novo', 'Entrar de um aparelho ou rede diferente gera um aviso por e-mail.'],
          ['Troca de senha', 'Trocar a senha encerra as outras sessões e invalida links de "esqueci a senha" pendentes.'],
        ]} />
      </>
    ),
  },
  {
    id: 'comunidade', group: 'Comunidade', title: 'Comunidade',
    body: (
      <>
        <p className="wk-lead">Tudo acontece num lugar só, organizado em categorias e canais. A staff decide a estrutura, os cargos e as regras.</p>
        <Facts items={[
          ['Canais', 'De texto e de voz, agrupados em categorias. Canais podem ter tópico e modo lento (um intervalo mínimo entre mensagens).'],
          ['Cargos', 'Cada cargo tem cor, posição e um conjunto de permissões. Canais podem ter permissões próprias por cargo, e cargos destacados aparecem separados na lista de membros.'],
          ['Fórum', 'Em Comunidades ficam os fóruns por tema, com categorias, posts de texto ou imagem, votos e comentários com respostas.'],
          ['Eventos', 'A staff cria eventos com banner, data e descrição. Você confirma presença e recebe um lembrete pouco antes de começar.'],
          ['Anúncios', 'Avisos importantes aparecem numa faixa no topo e ficam guardados na página de Anúncios.'],
          ['Galeria e atividade', 'A galeria junta as imagens da comunidade em álbuns; a aba Atividade mostra o que a comunidade anda fazendo, com reações de incentivo.'],
        ]} />
        <p>Dúvidas e problemas vão para o <b>Suporte</b>: você abre um ticket, conversa com a staff numa linha própria e acompanha o status até a resposta.</p>
      </>
    ),
  },
  {
    id: 'chat', group: 'Comunidade', title: 'Chat',
    body: (
      <>
        <p className="wk-lead">O chat funciona em tempo real: mensagens, reações e digitação aparecem na hora, sem recarregar.</p>
        <Facts items={[
          ['Respostas', 'Responda uma mensagem específica; a original aparece citada em cima.'],
          ['Reações', 'Reaja com emojis, inclusive os personalizados da comunidade.'],
          ['Enquetes', 'Crie uma enquete com opções e acompanhe os votos ao vivo.'],
          ['Figurinhas e GIFs', 'As figurinhas da comunidade e uma busca de GIFs ficam no próprio campo de mensagem. Dá para favoritar GIFs.'],
          ['Prévia de links', 'Links ganham um cartão com título, descrição e imagem da página.'],
          ['Encaminhar', 'Mande uma mensagem para outro canal ou conversa sem copiar e colar.'],
          ['Edição com histórico', 'Mensagens editadas mostram que foram editadas, e as versões anteriores ficam registradas.'],
          ['Menções', 'Marque pessoas ou cargos (e @everyone, para quem pode); quem foi marcado recebe notificação.'],
        ]} />
        <h3>Busca com filtros</h3>
        <p>A busca de cada canal aceita filtros junto com o texto. Também valem as versões em português: <code>de:</code>, <code>tem:</code>, <code>antes:</code> e <code>depois:</code>.</p>
        <dl className="wk-codes">
          <div><dt><code>from:@nome</code></dt><dd>Só mensagens de uma pessoa.</dd></div>
          <div><dt><code>has:image</code></dt><dd>Com imagem. Também <code>has:file</code>, <code>has:link</code> e <code>has:video</code>.</dd></div>
          <div><dt><code>before:2026-10-01</code></dt><dd>Enviadas antes da data (AAAA-MM-DD).</dd></div>
          <div><dt><code>after:2026-09-01</code></dt><dd>Enviadas depois da data.</dd></div>
        </dl>
        <p className="wk-example">Exemplo: <code>render from:@lia has:image after:2026-09-01</code></p>
      </>
    ),
  },
  {
    id: 'dms', group: 'Comunidade', title: 'DMs e grupos',
    body: (
      <>
        <p className="wk-lead">Conversas diretas com uma pessoa ou em grupo, com os mesmos recursos do chat da comunidade.</p>
        <Facts items={[
          ['Grupos', 'Junte várias pessoas numa conversa com nome e ícone. Quem cria é o dono; se sair, a posse passa para o membro mais antigo.'],
          ['Visto', 'Numa DM entre duas pessoas aparece "Visto" quando a outra pessoa lê. Desligando nas configurações, você também deixa de ver o dos outros.'],
          ['Quem pode te chamar', 'Escolha entre todos, só amigos, amigos e quem está no seu clã, ou ninguém.'],
          ['Bloqueio', 'Bloquear vale nos dois sentidos: nenhum dos dois consegue abrir ou mandar DM para o outro.'],
        ]} />
        <Note title="Privacidade das DMs">A staff não acompanha conversas privadas. Uma DM só é vista por alguém da staff quando é denunciada ou quando aciona um gatilho de segurança. Os detalhes estão nos <Link to="/termos#moderacao">Termos de privacidade</Link>.</Note>
      </>
    ),
  },
  {
    id: 'voz', group: 'Comunidade', title: 'Voz e chamadas',
    body: (
      <>
        <p className="wk-lead">Canais de voz na comunidade, chamadas nas DMs e nos grupos, e a sala do seu clã.</p>
        <Facts items={[
          ['Entrar e sair', 'Clique num canal de voz para entrar. Quem está falando acende na lista.'],
          ['Compartilhar tela', 'No navegador do computador e no app de Android.'],
          ['Soundboard', 'Sons curtos que a comunidade pode tocar durante a chamada.'],
          ['Assistir juntos', 'Vídeos do YouTube tocam sincronizados para todo mundo da chamada (veja mais abaixo).'],
          ['Segundo plano', 'No Android a chamada continua com a tela apagada ou em outro app.'],
          ['Diagnóstico', 'Um medidor ao vivo ajuda a achar o microfone certo antes de entrar.'],
        ]} />
        <p>Chamadas não são gravadas. O áudio passa por um serviço de transmissão em tempo real e não fica guardado em lugar nenhum.</p>
      </>
    ),
  },
  {
    id: 'perfil', group: 'Você', title: 'Amigos e perfil',
    body: (
      <>
        <p className="wk-lead">O perfil é seu cartão de visita, e a lista de amigos decide quem vê o quê.</p>
        <Facts items={[
          ['Amigos', 'Pedidos de amizade, lista com quem está online e bloqueio.'],
          ['Molduras e efeitos', 'Molduras de avatar e efeitos de perfil da Loja, equipados quando você quiser.'],
          ['Dois banners', 'Um para o perfil completo e outro para o miniperfil, cada um com enquadramento próprio. GIF também vale.'],
          ['Avatar em GIF', 'Fotos de perfil animadas funcionam no chat, no perfil e na lista de membros.'],
          ['Status', 'Online, ausente, não perturbe ou invisível (você aparece offline para os outros), mais um status personalizado com texto.'],
          ['Mural', 'Recados, depoimentos, fãs, fotos, enquetes de perfil e votos de características, do jeito das redes antigas.'],
          ['Conexões', 'Mostre seus perfis em outras redes, se quiser.'],
          ['Privacidade', 'O perfil completo pode ficar aberto a todos, a amigos e clã ou só a amigos; a atividade também pode ficar escondida.'],
        ]} />
      </>
    ),
  },
  {
    id: 'economia', group: 'Você', title: 'Economia e progresso',
    body: (
      <>
        <p className="wk-lead">Moedas e gemas compram itens na Loja. Você ganha participando.</p>
        <div className="wk-currency">
          <div><img src={coinIcon} alt="" width="40" height="40" loading="lazy" /><strong>Moedas</strong><span>Vêm do baú diário, das missões e das recompensas de nível.</span></div>
          <div><img src={gemIcon} alt="" width="40" height="40" loading="lazy" /><strong>Gemas</strong><span>Mais raras: vêm principalmente do Mega Baú.</span></div>
        </div>
        <Facts items={[
          ['Baú diário', 'Uma vez a cada 24 horas. Sai um baú aleatório, do Comum ao Ultra Lendário, cada um com uma faixa de moedas.'],
          ['Mega Baú', 'Resgate o baú diário 5 vezes seguidas (sem passar de 48 horas entre um e outro) e ganhe de 1 a 6 gemas.'],
          ['Loja', 'Molduras de avatar, efeitos de perfil e coleções, algumas com oferta por tempo limitado.'],
          ['Missões', 'Diárias e semanais: mandar mensagens, reagir, ficar em call, postar e comentar no fórum, visitar a Loja, abrir o baú. Elas reiniciam à meia-noite de Brasília.'],
          ['Níveis', '200 níveis de conta. Mensagens com conteúdo de verdade dão XP (com um intervalo entre elas para não valer spam), e alguns níveis dão moedas.'],
          ['Conquistas', 'Ligadas aos posts, ao perfil, às amizades e ao nível, com raridades e destaque no perfil.'],
        ]} />
        <p>As figurinhas colecionáveis (álbum e cápsulas) e a Guerra das Cartas estão desligadas por enquanto <Soon />. As figurinhas do chat continuam funcionando.</p>
      </>
    ),
  },
  {
    id: 'casas', group: 'Você', title: 'Casas',
    body: (
      <>
        <p className="wk-lead">Casas com móveis, mapas de fundo, curtidas e comentários de visitantes. <Soon /></p>
        <p>O sistema de casas existe no código, mas está desligado para toda a comunidade enquanto é revisado. Quando voltar, aparece no menu e no anúncio da comunidade.</p>
      </>
    ),
  },
  {
    id: 'clas', group: 'Você', title: 'Clãs',
    body: (
      <>
        <p className="wk-lead">Um clã é um grupo fixo dentro da comunidade, com chat, chamada e cargos próprios.</p>
        <Facts items={[
          ['Cargos fixos', 'Dono, subdono, admin, moderador e membro. Cada um pode só o que o cargo permite, conferido no servidor.'],
          ['Entrada', 'O clã pode ser público, só para amigos ou só por convite. Pedidos de entrada passam pela liderança.'],
          ['Identidade', 'Nome, descrição, ícone e cor, além da tag do clã que pode aparecer junto do seu nome.'],
          ['Conversa', 'Chat do clã e uma sala de voz só para os membros.'],
        ]} />
      </>
    ),
  },
  {
    id: 'minijogos', group: 'Diversão', title: 'Minijogos',
    body: (
      <>
        <p className="wk-lead">Minijogos que já vêm no Project Club e rodam direto na página, sem instalar nada.</p>
        <p>São recriações feitas por fãs dos minijogos do Club Penguin: três em HTML5 (Pizzatron 3000, Corrida de Trenó e Pilha de Café) e uma coleção de fliperamas em Flash, que rodam por um emulador embutido. Os jogos são separados por categoria (ação, casual, corrida, puffles, arcade e música) e têm placar.</p>
        <Gallery cols={2} items={MINIGAMES.map((m) => ({ ...m, ratio: '16 / 9' }))} />
      </>
    ),
  },
  {
    id: 'assistir-juntos', group: 'Diversão', title: 'Cinema e YouTube juntos',
    body: (
      <>
        <p className="wk-lead">Dentro de uma chamada de voz, qualquer pessoa pode abrir um vídeo do YouTube para todo mundo assistir junto.</p>
        <p>O vídeo fica sincronizado: play, pausa e a posição valem para todos, e quem atrasar mais de um segundo e meio é corrigido sozinho. Tem fila de vídeos, busca, vídeos relacionados e legendas. O volume é só seu.</p>
        <p>Também existe um player de música pessoal com fila, que toca do YouTube Music enquanto você usa o resto do app.</p>
        <p>A área de Filmes e Séries está desligada por enquanto <Soon />.</p>
      </>
    ),
  },
  {
    id: 'biblioteca', group: 'Diversão', title: 'Biblioteca de jogos',
    body: (
      <>
        <p className="wk-lead">A biblioteca junta os jogos instalados no seu computador e o tempo que você passa em cada um.</p>
        <p>O app de PC encontra os jogos instalados (inclusive os da Steam), busca as capas e conta o tempo de jogo. O que você está jogando pode aparecer no seu status, e dá para abrir a biblioteca de um amigo. A visibilidade da atividade segue a sua escolha de privacidade.</p>
      </>
    ),
  },
  {
    id: 'mods', group: 'Diversão', title: 'Mods e modpacks',
    body: (
      <>
        <p className="wk-lead">A aba Mods busca mods de vários lugares numa tela só e o app de PC instala na pasta do jogo.</p>
        <Facts items={[
          ['Fontes', 'mod.io, Nexus Mods, GameBanana, Thunderstore e a Oficina da Steam.'],
          ['Instalação', 'O app baixa o mod sob demanda, instala no jogo certo e descarta o arquivo temporário. Os arquivos de mod nunca ficam nos nossos servidores.'],
          ['Perfis e coleções', 'Monte perfis de mods por jogo e coleções para reaproveitar.'],
          ['Modpacks', 'Compartilhe um modpack com a comunidade, com votos e contagem de downloads.'],
          ['Comunidade', 'Favoritos, ups, comentários e denúncia de mods.'],
        ]} />
        <Fig src="/apps/projectmc/shots/08-loja-de-mods.jpg" alt="Loja de mods do ProjectMC" caption="Para Minecraft, o ProjectMC tem a própria loja, com Modrinth e CurseForge." />
      </>
    ),
  },
  {
    id: 'apps', group: 'Apps', title: 'Aba Apps',
    body: (
      <>
        <p className="wk-lead">Nove programas de criação, instalados e atualizados pelo app de computador. Cada um tem uma página com descrição, capturas reais, tamanho e requisitos de Windows e Linux.</p>
        <p>Todos rodam em Windows 10 ou 11 (64 bits) e em Linux (AppImage). O código de cada um fica público no GitHub, com os créditos e a licença do projeto original.</p>
        <AppsGuide />
      </>
    ),
  },
  {
    id: 'app-pc', group: 'Aparelhos', title: 'App para computador',
    body: (
      <>
        <p className="wk-lead">O app de Windows e Linux abre a mesma comunidade do site e é quem instala os programas da aba Apps.</p>
        <Facts items={[
          ['Sistemas', 'Instalador .exe para Windows 10 e 11 e AppImage para Linux x86_64.'],
          ['Atualização', 'O app procura a versão nova sozinho e atualiza a partir das versões publicadas no GitHub. Cada programa da aba Apps mostra um botão quando sai versão nova.'],
          ['Bandeja', 'Fica na bandeja do sistema, pode abrir com o computador e fechar a janela não encerra o app.'],
          ['Links projectclub://', 'Links como projectclub://post/…, projectclub://user/… e projectclub://channel/… abrem direto no lugar certo do app.'],
          ['Jogos e mods', 'Detecta jogos instalados, conta o tempo de jogo e instala mods.'],
        ]} />
        <p>O navegador embutido, com abas dentro do app, está desligado por enquanto <Soon />. Links externos abrem no navegador padrão do sistema.</p>
      </>
    ),
  },
  {
    id: 'android', group: 'Aparelhos', title: 'App de Android',
    body: (
      <>
        <p className="wk-lead">No Android você usa a comunidade inteira: chat, voz, fórum, perfil e economia.</p>
        <Facts items={[
          ['Instalação', 'Arquivo .apk baixado do site. Permita instalar apps fora da loja quando o sistema pedir.'],
          ['Notificações', 'Chegam mesmo com o app fechado.'],
          ['Voz', 'Chamadas continuam em segundo plano, e o compartilhamento de tela funciona.'],
          ['Programas', 'Os apps de criação são para computador (Windows e Linux).'],
        ]} />
      </>
    ),
  },
  {
    id: 'moderacao', group: 'Segurança', title: 'Segurança e moderação',
    body: (
      <>
        <p className="wk-lead">Moderação automática nos canais públicos, revisão humana em todo o resto.</p>
        <Facts items={[
          ['AutoMod', 'Nos canais públicos, spam, links não permitidos, palavras bloqueadas e envio em excesso são barrados na hora do envio.'],
          ['Gatilhos nas DMs', 'A mensagem é entregue normalmente; se tiver uma palavra sinalizada, fica registrada para a staff revisar depois.'],
          ['Denúncias', 'Qualquer mensagem, de canal ou de DM, pode ser denunciada pelo menu dela, com um motivo.'],
          ['Penalidades', 'Depois da revisão, castigo (sem mandar mensagens nem entrar em calls por um tempo) ou banimento.'],
          ['Anti-raid', 'Muitas contas novas de uma vez disparam uma proteção automática.'],
          ['Pote de mel', 'Robôs que procuram painéis e arquivos sensíveis caem em rotas-isca e têm o IP bloqueado por um tempo.'],
        ]} />
      </>
    ),
  },
  {
    id: 'atalhos', group: 'Segurança', title: 'Atalhos',
    body: (
      <>
        <p className="wk-lead">Atalhos de teclado que funcionam no site e no app de computador.</p>
        <Keys rows={[
          ['Ctrl + K', 'Pular para qualquer canal, conversa ou página (⌘K no Mac).'],
          ['↑', 'Com o campo de mensagem vazio, edita a sua última mensagem.'],
          ['Esc', 'Cancela a resposta ou a edição e fecha janelas.'],
          ['Ctrl + Shift + F', 'Liga e desliga o modo foco.'],
          ['Alt + ← / Alt + →', 'Voltar e avançar no app de computador (os botões laterais do mouse também).'],
          ['Tab', 'No começo da página, mostra "Pular para o conteúdo".'],
        ]} />
        <p>Nesta página e na inicial, <kbd>Ctrl</kbd> + <kbd>K</kbd> abre a busca. Em Configurações você ainda cria atalhos personalizados.</p>
      </>
    ),
  },
  {
    id: 'duvidas', group: 'Segurança', title: 'Dúvidas comuns',
    body: (
      <div className="wk-faq">
        <details>
          <summary>Quanto custa?</summary>
          <p>Nada. Conta, comunidade e apps são gratuitos, sem plano pago e sem anúncio.</p>
        </details>
        <details>
          <summary>Esqueci a senha.</summary>
          <p>Na tela de login, use "Esqueci minha senha". Um link para criar uma senha nova chega no seu e-mail, e todas as sessões abertas são encerradas quando você troca.</p>
        </details>
        <details>
          <summary>Perdi o celular com o autenticador.</summary>
          <p>Entre com um dos códigos de recuperação no lugar do código de 6 dígitos. Depois, em Configurações, configure o autenticador no aparelho novo e gere uma lista nova de códigos.</p>
        </details>
        <details>
          <summary>Preciso do app para computador?</summary>
          <p>Só para instalar os programas, os mods e ver a biblioteca de jogos. A comunidade funciona no navegador e no Android.</p>
        </details>
        <details>
          <summary>Roda em PC fraco?</summary>
          <p>A comunidade roda em qualquer navegador atual. Nos programas, o WaveProject pede 2 GB de RAM, o GameProject e o CanvasProject pedem 4 GB e o ForgeProject pede 8 GB.</p>
        </details>
        <details>
          <summary>Como excluo a minha conta?</summary>
          <p>Em Configurações, "Excluir conta", confirmando com a senha. A conta é desativada na hora e todas as sessões caem. Para pedir a remoção dos dados, abra um ticket no Suporte (veja os <Link to="/termos#direitos">Termos de privacidade</Link>).</p>
        </details>
      </div>
    ),
  },
];
