// The rsdkv3 EngineManifest — typed against the contract, so a drift from
// @wasm-gaming/engine-specs is a compile error here. `npm run build:manifest`
// serializes this to dist/manifest.json (the artifact CI attaches to a Release).

import type { EngineManifest } from '@wasm-gaming/engine-specs';
import { RSDKV3_OPTIONS_SCHEMA } from './rsdkv3.options.js';

export const manifest: EngineManifest = {
  id: 'rsdkv3',
  version: '0.1.0',
  name: 'Retro Software Development Kit v3',
  artifacts: {
    // Relative to the manifest (dist/manifest.json); the engine files live in
    // the dist/rsdkv3/ subfolder.
    wasm: 'rsdkv3/rsdkv3.wasm',
    js: 'rsdkv3/rsdkv3.js',
  },
  assets: [
    {
      key: 'data',
      // Lives under the OPFS-backed (persistent) working dir; the engine reads it
      // via CWD (booted with the UsingCWD arg).
      mountPath: '/data/Data.rsdk',
      required: true,
      accept: ['.rsdk'],
      description:
        'Sonic CD 2011 game data pack (Data.rsdk).',
    },
    {
      key: 'settings',
      mountPath: '/data/settings.ini',
      required: false,
      accept: ['.ini'],
      description:
        'Engine settings. Omitted → the SDK generates one from config.options.',
    },
  ],
  input: 'rsdkv4',
  video: { baseWidth: 426, baseHeight: 240, aspect: '16:9' },
  options: RSDKV3_OPTIONS_SCHEMA,
  capabilities: { saveStates: false, sram: false, coreSelectable: false },
};

export default manifest;
