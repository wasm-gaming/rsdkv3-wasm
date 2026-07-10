// @wasm-gaming/engine-rsdkv3 — SDK entry point.
//
// Conforms to the wasm-gaming engine contract (github.com/wasm-gaming/engine-specs):
// exports `manifest` (declarative) and `load(config)` (imperative).
//
// The engine binary is game-agnostic for RSDKv3. Sonic CD is selected by
// `Data.rsdk`, mounted at runtime into the Emscripten filesystem.

import type { EngineConfig, EngineInstance, AssetData, InputPreset, KeyMap } from '@wasm-gaming/engine-specs';
import { manifest } from './rsdkv3.manifest.js';
import { DEFAULT_RSDKV3_OPTIONS, type Rsdkv3Options } from './rsdkv3.options.js';

export { manifest };

const WORK_DIR = '/data';
const DEFAULT_STORAGE_NAMESPACE = 'default';

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

/** Normalize a user-provided storage namespace into a safe relative path. */
function normalizeStorageNamespace(namespace: unknown): string {
  if (typeof namespace !== 'string' || !namespace.trim()) return DEFAULT_STORAGE_NAMESPACE;

  const cleaned = namespace
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.replace(/[^A-Za-z0-9._-]/g, '_'))
    .filter(Boolean)
    .join('/');

  return cleaned || DEFAULT_STORAGE_NAMESPACE;
}

/** Best-effort mkdir -p for the Emscripten FS layer. */
function ensureDir(Module: any, path: string): void {
  const parts = path.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current += `/${part}`;
    try {
      Module.FS.mkdir(current);
    } catch {
      /* already exists */
    }
  }
}

/** Ensure the game working directory exists in the in-memory filesystem. */
function mountWorkingDir(Module: any, storageNamespace: string): { persistent: boolean; workDir: string } {
  const workDir = `${WORK_DIR}/${storageNamespace}`;
  ensureDir(Module, workDir);
  return { persistent: false, workDir };
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
  /** Relative storage namespace used under /data (e.g. "sonic-cd"). */
  storageNamespace: string;
  /** Remove files for this namespace only. */
  purgeStorage(): { data: boolean; settings: boolean };
};

/**
 * Extra (engine-specific) config on top of the contract's EngineConfig: lazy asset
 * providers, invoked only on a cache miss — e.g. to skip a large Data.rsdk fetch
 * when it's already persisted in OPFS.
 */
export type Rsdkv3LoadConfig = EngineConfig & {
  dataProvider?: () => Promise<AssetData> | AssetData;
  settingsProvider?: () => Promise<AssetData> | AssetData;
  /** Per-game storage folder under /data used for the in-memory filesystem. */
  storageNamespace?: string;
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

  const storageNamespace = normalizeStorageNamespace(config.storageNamespace);
  const { persistent, workDir } = mountWorkingDir(Module, storageNamespace);
  const dataPath = `${workDir}/Data.rsdk`;
  const settingsPath = `${workDir}/settings.ini`;

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

  Module.FS.chdir(workDir);

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
    setInput(map: InputPreset | KeyMap) {
      if (typeof window !== 'undefined') {
        (window as any).__gamepadKeyMap = map;
      }
    },
    destroy() {
      try { Module.pauseMainLoop?.(); } catch { /* noop */ }
      try { setPaused(true); } catch { /* noop */ }
    },
    devMenu,
    persistent,
    storageNamespace,
    purgeStorage() {
      const deleteFileIfExists = (path: string): boolean => {
        try {
          Module.FS.unlink(path);
          return true;
        } catch {
          return false;
        }
      };

      return {
        data: deleteFileIfExists(dataPath),
        settings: deleteFileIfExists(settingsPath),
      };
    },
  };
}

export default { manifest, load };
