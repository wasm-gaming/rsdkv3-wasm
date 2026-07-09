# @wasm-gaming/engine-rsdkv3

RSDKv3 (Retro Software Development Kit v3, Sonic CD 2011 decompilation) compiled
to WebAssembly, wrapped in a JS SDK conforming to the
[wasm-gaming engine contract](https://github.com/wasm-gaming/wasm-specs).

The engine does not bake game data with `--preload-file`. Hosts provide
`Data.rsdk` at runtime, so the same `rsdkv3.wasm` can be reused across installs.

## Contract surface

```js
import { manifest, load } from '@wasm-gaming/engine-rsdkv3';

const engine = await load({
  canvas,
  assets: { data: dataRsdkBytes /*, settings: iniBytes */ },
  onEvent: (e) => { /* 'ready' | 'error' */ },
  // Optional override when artifacts are hosted externally:
  // jsUrl, wasmUrl,
});

engine.pause();
engine.resume();
engine.setInput('rsdkv4');
engine.destroy();
```

- `manifest` defines required `data` (`/data/Data.rsdk`) and optional `settings`
  (`/data/settings.ini`) assets.
- `load(config)` returns an `EngineInstance` and exposes `devMenu` bridge helpers:
  `getStageList()`, `loadStage(category, stage)`, `setPaused(bool)`.

## Options

Engine-specific options are declared in
[src/rsdkv3.options.ts](src/rsdkv3.options.ts) and mirrored into `manifest.options`:

- `devMenu`
- `engineDebugMode`
- `vsync`
- `soundtrack` (`0` JP/EU, `1` US)
- `language`
- `disableTouchControls`

If `assets.settings` is omitted, the SDK generates `settings.ini` from these
options.

## Build

All build logic is in [Makefile](Makefile):

```bash
make build        # SDK (TypeScript) + WASM
make build-sdk    # SDK only
make build-wasm   # WASM via Docker wrapper
make preview      # serves dist/ at http://localhost:8080
```

- `scripts/build.sh` clones `Rubberduckycooly/Sonic-CD-11-Decompilation`, applies
  known Emscripten patches, vendors `libtheora`, and outputs:
  - `dist/rsdkv3/rsdkv3.js`
  - `dist/rsdkv3/rsdkv3.wasm`
- `scripts/emit-manifest.mjs` writes `dist/manifest.json` from typed manifest.
- `scripts/seed-settings.mjs` seeds `dist/settings.ini` from
  `src/settings.default.ini` when absent.

## Try locally

```bash
make build
cp /path/to/Data.rsdk dist/
make preview
# open http://localhost:8080/
```

The demo attempts `./Data.rsdk`; if missing, it shows a file picker and supports
drag-and-drop.

## Status

- ✅ TypeScript SDK + manifest build
- ✅ CI workflow scaffold for SDK/WASM/release/pages
- ⏳ Browser runtime verification with a real `Data.rsdk`
- ⏳ Full WASM build verification (`make build-wasm`) on this new subproject

## License

MIT for this wrapper. Upstream engine and game data keep their own licenses.
