import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ptBR from './locales/pt-BR.json';
import enUS from './locales/en-US.json';
import esES from './locales/es-ES.json';

// Item pedido: "melhore os idiomas e deixe só 3 idiomas mesmo" — o
// seletor "Idioma" já existia há tempo na tela de Configurações
// (salvava userSettings.language no banco normalmente), mas nenhum
// texto da interface de fato mudava ao trocar — não existia nenhum
// sistema de tradução no projeto até agora. Esses 3 (pt-BR/en-US/
// es-ES, os mesmos já oferecidos no seletor) são os únicos idiomas
// reais hoje — qualquer outro valor cai em pt-BR (fallbackLng).
export const resources = {
  'pt-BR': { translation: ptBR },
  'en-US': { translation: enUS },
  'es-ES': { translation: esES },
};

i18n.use(initReactI18next).init({
  resources,
  lng: 'pt-BR',
  fallbackLng: 'pt-BR',
  interpolation: { escapeValue: false }, // React já escapa por conta própria
  returnNull: false,
});

// Chamado sempre que userSettings.language é conhecido/muda (ver
// App.jsx) — mantém o idioma exibido em sincronia com a preferência
// salva, tanto no primeiro carregamento quanto quando a pessoa troca
// na tela de Configurações, sem precisar recarregar a página.
export function applyLanguage(lang) {
  if (lang && resources[lang] && i18n.language !== lang) {
    i18n.changeLanguage(lang);
  }
}

export default i18n;
