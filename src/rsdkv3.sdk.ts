// @wasm-gaming/engine-rsdkv3 — SDK entry point.
//
// Conforms to the wasm-gaming engine contract (github.com/wasm-gaming/wasm-specs):
// exports `manifest` (declarative) and `load(config)` (imperative).
//
// The engine binary is game-agnostic for RSDKv3. Sonic CD is selected by
// `Data.rsdk`, mounted at runtime into the Emscripten filesystem.

import type { EngineConfig, EngineInstance, AssetData } from '@wasm-gaming/wasm-specs';
import { manifest } from './rsdkv3.manifest.js';
import { DEFAULT_RSDKV3_OPTIONS, type Rsdkv3Options } from './rsdkv3.options.js';

export { manifest };

const WORK_DIR = '/data';

/** Serialize engine options into RSDKv3's settings.ini format. */
function buildSettingsIni(options: Rsdkv3Options = {}): string {
  const o = { ...DEFAULT_RSDKV3_OPTIONS, ...options };
  return [
    '[Dev]',
    `EngineDebugMode=${o.engineDebugMode ? 'true' : 'false'}`,
    `DevMenu=${o.devMenu ? 'true' : 'false'}`,
    '',
    '[Game]',
    `Language=${o.language | 0}`,
    `DisableTouchControls=${o.disableTouchControls ? 'true' : 'false'}`,
    '',
    '[Video]',
    'Windowed=true',
    'Borderless=false',
    'ExclusiveFS=false',
    `VSync=${o.vsync ? 'true' : 'false'}`,
    'WindowScale=2',
    'ScreenWidth=426',
    'ScreenHeight=240',
    'RefreshRate=60',
    '',
    '[Audio]',
    'BGMVolume=1.000000',
    'SFXVolume=1.000000',
    `Soundtrack=${o.soundtrack | 0}`,
    '',
  ].join('\n');
}

function toUint8(x: unknown): Uint8Array | null {
  if (x == null) return null;
  if (typeof x === 'string') return new TextEncoder().encode(x);
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  throw new TypeError('asset must be Uint8Array | ArrayBuffer | string');
}

/** Ensure the game working directory exists in the in-memory filesystem. */
function mountWorkingDir(Module: any): { persistent: boolean } {
  try {
    Module.FS.mkdir(WORK_DIR);
  } catch {
    /* already exists */
  }
  return { persistent: false };
}

/** True if `path` exists in the (mounted) filesystem. */
function fileExists(Module: any, path: string): boolean {
  try {
    Module.FS.stat(path);
    return true;
  } catch {
    return false;
  }
}

/** RSDKv3-specific bridge for the launcher's debug/stage-select UI. */
export interface RsdkDevMenuBridge {
  getStageList(): Array<{ name: string; stages: Array<{ name: string }> }>;
  loadStage(categoryIdx: number, stageIdx: number): void;
  setPaused(paused: boolean): void;
}

export type Rsdkv3Instance = EngineInstance & {
  devMenu: RsdkDevMenuBridge;
  /** Always false in the current rsdkv3 build (in-memory FS backend). */
  persistent: boolean;
};

/**
 * Extra (engine-specific) config on top of the contract's EngineConfig: lazy asset
 * providers, invoked only on a cache miss — e.g. to skip a large Data.rsdk fetch
 * when it's already persisted in OPFS.
 */
export type Rsdkv3LoadConfig = EngineConfig & {
  dataProvider?: () => Promise<AssetData> | AssetData;
  settingsProvider?: () => Promise<AssetData> | AssetData;
};

