import logoIcon from '../assets/icons/logo-project-club.png';

// Item pedido: "crie uma tela de carregamento... vai ter o ícone do
// Project Club com a logo e um texto Carregamento... com uma animação
// de carregamento redondo" — reaproveitado em 2 pontos de espera do
// app (App.jsx: checagem inicial de conta/comunidade; MainApp.jsx:
// socket conectado/"online") — arquivo próprio, não dentro de nenhum
// dos dois, porque App.jsx já importa MainApp.jsx; se o componente
// morasse num dos dois, o outro importar de volta criaria uma
// dependência circular entre eles.
// "Você sabia que…" (igual à tela de carregamento do Discord): uma dica
// aleatória do Project Club a cada abertura.
const TIPS = [
  'Clique com o botão direito numa mensagem → Favoritar pra achar depois na Caixa de Entrada.',
  'Ctrl+K abre a busca rápida pra pular pra qualquer canal ou conversa.',
  'Dá pra pintar o app inteiro com um tema colorido em Configurações → Aparência.',
  'Missões diárias dão moedas — Assinantes ganham bônus de 1,2x.',
  'No perfil de alguém, "Adquira este visual" mostra na Loja os itens que a pessoa usa.',
  'Seus amigos veem sua Lista de desejos e podem te presentear.',
  'Monte o Mural do seu perfil com seu jogo favorito e os que você está jogando.',
  'Em Configurações → Voz e vídeo dá pra escolher um som de entrada que toca pra todos na call.',
  'Modo streamer esconde seu e-mail e notas enquanto você transmite.',
  'Códigos de eventos são resgatados na Loja → Presentes e códigos.',
  'Você pode ter até 5 contas salvas e trocar pelo menu do seu status.',
  'Arquivos de código enviados no chat aparecem com cores e prévia.',
  'Mensagens de quem não é seu amigo chegam em Solicitações, sem fazer barulho.',
];
const tip = TIPS[Math.floor(Math.random() * TIPS.length)];

export default function LoadingScreen() {
  return (
    <div className="loading-screen">
      <img className="loading-screen-logo" src={logoIcon} alt="" />
      <div className="loading-screen-spinner" />
      <p className="loading-screen-text">Carregando...</p>
      <div className="loading-screen-tip">
        <small>Você sabia que</small>
        <span>{tip}</span>
      </div>
    </div>
  );
}
