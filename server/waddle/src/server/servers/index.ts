import fs from 'fs';
import path from 'path';
import { HTTP_PORT } from '../../common/constants';

export const WORLD_DELTA = 2;

export const LOGIN_DELTA = 1;

export const WORLD_PORT = HTTP_PORT + WORLD_DELTA;

export const LOGIN_PORT = HTTP_PORT + LOGIN_DELTA;

export function getServerPopulation(): number {
  const seed = Math.random()
  if (seed < 0.1) {
    return 1
  } else if (seed < 0.2) {
    return 2
  } else if (seed < 0.3) {
    return 3
  } else if (seed < 0.6) {
    return 4
  } else if (seed < 0.8) {
    return 5
  } else {
    return 6
  }
}

type PenguinServer = {
  name: string
  id: number
}

type ServerLang = 'en' | 'pt' | 'fr' | 'es'

type LanguageServer = Array<{
  servers: string[],
  lang: ServerLang
}>

type LanguageServerID = Array<{
  servers: Array<{ name: string, id: number }>,
  lang: ServerLang
}>

// Project Club: um servidor só, em todos os idiomas (o jogo não oferece
// escolha; o nome aparece na tela de "servidores sugeridos" e no cartão).
const SERVER_NAME = process.env.WADDLE_SERVER_NAME || 'Project Club';
const Languages: LanguageServer = [
  { lang: 'en', servers: [SERVER_NAME] },
  { lang: 'pt', servers: [SERVER_NAME] },
  { lang: 'fr', servers: [SERVER_NAME] },
  { lang: 'es', servers: [SERVER_NAME] }
]

let i = 0;
const locales: LanguageServerID = Languages.map((locale) => {
  return {
    lang: locale.lang,
    servers: locale.servers.map((name) => {
      const id = 3000 + i
      i++
      return { name, id }
    })
  }
})

const serverList: PenguinServer[] = locales.reduce<PenguinServer[]>((accumulator, currentValue) => {
  return [ ...accumulator, ...currentValue.servers]
}, [])

export default serverList;
