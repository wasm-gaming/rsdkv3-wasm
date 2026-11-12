/**
 * What RSDKv3 accepts, as types and as data.
 *
 * The four payloads of the wasm-gaming engine contract, closed for this engine, and
 * {@link RSDKV3_SPEC} — the same thing as data the contract's base class reads:
 * every default lives there and nowhere else.
 */
import type { EnginePayloads, EngineSpec } from '@wasm-gaming/engine-specs';

/** Bytes, or a thunk that produces them only when the engine actually needs them. */
export type Rsdkv3Asset =
  | Uint8Array
  | ArrayBuffer
  | null
  | (() => Uint8Array | ArrayBuffer | null | Promise<Uint8Array | ArrayBuffer | null>);

/** The engine, written into the generated `settings.ini`. Fixed for the life of the wasm. */
export interface Rsdkv3Config {
  /** RSDKv3's native in-canvas Dev Menu. A host draws its own from `play.devMenu`. */
  devMenu?: boolean;
  /** RSDKv3 `EngineDebugMode`. */
  engineDebugMode?: boolean;
  vsync?: boolean;
  /** Sonic CD soundtrack: 0 = JP/EU, 1 = US. */
  soundtrack?: 0 | 1;
  /** RSDKv3 language index (0 = English). */
  language?: number;
  disableTouchControls?: boolean;
  /** Emscripten glue URL. Defaults to `./rsdkv3.js` next to the SDK. */
  jsUrl?: string;
  /** WASM URL. Defaults to `./rsdkv3.wasm` next to the SDK. */
  wasmUrl?: string;
}

/** The session. Nothing per-session yet. */
export type Rsdkv3Options = Record<string, never>;

export interface Rsdkv3Assets {
  /** The game's `Data.rsdk` (Sonic CD). Required to start. */
  data?: Rsdkv3Asset;
  /** A ready-made `settings.ini`; omitted, one is generated from `config`. */
  settings?: Rsdkv3Asset;
}

/** Where this engine's files live, and whether they outlive the page. */
export interface Rsdkv3Storage {
  /**
   * Per-game folder, relative to the engine's own: files land in `rsdkv3/<namespace>/`
   * (WASMFS `/data/rsdkv3/<namespace>`, and the OPFS folder the save is mirrored to).
   * Segments are cleaned (`.`/`..` dropped, odd characters → `_`); a leading
   * `rsdkv3/` is stripped once. `play.storagePath` gives the result.
   *
   * @defaultValue `"default"`
   */
  namespace?: string;
  /** `null` keeps nothing; otherwise `SData.bin` is mirrored to OPFS. */
  persist?: 'opfs' | null;
}

export interface Rsdkv3Events {
  /** `SData.bin` changed and was written to `rsdkv3/<namespace>/`. */
  saves: { files: string[] };
}

export interface Rsdkv3Payloads extends EnginePayloads {
  config: Rsdkv3Config;
  options: Rsdkv3Options;
  assets: Rsdkv3Assets;
  storage: Rsdkv3Storage;
  events: Rsdkv3Events;
}

/** The native picture, which the SDK scales to fit its mount. */
export const RSDKV3_VIDEO = { width: 426, height: 240, aspect: '16:9' } as const;

export const RSDKV3_SPEC: EngineSpec<Rsdkv3Payloads> = {
  config: {
    devMenu: {
      default: false,
      live: false,
      description: "RSDKv3's native Dev Menu; keep it off and draw your own from play.devMenu.",
    },
    engineDebugMode: { default: false, live: false, description: 'RSDKv3 EngineDebugMode.' },
    vsync: { default: false, live: false, description: 'VSync in the generated settings.ini.' },
    soundtrack: { default: 0, enum: [0, 1], live: false, description: 'Sonic CD soundtrack: 0 = JP/EU, 1 = US.' },
    language: { default: 0, live: false, description: 'RSDKv3 language index (0 = English).' },
    disableTouchControls: { default: true, live: false, description: 'Hide the touch controls.' },
    jsUrl: { live: false, description: 'Emscripten glue URL. Defaults to ./rsdkv3.js.' },
    wasmUrl: { live: false, description: 'WASM URL. Defaults to ./rsdkv3.wasm.' },
  },
  options: {},
  assets: {
    data: {
      allowedTypes: ['.rsdk'],
      live: false,
      description: 'The RSDKv3 game data pack (Sonic CD). Required to start.',
    },
    settings: {
      allowedTypes: ['.ini'],
      live: false,
      description: 'A ready-made settings.ini. Omitted, one is generated from config.',
    },
  },
  storage: {
    namespace: {
      default: 'default',
      live: false,
      description: "Folder for this game's save, inside the engine's own rsdkv3/ folder (OPFS rsdkv3/<namespace>/).",
    },
    persist: {
      enum: ['opfs', null],
      live: false,
      description: 'null keeps nothing; otherwise SData.bin is mirrored to OPFS.',
    },
  },
};
