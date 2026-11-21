// Versão do Waddle Forever que foi incorporada ao Project Club (base do
// código em server/waddle). Mantida como constante em vez de ler o
// package.json do WF, que não existe mais aqui.
export const VERSION: string = '1.5.1';

export const NAME = 'Waddle Forever';

/** Porta padrão só do modo avulso (server/waddle/standalone). No Project
 * Club o jogo é servido pelo mesmo servidor HTTP do site. */
export const HTTP_PORT = 24105;

export const IS_DEV = process.env.NODE_ENV === 'dev' || process.env.NODE_ENV === 'development';

export const WEBSITE = 'https://waddleforever.com';
