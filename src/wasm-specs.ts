export type AssetData = Uint8Array | ArrayBuffer | string;

export interface EngineEventError {
  message?: string;
}

export type EngineEvent =
  | { type: 'ready' }
  | { type: 'error'; error: Error }
  | { type: string; [key: string]: unknown };

export interface EngineConfig {
  canvas?: HTMLCanvasElement;
  assets?: { data?: AssetData; settings?: AssetData };
  options?: unknown;
  onEvent?: (event: EngineEvent) => void;
  jsUrl?: string;
  wasmUrl?: string;
  persist?: 'opfs' | 'idbfs' | null;
}

export interface EngineInstance {
  start(): void;
  pause(): void;
  resume(): void;
  reset(): void;
  setInput(preset?: string): void;
  destroy(): void;
}

export interface JSONSchema {
  type?: string;
  additionalProperties?: boolean;
  properties?: Record<string, unknown>;
}

export interface EngineArtifacts {
  wasm: string;
  js: string;
}

export interface AssetSpec {
  key: string;
  mountPath: string;
  required: boolean;
  accept: string[];
  description?: string;
}

export interface VideoSpec {
  baseWidth: number;
  baseHeight: number;
  aspect: string;
}

export interface EngineCapabilities {
  saveStates: boolean;
  sram: boolean;
  coreSelectable: boolean;
}

export interface EngineManifest {
  id: string;
  version: string;
  name: string;
  artifacts: EngineArtifacts;
  assets: AssetSpec[];
  input: string;
  video: VideoSpec;
  options: JSONSchema;
  capabilities: EngineCapabilities;
}