/** Boot the RSDKv3 engine. */
export async function load(config: Rsdkv3LoadConfig): Promise<Rsdkv3Instance> {
  const { canvas, assets, onEvent } = config;
  const options = config.options as Rsdkv3Options | undefined;
  if (!canvas) throw new Error('rsdkv3: config.canvas is required');

  // Emscripten's SDL2 port locates the canvas via document.querySelector('#canvas').
  if (canvas.id !== 'canvas') canvas.id = 'canvas';

  const emit = (e: Parameters<NonNullable<EngineConfig['onEvent']>>[0]) => {
    try { onEvent?.(e); } catch { /* host handler must not break us */ }
  };

  const jsUrl = config.jsUrl ?? new URL('./rsdkv3.js', import.meta.url).href;
  const wasmUrl = config.wasmUrl ?? new URL('./rsdkv3.wasm', import.meta.url).href;

  // RSDKv3 uses the same key map preset used by the shared launcher script.
  if (typeof window !== 'undefined') (window as any).__gamepadKeyMap = manifest.input;

  const mod: any = await import(/* @vite-ignore */ jsUrl);
  const createRSDKv3 = mod.default;

  const Module: any = await createRSDKv3({
    canvas,
    noInitialRun: true, // built with -sINVOKE_RUN=0; we mount data before main()
    locateFile: (path: string) => (path.endsWith('.wasm') ? wasmUrl : path),
    print: (...a: unknown[]) => console.log('[rsdkv3]', ...a),
    printErr: (...a: unknown[]) => console.error('[rsdkv3]', ...a),
    onAbort: (reason: unknown) =>
      emit({ type: 'error', error: new Error(`rsdkv3 aborted: ${reason}`) }),
  });

  const { persistent } = mountWorkingDir(Module);
  const dataPath = `${WORK_DIR}/Data.rsdk`;
  const settingsPath = `${WORK_DIR}/settings.ini`;

  // Data.rsdk — precedence: explicit asset > lazy provider > existing file.
  let dataBytes = toUint8(assets?.data);
  if (!dataBytes && config.dataProvider) {
    dataBytes = toUint8(await config.dataProvider());
  }
  if (dataBytes) {
    Module.FS.writeFile(dataPath, dataBytes);
  } else if (!fileExists(Module, dataPath)) {
    throw new Error('rsdkv3: no Data.rsdk — provide assets.data or dataProvider');
  }

  // settings.ini — explicit asset > lazy provider > generated from options.
  let settingsBytes = toUint8(assets?.settings);
  if (!settingsBytes && config.settingsProvider) {
    settingsBytes = toUint8(await config.settingsProvider());
  }
  if (settingsBytes) {
    Module.FS.writeFile(settingsPath, settingsBytes);
  } else if (!fileExists(Module, settingsPath)) {
    Module.FS.writeFile(settingsPath, new TextEncoder().encode(buildSettingsIni(options)));
  }
  // else: keep existing settings.ini in memory FS

  Module.FS.chdir(WORK_DIR);

  const setPaused = (paused: boolean) => {
    if (typeof Module.web_devmenu_set_paused === 'function') Module.web_devmenu_set_paused(paused);
  };

  const devMenu: RsdkDevMenuBridge = {
    getStageList() {
      if (typeof Module.web_devmenu_get_stage_list !== 'function') return [];
      try {
        return JSON.parse(Module.web_devmenu_get_stage_list());
      } catch (e) {
        console.error('[rsdkv3] getStageList failed', e);
        return [];
      }
    },
    loadStage(categoryIdx, stageIdx) {
      if (typeof Module.web_devmenu_load_stage === 'function') {
        Module.web_devmenu_load_stage(categoryIdx | 0, stageIdx | 0);
      }
    },
    setPaused,
  };

  // Run main() from the mounted working dir. simulate_infinite_loop schedules
  // the rAF loop and returns via a benign unwind Emscripten swallows.
  Module.callMain(['UsingCWD']);
  emit({ type: 'ready' });

  return {
    start() {},
    pause() { setPaused(true); },
    resume() { setPaused(false); },
    reset() {
      throw new Error('rsdkv3: reset() is not supported — destroy() and load() again');
    },
    setInput(preset) {
      if (typeof window !== 'undefined') {
        (window as any).__gamepadKeyMap = preset ?? manifest.input;
      }
    },
    destroy() {
      try { Module.pauseMainLoop?.(); } catch { /* noop */ }
      try { setPaused(true); } catch { /* noop */ }
    },
    devMenu,
    persistent,
  };
}

export default { manifest, load };
