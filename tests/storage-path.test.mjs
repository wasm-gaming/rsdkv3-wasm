// The engine owns its folder: every namespace resolves under rsdkv3/, and none can
// climb out of it. Runs against the built SDK (make build-sdk), the module a host
// actually imports — which also proves it loads with no import map or bundler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Rsdkv3SDK, { storagePath } from '../dist/rsdkv3/rsdkv3.sdk.js';

const cases = [
  [undefined, 'default', 'rsdkv3/default', false],
  ['', 'default', 'rsdkv3/default', false],
  [{ id: 'sonic-1' }, 'default', 'rsdkv3/default', false],
  ['sonic-1', 'sonic-1', 'rsdkv3/sonic-1', false],
  ['sonic-2/profile-a', 'sonic-2/profile-a', 'rsdkv3/sonic-2/profile-a', false],
  [' a b /c? ', 'a_b/c_', 'rsdkv3/a_b/c_', false],
  ['../x', 'x', 'rsdkv3/x', false],
  ['./../../etc', 'etc', 'rsdkv3/etc', false],
  ['..', 'default', 'rsdkv3/default', false],
  ['/abs/path', 'abs/path', 'rsdkv3/abs/path', false],
  // the old convention: the prefix is stripped once, so the files stay where they were
  ['rsdkv3/Sonic1', 'Sonic1', 'rsdkv3/Sonic1', true],
  // a game literally named like the engine is not mistaken for the prefix
  ['rsdkv3', 'rsdkv3', 'rsdkv3/rsdkv3', false],
];

for (const [input, namespace, path, prefixed] of cases) {
  test(`storagePath('rsdkv3', ${JSON.stringify(input)}) → ${path}`, () => {
    assert.deepEqual(storagePath('rsdkv3', input), { namespace, path, prefixed });
  });
}

test('the engine id is the folder', () => {
  assert.equal(Rsdkv3SDK.id, 'rsdkv3');
  assert.ok(storagePath(Rsdkv3SDK.id, 'x').path.startsWith(`${Rsdkv3SDK.id}/`));
});

test('the spec says what a host needs to paint its settings', async () => {
  const { RSDKV3_SPEC } = await import('../dist/rsdkv3/rsdkv3.sdk.js');
  assert.deepEqual(RSDKV3_SPEC.assets.data.allowedTypes, ['.rsdk']);
  assert.equal(RSDKV3_SPEC.config.soundtrack.default, 0);
  assert.equal(RSDKV3_SPEC.storage.namespace.default, 'default');
});

test('settings.ini follows the config', async () => {
  const { buildSettingsIni } = await import('../dist/rsdkv3/rsdkv3.sdk.js');
  const ini = buildSettingsIni({ soundtrack: 1, devMenu: false, vsync: true });
  assert.match(ini, /^Soundtrack=1$/m);
  assert.match(ini, /^DevMenu=false$/m);
  assert.match(ini, /^VSync=true$/m);
});
