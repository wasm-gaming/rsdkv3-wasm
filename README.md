# @wasm-gaming/rsdkv3-wasm

RSDKv3 (Retro Software Development Kit v3, the Sonic CD 2011 decompilation) compiled to
WebAssembly, wrapped in a self-contained SDK that implements the
[wasm-gaming engine contract](https://github.com/wasm-gaming/engine-specs) 1.0.

The engine bakes no game data: the host hands over `Data.rsdk` at runtime, so one `rsdkv3.wasm`
serves any install.

## Install

```bash
npm install @wasm-gaming/rsdkv3-wasm
```

The SDK carries the contract's runtime beside it (`dist/rsdkv3/engine-specs.js`) and imports it
relatively: it loads from any static server, with no bundler and no import map. The wasm and its
glue are built in CI and shipped in the GitHub Release (`rsdkv3.tar.gz`, layout `rsdkv3/rsdkv3/…`).

## Use

```js
import Rsdkv3SDK from './rsdkv3/rsdkv3.sdk.js';

const play = await new Rsdkv3SDK({ config: { soundtrack: 1 } })   // US soundtrack
  .assets({ data: () => readDataRsdk() })      // bytes, or a thunk
  .storage({ namespace: 'sonic-cd' })          // → OPFS rsdkv3/sonic-cd/
  .on('saves', ({ detail }) => console.log('saved', detail.files))
  .mount(document.querySelector('#stage'))
  .start();

play.pause('menu');  play.resume('menu');      // owner-aware; sound stops too
play.devMenu.getStageList();                   // draw your own stage select…
play.devMenu.loadStage(0, 2);                  // …and warp
await play.destroy();                          // save flushed, loop stopped, audio closed
```

| payload | keys |
| --- | --- |
| `config` | `devMenu`, `engineDebugMode`, `vsync`, `soundtrack` (0 JP/EU, 1 US), `language`, `disableTouchControls` (→ generated `settings.ini`), `jsUrl`, `wasmUrl` |
| `options` | — |
| `assets` | `data` (`Data.rsdk`, required), `settings` (`settings.ini`, optional) |
| `storage` | `namespace` (default `default`), `persist` (`'opfs'` \| `null`) |

Events: the contract's `start`, `error`, `exit`, `pause`, `resume`, plus `saves`.
RSDKv3 cannot restart in process: after `destroy()`, a new session needs a new page (or iframe).

## The engine's own app

A host that would rather not draw menus mounts the app shipped next to the SDK
([engine-specs](https://github.com/wasm-gaming/engine-specs) `EngineApp`, `UX.md`):

```js
const app = await import('@wasm-gaming/rsdkv3-wasm/app'); // dist/rsdkv3/app/app.js
const handle = await app.mount(element, { game, storage, assets, input, exit });
await handle.unmount();
```

It shows a boot screen, then Sonic CD with its own title and save select. Select + Start or
Escape opens the pause menu: *Continuar*, the game's own screens found in the stage list (title
screen, main menu, level select — only those the data has) and *Volver al lanzador* (asks first).
There is no load-game screen like rsdkv4's yet: that needs a native bridge (see `RECORD/`).

## Saves live in the engine's own folder

The working dir is `/data/rsdkv3/<namespace>` (in memory). The SDK seeds `SData.bin` from OPFS
`rsdkv3/<namespace>/` before boot and mirrors it back when it changes — every 10 s, on pause, when
the page is hidden and on `destroy()` — so saves survive reloads. `play.storagePath` gives the
folder; `storagePath(engineId, namespace)` is exported.

## Build

```bash
make build-sdk      # TypeScript → dist/rsdkv3/ (fast, no Docker)
make test           # type-check + tests against the built package
make build-wasm     # RSDKv3 → WebAssembly in emscripten/emsdk:6.0.2 (Docker)
make demo           # dist/index.html: a no-build demo (pick or drop Data.rsdk)
make preview        # serve dist/ on :8023
```

The upstream decompilation is pinned (`d1bbec59`, 2026-07-04) together with its submodules, and so
is the emsdk image, because the build's source patches are written against that exact revision.

## Project Specs

- Contract 1.0 class (`Rsdkv3SDK` / `Rsdkv3Play`), self-contained ESM, engine-specs as the one
  dependency; conformance line `RSDKV3_ENGINE` checked by `make test`.
- Engine-owned storage `rsdkv3/<namespace>/` with an `SData.bin` mirror.
- Records of decisions in [RECORD/](RECORD/).

## Todos

- [ ] Make the build's source patches assert that they applied.
- [ ] Verify with a real `Data.rsdk` (save written by the game → mirrored → restored).

## License

MIT for this wrapper. The upstream engine and the game data keep their own licenses.
