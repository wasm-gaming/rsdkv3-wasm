/**
 * The engine package's entry point: an `EngineSDK` for RSDKv3 (Sonic CD).
 *
 * ```js
 * import Rsdkv3SDK from '@wasm-gaming/rsdkv3-wasm';
 *
 * const play = await new Rsdkv3SDK({ config: { soundtrack: 1 } })
 *   .assets({ data: () => readDataRsdk() })    // bytes, or a thunk
 *   .storage({ namespace: 'sonic-cd' })        // → OPFS rsdkv3/sonic-cd/
 *   .mount(document.querySelector('#stage'))
 *   .start();
 *
 * play.pause('menu'); play.resume('menu');
 * play.devMenu.getStageList();               // the host draws its own stage select
 * await play.destroy();                      // save flushed, loop stopped, audio closed
 * ```
 *
 * One game-agnostic `rsdkv3.wasm`: `Data.rsdk` is written into the filesystem at
 * runtime, never baked in. The working dir `/data/rsdkv3/<namespace>` is in memory;
 * the SDK seeds `SData.bin` from OPFS `rsdkv3/<namespace>/` before boot and mirrors it
 * back when it changes (every 10 s, on pause, on page hide and on destroy).
 */
import {
  EnginePlayBase,
  EngineSDKBase,
  EventEmitter,
  type EngineInit,
  type EngineSDKConstructor,
  type EventsOf,
  type PayloadKind,
} from '@wasm-gaming/engine-specs';
import {
  RSDKV3_SPEC,
  RSDKV3_VIDEO,
  type Rsdkv3Asset,
  type Rsdkv3Config,
  type Rsdkv3Options,
  type Rsdkv3Payloads,
} from './rsdkv3.options.js';

export type {
  Rsdkv3Asset,
  Rsdkv3Assets,
  Rsdkv3Config,
  Rsdkv3Events,
  Rsdkv3Options,
  Rsdkv3Payloads,
  Rsdkv3Storage,
} from './rsdkv3.options.js';
export { RSDKV3_SPEC, RSDKV3_VIDEO } from './rsdkv3.options.js';

const ENGINE_ID = 'rsdkv3';
const DEFAULT_STORAGE_NAMESPACE = 'default';
const WORK_ROOT = '/data';
const SAVE_FILE = 'SData.bin';
const SAVE_INTERVAL_MS = 10_000;

/** The Emscripten module this build produces (`createRSDKv3` from rsdkv3.js). */
interface Rsdkv3Module {
  FS: {
    mkdir(path: string): void;
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array;
    chdir(path: string): void;
  };
  callMain(args: string[]): void;
  pauseMainLoop?: () => void;
  web_devmenu_get_stage_list?: () => string;
  web_devmenu_load_stage?: (category: number, stage: number) => void;
  web_devmenu_set_paused?: (paused: boolean) => void;
  SDL2?: { audioContext?: AudioContext };
}

type Rsdkv3Factory = (overrides: Record<string, unknown>) => Promise<Rsdkv3Module>;

/** The launcher's handle on RSDKv3's stage list, for drawing its own dev menu. */
export interface RsdkDevMenuBridge {
  getStageList(): Array<{ name: string; stages: Array<{ name: string }> }>;
  loadStage(category: number, stage: number): void;
}

/**
 * Where an engine keeps one namespace: `<engineId>/<namespace>`, relative to the OPFS
 * root. Identical in every wasm-gaming engine, written to move verbatim into
 * engine-specs: segments cleaned, `.` and `..` dropped, anything outside
 * `[A-Za-z0-9._-]` → `_`, nothing usable → `default`; a leading `<engineId>/` is
 * stripped once.
 */
export function storagePath(
  engineId: string,
  namespace: unknown,
): { namespace: string; path: string; prefixed: boolean } {
  const segments =
    typeof namespace === 'string'
      ? namespace
          .split('/')
          .map((segment) => segment.trim())
          .filter((segment) => segment && segment !== '.' && segment !== '..')
          .map((segment) => segment.replace(/[^A-Za-z0-9._-]/g, '_'))
      : [];
  const prefixed = segments.length > 1 && segments[0] === engineId;
  if (prefixed) segments.shift();
  const cleaned = segments.join('/') || DEFAULT_STORAGE_NAMESPACE;
  return { namespace: cleaned, path: `${engineId}/${cleaned}`, prefixed };
}

