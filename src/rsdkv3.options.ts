// Engine-specific options for RSDKv3.
//
// This is the authoritative description of what `EngineConfig.options` accepts
// for this engine. It provides both:
//   - `Rsdkv3Options`          — compile-time type for TS hosts
//   - `RSDKV3_OPTIONS_SCHEMA`  — JSON Schema mirrored into manifest.json
//   - `DEFAULT_RSDKV3_OPTIONS` — defaults used when no settings.ini is supplied
//
// At runtime these options are serialized into Sonic CD's `settings.ini` format
// when the host does not pass an explicit `settings` asset.

import type { JSONSchema } from '@wasm-gaming/wasm-specs';

export interface Rsdkv3Options {
  /**
   * RSDKv3's native in-canvas Dev Menu. Kept off by default: the launcher owns
   * the debug/stage-select UI (via `instance.devMenu`), and leaving this on has
   * historically produced a native menu-like screen at boot.
   */
  devMenu?: boolean;
  /** RSDKv3 EngineDebugMode — enables the web devmenu embind bridge hooks. */
  engineDebugMode?: boolean;
  /** VSync setting in the generated settings.ini. */
  vsync?: boolean;
  /** 0 = JP/EU soundtrack, 1 = US soundtrack. */
  soundtrack?: number;
  /** 0 = English. Matches RSDKv3 language numeric value. */
  language?: number;
  /** Toggle touch controls in the generated settings.ini. */
  disableTouchControls?: boolean;
}

export const DEFAULT_RSDKV3_OPTIONS: Required<Rsdkv3Options> = {
  devMenu: false,
  engineDebugMode: false,
  vsync: false,
  soundtrack: 0,
  language: 0,
  disableTouchControls: true,
};

export const RSDKV3_OPTIONS_SCHEMA: JSONSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    devMenu: {
      type: 'boolean',
      default: false,
      description:
        "RSDKv3's native in-canvas Dev Menu. The launcher provides its own overlay via instance.devMenu, so keep this off.",
    },
    engineDebugMode: {
      type: 'boolean',
      default: false,
      description: 'Enables the web devmenu embind bridge (stage list / warp / pause).',
    },
    vsync: { type: 'boolean', default: false },
    soundtrack: {
      type: 'integer',
      minimum: 0,
      maximum: 1,
      default: 0,
      description: 'Sonic CD soundtrack selector: 0=JP/EU, 1=US.',
    },
    language: { type: 'integer', minimum: 0, default: 0 },
    disableTouchControls: { type: 'boolean', default: true },
  },
};
