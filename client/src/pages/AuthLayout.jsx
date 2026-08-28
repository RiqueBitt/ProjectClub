import { useEffect } from 'react';
import Logo from '../components/Logo.jsx';

export default function AuthLayout({ title, subtitle, children, footer, wide }) {
  // O <body> do app inteiro tem overflow:hidden (necessário pro resto do
  // app gerenciar seu próprio scroll interno) — isso já causou o botão
  // de "Enviar inscrição" ficando inacessível antes. A tentativa anterior
  // de resolver com overflow-y:auto num container interno nem sempre
  // funciona igual em todo navegador/zoom, então aqui a página deixa o
  // PRÓPRIO body rolar de verdade (o jeito mais confiável que existe)
  // só enquanto essa tela de login/inscrição estiver montada — e
  // desfaz a mudança ao sair, pra não afetar o resto do app.
  useEffect(() => {
    document.body.classList.add('body-auth-scroll');
    // O CSS zoom:1.2 aplicado no <html> em telas de PC (ver global.css)
    // já causou bug de posição em outro lugar do site (o miniperfil) por
    // misturar sistemas de medida diferentes — o widget de captcha é de
    // TERCEIROS (Google), não tem como eu corrigir a lógica de posição
    // interna dele, então a solução real aqui é simplesmente NÃO aplicar
    // esse zoom nas telas de login/inscrição (não faz falta nelas de
    // qualquer forma), eliminando de vez qualquer chance de interferir
    // com o seletor de imagens do Google.
    document.documentElement.classList.add('auth-no-zoom');
    return () => {
      document.body.classList.remove('body-auth-scroll');
      document.documentElement.classList.remove('auth-no-zoom');
    };
  }, []);

  return (
    <div className="auth-screen">
      <div className={`auth-card ${wide ? 'auth-card-wide' : ''}`}>
        <div className="auth-logo-wrap"><Logo size={56} /></div>
        <h1>{title}</h1>
        {subtitle && <p className="auth-subtitle">{subtitle}</p>}
        {children}
        {footer && <div className="auth-footer">{footer}</div>}
      </div>
    </div>
  );
}
