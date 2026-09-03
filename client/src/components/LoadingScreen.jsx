import logoIcon from '../assets/icons/logo-project-club.png';

// Item pedido: "crie uma tela de carregamento... vai ter o ícone do
// Project Club com a logo e um texto Carregamento... com uma animação
// de carregamento redondo" — reaproveitado em 2 pontos de espera do
// app (App.jsx: checagem inicial de conta/comunidade; MainApp.jsx:
// socket conectado/"online") — arquivo próprio, não dentro de nenhum
// dos dois, porque App.jsx já importa MainApp.jsx; se o componente
// morasse num dos dois, o outro importar de volta criaria uma
// dependência circular entre eles.
export default function LoadingScreen() {
  return (
    <div className="loading-screen">
      <img className="loading-screen-logo" src={logoIcon} alt="" />
      <div className="loading-screen-spinner" />
      <p className="loading-screen-text">Carregando...</p>
    </div>
  );
}
