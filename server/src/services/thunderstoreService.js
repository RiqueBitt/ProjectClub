// Serviço que fala com a API PÚBLICA do Thunderstore (thunderstore.io)
// — item pedido: "pegue a interface e tudo do Gale [Thunderstore Mod
// Manager] e funda com o que eu já tenho." O Gale é GPL-3.0 (código
// aberto, mas com licença copyleft — qualquer coisa que incorporasse
// o código dele precisaria virar GPL também), então NENHUMA linha de
// lá foi copiada: isso aqui é implementação própria, direta contra a
// API pública e documentada do Thunderstore (thunderstore.io/api/docs/),
// mesma fonte de mods que o Gale usa por baixo (jogos com BepInEx —
// Lethal Company, Risk of Rain 2, Content Warning, etc.).
//
// Igual o GameBanana (ver gamebananaService.js), essa API não pede
// login/chave nenhuma pra LER — só um User-Agent educado.
//
// Formato v1 (endpoint /c/{community}/api/v1/package/, estável há anos
// e usado por praticamente toda ferramenta do ecossistema Thunderstore):
// cada pacote tem um array `versions` (mais nova primeiro), e cada
// versão lista suas `dependencies` como strings "Dono-Nome-1.2.3" —
// resolvidas abaixo em resolveDependencyTree.
const { cacheGetOrSet } = require('../config/redis');

const API_BASE = 'https://thunderstore.io';
const USER_AGENT = 'ProjectClub/1.0 (contato via projectclub)';