/** Serialise the engine config into RSDKv3's settings.ini. */
export function buildSettingsIni(config: Rsdkv3Config): string {
  return [
    '[Dev]',
    `EngineDebugMode=${config.engineDebugMode ? 'true' : 'false'}`,
    `DevMenu=${config.devMenu ? 'true' : 'false'}`,
    '',
    '[Game]',
    `Language=${(config.language ?? 0) | 0}`,
    `DisableTouchControls=${config.disableTouchControls === false ? 'false' : 'true'}`,
    '',
    '[Video]',
    'Windowed=true',
    'Borderless=false',
    'ExclusiveFS=false',
    `VSync=${config.vsync ? 'true' : 'false'}`,
    'WindowScale=2',
    `ScreenWidth=${RSDKV3_VIDEO.width}`,
    `ScreenHeight=${RSDKV3_VIDEO.height}`,
    'RefreshRate=60',
    '',
    '[Audio]',
    'BGMVolume=1.000000',
    'SFXVolume=1.000000',
    `Soundtrack=${(config.soundtrack ?? 0) | 0}`,
    '',
  ].join('\n');
}

async function opfsDir(path: string, create: boolean): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null;
  try {
    let dir = await navigator.storage.getDirectory();
    for (const segment of path.split('/').filter(Boolean)) {
      dir = await dir.getDirectoryHandle(segment, { create });
    }
    return dir;
  } catch {
    return null;
  }
}

async function resolveAsset(asset: Rsdkv3Asset | undefined): Promise<Uint8Array | null> {
  const value = typeof asset === 'function' ? await asset() : asset;
  if (value == null) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError('rsdkv3: an asset must be a Uint8Array, an ArrayBuffer or a thunk returning one');
}

function sameBytes(a: Uint8Array | null, b: Uint8Array): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function mkdirp(Module: Rsdkv3Module, path: string): void {
  let current = '';
  for (const part of path.split('/').filter(Boolean)) {
    current += `/${part}`;
    try {
      Module.FS.mkdir(current);
    } catch {
      /* exists */
    }
  }
}

/** The live engine: one booted RSDKv3 and its session. */
export class Rsdkv3Play extends EnginePlayBase<Rsdkv3Payloads> {
  #module: Rsdkv3Module | null = null;
  #destroyed = false;
  #pauseOwner: string | null = null;

  #canvas: HTMLCanvasElement | null = null;
  #ownsCanvas = false;
  #box: HTMLElement | null = null;
  #boxObserver: ResizeObserver | null = null;

