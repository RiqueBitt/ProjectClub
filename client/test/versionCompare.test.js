import test from 'node:test';
import assert from 'node:assert';
import { parseVersion, compareVersions, isNewer } from '../src/utils/versionCompare.js';

test('parseVersion', () => {
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion('1.20.0'), [1, 20, 0]);
  assert.equal(parseVersion('versão nova'), null);
  assert.equal(parseVersion(''), null);
  assert.equal(parseVersion(undefined), null);
});

test('compareVersions compara os números, não o texto', () => {
  assert.equal(compareVersions('v1.10.0', 'v1.9.0'), 1);
  assert.equal(compareVersions('v1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('v0.9.9', 'v1.0.0'), -1);
  assert.equal(compareVersions('lixo', 'v1.0.0'), null);
});

test('isNewer só quando é de fato mais nova', () => {
  assert.equal(isNewer('v1.3.0', 'v1.2.9'), true);
  assert.equal(isNewer('v1.2.9', 'v1.3.0'), false);
  assert.equal(isNewer('v1.3.0', 'v1.3.0'), false);
  assert.equal(isNewer('v1.3.0', ''), false);
});
