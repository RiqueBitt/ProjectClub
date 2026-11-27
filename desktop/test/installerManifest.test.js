'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { pinPackageUrl, manifestProblems, INSTALLER_NAME } = require('../scripts/installer-manifest');

const BASE = 'https://github.com/RiqueBitt/ProjectClub/releases/download/v1.45.0';
const PACKAGE = 'project-club-desktop-1.45.0-x64.nsis.7z';
// Formato que o electron-builder gera pro instalador que baixa o app.
const built = () => ({
  version: '1.45.0',
  files: [{ url: INSTALLER_NAME, sha512: 'aGFzaC1kby1pbnN0YWxhZG9y', size: 734003 }],
  packages: { x64: { size: 123456789, sha512: 'aGFzaC1kby1wYWNvdGU=', blockMapSize: 130000, path: PACKAGE, file: PACKAGE } },
  path: INSTALLER_NAME,
  sha512: 'aGFzaC1kby1pbnN0YWxhZG9y',
  releaseDate: '2026-11-27T12:00:00.000Z',
});

test('o pacote passa a apontar pra release da própria versão', () => {
  const pinned = pinPackageUrl(built(), BASE);
  assert.strictEqual(pinned.packages.x64.path, `${BASE}/${PACKAGE}`);
  assert.strictEqual(pinned.packages.x64.file, PACKAGE);
  assert.strictEqual(pinned.packages.x64.sha512, 'aGFzaC1kby1wYWNvdGU=');
  assert.strictEqual(pinned.packages.x64.blockMapSize, 130000);
  assert.strictEqual(pinned.files[0].url, INSTALLER_NAME);
  assert.deepStrictEqual(manifestProblems(pinned), []);
});

test('não mexe no objeto original e pode rodar duas vezes', () => {
  const original = built();
  const once = pinPackageUrl(original, BASE);
  assert.strictEqual(original.packages.x64.path, PACKAGE);
  assert.deepStrictEqual(pinPackageUrl(once, BASE), once);
});

test('o app instalado resolve os dois endereços certos', () => {
  // Mesma conta que o electron-updater faz: new URL(caminho, endereço-base-do-publish).
  const feed = new URL(require('../package.json').build.publish.url);
  const pinned = pinPackageUrl(built(), BASE);
  assert.strictEqual(new URL(pinned.files[0].url, feed).href, 'https://github.com/RiqueBitt/ProjectClub/releases/latest/download/ProjectClub-Setup-Windows.exe');
  assert.strictEqual(new URL(pinned.packages.x64.path, feed).href, `${BASE}/${PACKAGE}`);
});

test('recusa endereço de release errado', () => {
  assert.throws(() => pinPackageUrl(built(), ''), /inválido/);
  assert.throws(() => pinPackageUrl(built(), `${BASE}/`), /inválido/);
  assert.throws(() => pinPackageUrl(built(), 'github.com/x'), /inválido/);
});

test('recusa latest.yml de instalador que não baixa o app', () => {
  const full = built();
  delete full.packages;
  assert.throws(() => pinPackageUrl(full, BASE), /pacotes/);
  assert.throws(() => pinPackageUrl({ ...built(), packages: { x64: { size: 1 } } }, BASE), /\.7z/);
});

test('aponta o que está errado antes de publicar', () => {
  assert.ok(manifestProblems(built()).some((p) => /endereço completo/.test(p)), 'pacote só com o nome');
  const renamed = pinPackageUrl(built(), BASE);
  renamed.files[0].url = 'Project Club Web Setup 1.45.0.exe';
  assert.ok(manifestProblems(renamed).some((p) => p.includes(INSTALLER_NAME)));
  assert.ok(manifestProblems({}).length >= 4);
  const latest = pinPackageUrl(built(), 'https://github.com/RiqueBitt/ProjectClub/releases/latest/download');
  assert.ok(manifestProblems(latest).some((p) => /endereço completo/.test(p)), 'release "latest" muda de lugar');
});

test('o package.json continua pedindo o instalador pequeno, com telas e na pasta "Project Club"', () => {
  const { build } = require('../package.json');
  assert.deepStrictEqual(build.win.target, [{ target: 'nsis-web', arch: ['x64'] }]);
  assert.strictEqual(build.nsis.oneClick, false, 'com oneClick o Windows instala em "project-club-desktop" sem mostrar nada');
  assert.strictEqual(build.nsis.perMachine, false);
  assert.strictEqual(build.productName, 'Project Club');
  assert.strictEqual(build.nsisWeb.artifactName, 'ProjectClub-Setup-Windows.${ext}');
  assert.ok(!build.nsisWeb.appPackageUrl.endsWith('/'), 'o instalador junta "/" + nome do pacote');
});