  #namespace = DEFAULT_STORAGE_NAMESPACE;
  #storagePath = `${ENGINE_ID}/${DEFAULT_STORAGE_NAMESPACE}`;
  #workDir = `${WORK_ROOT}/${ENGINE_ID}/${DEFAULT_STORAGE_NAMESPACE}`;
  #persist = true;
  #saveTimer: ReturnType<typeof setInterval> | null = null;
  #lastSave: Uint8Array | null = null;
  #flushing: Promise<void> | null = null;
  #onHidden = (): void => {
    if (document.visibilityState === 'hidden') void this.flushSaves();
  };

  constructor(init?: EngineInit<Rsdkv3Payloads>, events?: EventEmitter<EventsOf<Rsdkv3Payloads>>) {
    super(RSDKV3_SPEC, init, events);
  }

  get namespace(): string {
    return this.#namespace;
  }

  /** Where this session's files live, relative to the OPFS root: `rsdkv3/<namespace>`. */
  get storagePath(): string {
    return this.#storagePath;
  }

  get pausedBy(): string | null {
    return this.#pauseOwner;
  }

  /** RSDKv3's stage list, for a host that draws its own stage select. */
  get devMenu(): RsdkDevMenuBridge {
    const Module = (): Rsdkv3Module | null => this.#module;
    return {
      getStageList() {
        try {
          return JSON.parse(Module()?.web_devmenu_get_stage_list?.() ?? '[]');
        } catch {
          return [];
        }
      },
      loadStage(category: number, stage: number) {
        Module()?.web_devmenu_load_stage?.(category | 0, stage | 0);
      },
    };
  }

  /**
   * Freeze the game and its sound. The first caller owns the pause; only that
   * owner's {@link resume} lifts it. The save is flushed.
   */
  pause(owner = 'host'): void {
    const Module = this.#module;
    if (!Module || this.#pauseOwner) return;
    this.#pauseOwner = owner;
    Module.web_devmenu_set_paused?.(true);
    void Module.SDL2?.audioContext?.suspend();
    void this.flushSaves();
    this.emit('pause', { owner });
  }

  resume(owner = 'host'): void {
    const Module = this.#module;
    if (!Module || this.#pauseOwner !== owner) return;
    this.#pauseOwner = null;
    void Module.SDL2?.audioContext?.resume();
    Module.web_devmenu_set_paused?.(false);
    this.emit('resume', { owner });
  }

  /** Copy `SData.bin` to OPFS `rsdkv3/<namespace>/` if it changed; emits `saves`. */
  flushSaves(): Promise<void> {
    this.#flushing ??= this.#flush().finally(() => {
      this.#flushing = null;
    });
    return this.#flushing;
  }

  // ---- Contract hooks ----

  protected override mounted(target: HTMLElement): void {
    if (target instanceof HTMLCanvasElement) {
      this.#canvas = target;
      this.#ownsCanvas = false;
      this.#box = target.parentElement;
    } else {
      this.#canvas = document.createElement('canvas');
      this.#ownsCanvas = true;
      this.#box = target;
      target.appendChild(this.#canvas);
    }
    // Emscripten's SDL2 port finds its window with querySelector('#canvas').
    this.#canvas.id = 'canvas';
    this.#canvas.tabIndex = 0;
    this.#canvas.style.display = 'block';
    this.#canvas.style.imageRendering = 'pixelated';
    this.#canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    if (this.#ownsCanvas && this.#box) {
      this.#boxObserver?.disconnect();
      this.#boxObserver = new ResizeObserver(() => this.#fit());
      this.#boxObserver.observe(this.#box);
    }
  }

  protected override async open(_options: Rsdkv3Options): Promise<void> {
    if (this.#destroyed || this.#module) {
      // RSDKv3 cannot restart in process: main() runs once and owns the loop.
      throw new Error('rsdkv3: the engine cannot be restarted in process — destroy() and start a new page (or iframe)');
    }
    await this.#boot();
  }

  protected override patched(_kind: PayloadKind, _patch: object): void {
    // Nothing in RSDKV3_SPEC is live: settings.ini is read once, at boot.
  }

  protected override async close(): Promise<void> {
    if (this.#saveTimer) clearInterval(this.#saveTimer);
    this.#saveTimer = null;
    document.removeEventListener('visibilitychange', this.#onHidden);
    window.removeEventListener('pagehide', this.#onHidden);
    const Module = this.#module;
    if (Module) {
      await this.flushSaves();
      try {
        Module.web_devmenu_set_paused?.(true);
        Module.pauseMainLoop?.();
      } catch {
        /* already stopped */
      }
      try {
        await Module.SDL2?.audioContext?.close();
      } catch {
        /* already closed */
      }
    }
    this.#boxObserver?.disconnect();
    this.#boxObserver = null;
    if (this.#ownsCanvas) this.#canvas?.remove();
    this.#canvas = null;
    this.#module = null;
    this.#pauseOwner = null;
    this.#destroyed = true;
  }

  // ---- Boot ----

  async #boot(): Promise<void> {
    const config = await this.#values<Rsdkv3Config>('config');
    const assets = await this.#values<{ data?: Rsdkv3Asset; settings?: Rsdkv3Asset }>('assets');
    const storage = await this.#values<{ namespace?: string; persist?: 'opfs' | null }>('storage');
    if (!this.#canvas) throw new Error('rsdkv3: mount() an element (or a canvas) before start()');

    const data = await resolveAsset(assets.data);
    if (!data) throw new Error('rsdkv3: no Data.rsdk — hand one over as assets.data (bytes or a thunk)');
    const settings = await resolveAsset(assets.settings);

    const resolved = storagePath(ENGINE_ID, storage.namespace);
    if (resolved.prefixed) {
      console.warn(`[rsdkv3] storage.namespace no longer needs the "${ENGINE_ID}/" prefix. Pass "${resolved.namespace}".`);
    }
    this.#namespace = resolved.namespace;
    this.#storagePath = resolved.path;
    this.#workDir = `${WORK_ROOT}/${resolved.path}`;
    this.#persist = storage.persist !== null;

    const jsUrl = config.jsUrl ?? new URL('./rsdkv3.js', import.meta.url).href;
    const wasmUrl = config.wasmUrl ?? new URL('./rsdkv3.wasm', import.meta.url).href;
    const { default: createRSDKv3 } = (await import(/* @vite-ignore */ jsUrl)) as { default: Rsdkv3Factory };

    let failed: ((error: Error) => void) | null = null;
    const Module = await createRSDKv3({
      canvas: this.#canvas,
      noInitialRun: true,
      locateFile: (path: string) => (path.endsWith('.wasm') ? wasmUrl : new URL(path, jsUrl).href),
      print: (text: string) => console.log('[rsdkv3]', text),
      printErr: (text: string) => console.warn('[rsdkv3]', text),
      onAbort: (what: unknown) => failed?.(new Error(`rsdkv3: aborted — ${String(what)}`)),
    });
    this.#module = Module;
    failed = (error) => this.emit('error', error);

    mkdirp(Module, this.#workDir);
    Module.FS.writeFile(`${this.#workDir}/Data.rsdk`, data);
    Module.FS.writeFile(
      `${this.#workDir}/settings.ini`,
      settings ?? new TextEncoder().encode(buildSettingsIni(config)),
    );
    if (this.#persist) await this.#restoreSave();

    Module.FS.chdir(this.#workDir);
    Module.callMain(['UsingCWD']);

    if (this.#persist) {
      this.#saveTimer = setInterval(() => void this.flushSaves(), SAVE_INTERVAL_MS);
      document.addEventListener('visibilitychange', this.#onHidden);
      window.addEventListener('pagehide', this.#onHidden);
    }
    this.#fit();
  }

  async #values<T>(kind: 'config' | 'assets' | 'storage'): Promise<T> {
    const described = (await this[kind]()) as Record<string, { value: unknown }>;
    const out: Record<string, unknown> = {};
    for (const [key, property] of Object.entries(described)) out[key] = property.value;
    return out as T;
  }

  // ---- Save mirror ----

  async #restoreSave(): Promise<void> {
    const dir = await opfsDir(this.#storagePath, false);
    if (!dir || !this.#module) return;
    try {
      const file = await (await dir.getFileHandle(SAVE_FILE)).getFile();
      if (file.size === 0) return;
      const bytes = new Uint8Array(await file.arrayBuffer());
      this.#module.FS.writeFile(`${this.#workDir}/${SAVE_FILE}`, bytes);
      this.#lastSave = bytes;
    } catch {
      /* no save yet */
    }
  }

  async #flush(): Promise<void> {
    const Module = this.#module;
    if (!Module || !this.#persist) return;
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = new Uint8Array(Module.FS.readFile(`${this.#workDir}/${SAVE_FILE}`));
    } catch {
      return; // the game has not saved yet
    }
    if (sameBytes(this.#lastSave, bytes)) return;
    const dir = await opfsDir(this.#storagePath, true);
    if (!dir) return;
    try {
      const writable = await (await dir.getFileHandle(SAVE_FILE, { create: true })).createWritable();
      await writable.write(bytes);
      await writable.close();
      this.#lastSave = bytes;
      this.emit('saves', { files: [SAVE_FILE] });
    } catch (e) {
      console.warn('[rsdkv3] could not persist the save', e);
    }
  }

  // ---- Picture ----

  #fit(): void {
    const canvas = this.#canvas;
    const box = this.#box;
    if (!canvas || !box || !this.#ownsCanvas) return;
    const { width, height } = box.getBoundingClientRect();
    if (!width || !height) return;
    const scale = Math.min(width / RSDKV3_VIDEO.width, height / RSDKV3_VIDEO.height);
    canvas.style.width = `${Math.floor(RSDKV3_VIDEO.width * scale)}px`;
    canvas.style.height = `${Math.floor(RSDKV3_VIDEO.height * scale)}px`;
  }
}

/** The factory a host constructs: static identity, the configuration chain, `start()`. */
export class Rsdkv3SDK extends EngineSDKBase<Rsdkv3Payloads> {
  static readonly id = ENGINE_ID;
  /** Kept in step with package.json by `node scripts/sync-version.mjs`. */
  static readonly version = '0.1.5';
  static readonly name = 'Retro Software Development Kit v3';
  static readonly description =
    'RSDKv3 (Sonic CD 2011 decompilation) compiled to WebAssembly. Ships none of the game: the player provides Data.rsdk, and it never leaves their browser.';

  protected override createPlay(
    init: EngineInit<Rsdkv3Payloads>,
    events: EventEmitter<EventsOf<Rsdkv3Payloads>>,
  ): Rsdkv3Play {
    return new Rsdkv3Play(init, events);
  }
}

/** CI's conformance line: if this class stops satisfying the contract, `make test` fails. */
export const RSDKV3_ENGINE: EngineSDKConstructor<Rsdkv3Payloads> = Rsdkv3SDK;

export default Rsdkv3SDK;