async function tsFetch(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!res.ok) {
    const err = new Error(`Thunderstore respondeu ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// A lista inteira de uma comunidade grande (Lethal Company, por
// exemplo) tem milhares de pacotes — pesada demais pra buscar de novo
// a cada tecla digitada na busca. TTL de 20 min: atualiza com
// frequência razoável sem martelar o Thunderstore a cada request.
const TTL_LIST = 20 * 60;
const TTL_CATEGORIES = 60 * 60;

// Lista TODOS os pacotes ativos de uma comunidade — busca/ordenação/
// paginação acontecem em cima disso, do nosso lado (a API v1 não
// aceita esses parâmetros, só devolve tudo de uma vez).
async function fetchCommunityPackages(communityIdentifier) {
  const cacheKey = `thunderstore:packages:${communityIdentifier}`;
  return cacheGetOrSet(cacheKey, TTL_LIST, () => tsFetch(`/c/${communityIdentifier}/api/v1/package/`));
}

async function fetchCategories(communityIdentifier) {
  const cacheKey = `thunderstore:categories:${communityIdentifier}`;
  const data = await cacheGetOrSet(cacheKey, TTL_CATEGORIES, () => tsFetch(`/api/experimental/community/${communityIdentifier}/category/`));
  return data.results || [];
}

// Normaliza um pacote cru pro formato que o resto do app usa — sempre
// olhando a versão MAIS RECENTE (versions[0]) pra dados de exibição
// (ícone, descrição, downloads), já que é isso que a pessoa instala
// por padrão.
function normalizePackage(raw) {
  const latest = raw.versions?.[0];
  if (!latest) return null;
  const totalDownloads = raw.versions.reduce((sum, v) => sum + (v.downloads || 0), 0);
  return {
    uuid4: raw.uuid4,
    name: raw.name,
    fullName: raw.full_name,
    owner: raw.owner,
    packageUrl: raw.package_url,
    dateCreated: raw.date_created,
    dateUpdated: raw.date_updated,
    rating: raw.rating_score || 0,
    isPinned: !!raw.is_pinned,
    isDeprecated: !!raw.is_deprecated,
    hasNsfwContent: !!raw.has_nsfw_content,
    categories: raw.categories || [],
    downloadCount: totalDownloads,
    version: {
      versionNumber: latest.version_number,
      description: latest.description,
      icon: latest.icon,
      dependencies: latest.dependencies || [],
      downloadUrl: latest.download_url,
      websiteUrl: latest.website_url,
    },
  };
}

const SORTERS = {
  popular: (a, b) => b.rating - a.rating,
  downloads: (a, b) => b.downloadCount - a.downloadCount,
  new: (a, b) => new Date(b.dateCreated) - new Date(a.dateCreated),
  updated: (a, b) => new Date(b.dateUpdated) - new Date(a.dateUpdated),
};

// Busca/ordena/filtra/pagina em cima da lista completa já cacheada —
// mesma ideia de "carregar mais" que o resto do sistema de mods já usa
// (ver GameModsView em ModsPage.jsx: offset + limit, resultTotal pra
// saber quando parar de oferecer "ver mais").
async function searchPackages(communityIdentifier, { q, sort = 'popular', category, offset = 0, limit = 30 } = {}) {
  const all = await fetchCommunityPackages(communityIdentifier);
  let normalized = all.map(normalizePackage).filter(Boolean).filter((p) => !p.isDeprecated);

  if (q) {
    const needle = q.trim().toLowerCase();
    normalized = normalized.filter((p) => p.name.toLowerCase().includes(needle) || p.owner.toLowerCase().includes(needle));
  }
  if (category) {
    normalized = normalized.filter((p) => p.categories.includes(category));
  }
  // Pacotes fixados (is_pinned) sempre na frente, igual o próprio site
  // do Thunderstore faz — só depois disso entra o critério de
  // ordenação escolhido.
  normalized.sort((a, b) => (b.isPinned - a.isPinned) || (SORTERS[sort] || SORTERS.popular)(a, b));

  const total = normalized.length;
  const page = normalized.slice(offset, offset + limit);
  return { packages: page, total };
}

// Resolve a árvore de dependências INTEIRA (recursiva, não só direta)
// de uma versão específica — é a peça que falta pra instalação
// "com um clique" tipo Gale: uma dependência pode depender de outra
// dependência, e assim por diante (ex: quase todo mod de Lethal
// Company depende do BepInExPack, que por sua vez não depende de mais
// nada — mas mods mais complexos formam cadeias mais longas).
// Devolve uma lista achatada, sem duplicatas, SEM o próprio pacote
// pedido, na ordem certa pra instalar (dependências antes de quem
// depende delas).
function resolveDependencyTree(allPackages, rootFullName, rootVersionNumber) {
  const byFullName = new Map(allPackages.map((p) => [p.full_name, p]));
  const resolved = new Map(); // fullName -> { fullName, name, owner, versionNumber, downloadUrl, icon }
  const visiting = new Set();

  function visit(fullName, versionNumber) {
    const key = `${fullName}@${versionNumber || ''}`;
    if (visiting.has(fullName)) return; // ciclo — nunca deveria acontecer no Thunderstore, mas não trava se acontecer
    const pkg = byFullName.get(fullName);
    if (!pkg) return; // dependência não encontrada nesta comunidade (raro, mas não devia quebrar o resto)
    const version = (versionNumber && pkg.versions.find((v) => v.version_number === versionNumber)) || pkg.versions[0];
    if (!version) return;
    visiting.add(fullName);
    for (const dep of version.dependencies || []) {
      const parts = dep.split('-');
      if (parts.length < 3) continue;
      const depVersion = parts[parts.length - 1];
      const depFullName = parts.slice(0, -1).join('-');
      visit(depFullName, depVersion);
    }
    visiting.delete(fullName);
    if (fullName !== rootFullName) {
      resolved.set(fullName, {
        fullName, name: pkg.name, owner: pkg.owner, versionNumber: version.version_number,
        downloadUrl: version.download_url, icon: version.icon,
      });
    }
  }

  visit(rootFullName, rootVersionNumber);
  return [...resolved.values()];
}

async function getPackageDetail(communityIdentifier, fullName) {
  const all = await fetchCommunityPackages(communityIdentifier);
  const raw = all.find((p) => p.full_name === fullName);
  if (!raw) { const err = new Error('Mod não encontrado.'); err.status = 404; throw err; }
  const normalized = normalizePackage(raw);
  const dependencies = resolveDependencyTree(all, fullName, normalized.version.versionNumber);
  return { pkg: normalized, dependencies };
}

module.exports = { fetchCommunityPackages, fetchCategories, searchPackages, getPackageDetail, normalizePackage };
