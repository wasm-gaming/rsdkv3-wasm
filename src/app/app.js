// rsdkv3's own app: what a host gets when it mounts this engine instead of driving
// the SDK itself — a boot screen, then the game with its OWN title and save select,
// and a pause menu on the wasm-gaming usability scheme (engine-specs UX.md).
//
//   import * as app from '<engines>/rsdkv3/app/app.js'
//   const handle = await app.mount(target, host)   // EngineApp.mount
//   await handle.unmount()
//
// `host` is engine-specs' EngineAppHost: { game, storage, assets, input, exit }. The
// input is the host's createInput(): resumed it delivers menu actions; suspended (in
// game) only Select+Start and Escape come through, as `menu`.
//
// Unlike rsdkv4's app there is no load-game screen: Sonic CD's menus are scripts in
// Data.rsdk, with no native bridge to list or start a save (see RECORD/).
//
// Plain JS and DOM on purpose: the app ships inside the engine's package next to the
// SDK and loads from a static server, so it imports nothing but the SDK.

import Rsdkv3SDK, { RSDKV3_CONTROLS } from '../rsdkv3.sdk.js';
import {
  SHARED_SETTINGS,
  controlsModel,
  createFullscreenToggle,
  createPerfCounter,
  createSettingsScreen,
  createWakeLock,
  loadSettings,
  menuKeyAliases,
  menuKeyHint,
  PAD_BUTTON_NAMES,
  resolveLocale,
  saveSettings,
  settingsDefaults,
  settingsModel,
} from '../engine-specs.js';

const ENGINE = 'rsdkv3';
const OWNER = 'app';
const ENGINE_ID = 'rsdkv3';

/** The app's words, in English and Spanish (engine-specs UX.md, "Languages"). */
const STRINGS = {
  booting: { en: 'Starting the engine…', es: 'Arrancando el motor…' },
  bootFailed: { en: 'Could not start', es: 'No se pudo arrancar' },
  back: { en: 'Back', es: 'Volver' },
  chooseGame: { en: 'Choose a game', es: 'Elige partida' },
  game: { en: 'game', es: 'partida' },
  character: { en: 'character', es: 'personaje' },
  continueHint: { en: 'continue', es: 'continuar' },
  playHint: { en: 'play', es: 'jugar' },
  deleteHint: { en: 'delete', es: 'borrar' },
  backHint: { en: 'back', es: 'volver' },
  quitHint: { en: 'quit', es: 'salir' },
  choose: { en: 'choose', es: 'elegir' },
  paused: { en: 'Paused', es: 'Pausa' },
  continue: { en: 'Continue', es: 'Continuar' },
  changeGame: { en: 'Change game', es: 'Cambiar de partida' },
  changeGameHint: { en: 'back to the saved games', es: 'vuelve a las partidas guardadas' },
  packScreenHint: { en: "the game's own screen", es: 'pantalla del propio juego' },
  settings: { en: 'Settings', es: 'Ajustes' },
  fullscreen: { en: 'Fullscreen', es: 'Pantalla completa' },
  fullscreenHint: { en: 'Alt+Enter · Select + Y', es: 'Alt+Enter · Select + Y' },
  fullscreenHintMac: { en: 'Cmd+Enter · Select + Y', es: 'Cmd+Enter · Select + Y' },
  exit: { en: 'Back to the launcher', es: 'Volver al lanzador' },
  leaveAsk: { en: 'Back to the launcher?', es: '¿Volver al lanzador?' },
  leaveText: { en: 'The game saves where the game itself saves.', es: 'La partida se guarda donde la guarde el juego.' },
  leave: { en: 'Leave', es: 'Salir' },
  stay: { en: 'Stay', es: 'Seguir' },
  deleteAsk: { en: 'Delete game {n}?', es: '¿Borrar la partida {n}?' },
  noUndo: { en: 'This cannot be undone.', es: 'No se puede deshacer.' },
  delete: { en: 'Delete', es: 'Borrar' },
  cancel: { en: 'Cancel', es: 'Cancelar' },
  levelSelect: { en: 'Level select', es: 'Selector de nivel' },
  titleScreen: { en: 'Title screen', es: 'Pantalla de título' },
  gameMenu: { en: "The game's menu", es: 'Menú del juego' },
  stageMenu: { en: 'Stage menu', es: 'Menú de fases' },
  sonicAndTails: { en: 'Sonic and Tails', es: 'Sonic y Tails' },
};

const DIRECTIONS = {
  up: { en: 'Up', es: 'Arriba' },
  down: { en: 'Down', es: 'Abajo' },
  left: { en: 'Left', es: 'Izquierda' },
  right: { en: 'Right', es: 'Derecha' },
};
/** The pad's buttons, for Ajustes → Controles. */
const BUTTONS = RSDKV3_CONTROLS.map((c) => ({ id: c.id, label: DIRECTIONS[c.id] ?? c.label }));
const DEFAULT_CONTROLS = Object.fromEntries(RSDKV3_CONTROLS.map((c) => [c.id, { code: c.code, button: c.button }]));
/** Bindings (engine-specs) → what `play.setControls()` takes. */
const toControls = (bindings) => ({
  keys: Object.fromEntries(Object.entries(bindings).filter(([, b]) => b.code).map(([id, b]) => [id, b.code])),
  buttons: Object.fromEntries(Object.entries(bindings).filter(([, b]) => Number.isInteger(b.button)).map(([id, b]) => [id, b.button])),
});

/**
 * The game's own screens worth jumping to from the pause menu, looked up by scene
 * name in the live stage list. Only the ones the loaded Data.rsdk has are offered.
 */
export const GAME_SCREENS = [
  { match: /^TITLE( SCREEN)?$/i, key: 'titleScreen' },
  { match: /^(MAIN MENU|MENU|SAVE SELECT|STAGE MENU)$/i, key: 'gameMenu' },
  { match: /^(LEVEL|STAGE) SELECT$/i, key: 'levelSelect' }, // Sonic CD: STAGE SELECT
];

/** `[{ key, list, scene }]` for the GAME_SCREENS found in a devMenu stage list (`key` names it in STRINGS). */
export const findGameScreens = (lists) => {
  const found = [];
  for (const screen of GAME_SCREENS) {
    for (let list = 0; list < (lists?.length ?? 0); list++) {
      const scene = (lists[list]?.stages ?? []).findIndex(({ name } = {}) => screen.match.test(String(name ?? '').trim()));
      if (scene >= 0) {
        found.push({ key: screen.key, list, scene });
        break;
      }
    }
  }
  return found;
};

const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let cssLoaded = null;
const loadCss = () =>
  (cssLoaded ??= new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./app.css', import.meta.url).href;
    link.onload = link.onerror = () => resolve();
    document.head.append(link);
  }));

export async function mount(target, host) {
  await loadCss();

  const locale = host.locale ?? resolveLocale();
  const t = (key, params = {}) =>
    (STRINGS[key]?.[locale] ?? STRINGS[key]?.en ?? key).replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));

  const root = document.createElement('div');
  root.className = 'rsdk-app';
  root.style.setProperty('--accent', host.game?.accent ?? '#1d4ed8');
  const stage = document.createElement('div');
  stage.className = 'rsdk-stage';
  const overlay = document.createElement('div');
  overlay.className = 'rsdk-overlay';
  root.append(stage, overlay);
  target.append(root);

  /** screen: 'boot' | 'game' | 'pause' | 'confirm' | 'error' */
  const state = {
    screen: 'boot',
    status: t('booting'),
    error: null,
    pause: { items: [], focus: 0 },
    confirm: null, // { title, text, yes, no, onYes, onNo, focus, under }
  };

  let play = null;
  let leaving = false;
  let destroyed = false;

  const canvasFocus = () => stage.querySelector('canvas')?.focus({ preventScroll: true });
  const title = () => host.game?.title ?? 'Sonic CD';

  // ---- screens ------------------------------------------------------------------

  // A pad button in a hint shows the key bound to it next to it ("B" "S"), when that key
  // works in the menus too (menuControls / menuKeyAliases, engine-specs 0.6.2).
  const keyOf = (k) => {
    const button = PAD_BUTTON_NAMES.indexOf(k);
    const key = button >= 0 ? menuKeyHint(menuControls(), button) : '';
    return key && key !== k ? `<kbd class="key">${esc(key)}</kbd>` : '';
  };
  const hints = (pairs) =>
    `<footer class="rsdk-hints">${pairs.map(([k, t]) => `<span><kbd>${k}</kbd>${keyOf(k)}${t}</span>`).join('')}</footer>`;

  const render = () => {
    if (destroyed) return;
    const s = state.screen;
    wake.setActive(s === 'game' && setting('keepScreenOn') !== false);
    if (s === 'settings') return;
    root.dataset.screen = state.screen;
    if (s === 'game') {
      overlay.innerHTML = '';
      return;
    }
    if (s === 'boot') {
      overlay.innerHTML = `<section class="rsdk-boot">
        ${host.game?.art ? `<img src="${esc(host.game.art)}" alt="">` : ''}
        <p>${esc(state.status)}</p>
      </section>`;
      return;
    }
    if (s === 'error') {
      overlay.innerHTML = `<section class="rsdk-panel">
        <p class="kicker">${esc(title())}</p>
        <h2>${esc(t('bootFailed'))}</h2>
        <p class="text">${esc(state.error)}</p>
        <button class="item is-focused" data-exit>${esc(t('back'))}</button>
      </section>`;
      return;
    }
    let html = '';
    const base = s === 'confirm' ? state.confirm.under : s;
    if (base === 'pause') {
      html += `<section class="rsdk-panel">
        <p class="kicker">${esc(title())}</p>
        <h2>${esc(t('paused'))}</h2>
        ${state.pause.items.map((item, i) => `<button class="item${i === state.pause.focus && s !== 'confirm' ? ' is-focused' : ''}" data-item="${i}">${esc(item.label)}${item.hint ? `<small>${esc(item.hint)}</small>` : ''}</button>`).join('')}
        ${hints([['A', t('choose')], ['B', t('continueHint')]])}
      </section>`;
    }
    if (s === 'confirm') {
      const c = state.confirm;
      html += `<div class="rsdk-confirm"><section class="rsdk-panel">
        <h2>${esc(c.title)}</h2>
        ${c.text ? `<p class="text">${esc(c.text)}</p>` : ''}
        <div class="row">
          <button class="item${c.focus === 0 ? ' is-focused' : ''}" data-confirm="0">${esc(c.no)}</button>
          <button class="item is-danger${c.focus === 1 ? ' is-focused' : ''}" data-confirm="1">${esc(c.yes)}</button>
        </div>
      </section></div>`;
    }
    overlay.innerHTML = html;
  };

  // ---- transitions --------------------------------------------------------------

  const enterGame = () => {
    state.screen = 'game';
    render();
    host.input.suspend();
    canvasFocus();
  };

  const gameScreens = () => {
    try {
      return findGameScreens(play.devMenu.getStageList());
    } catch {
      return [];
    }
  };

  const openPause = () => {
    play?.pause(OWNER);
    state.pause = {
      focus: 0,
      items: [
        { label: t('continue'), run: closePause },
        ...gameScreens().map((screen) => ({
          label: t(screen.key),
          hint: t('packScreenHint'),
          run: () => {
            closePause();
            play.devMenu.loadStage(screen.list, screen.scene);
          },
        })),
        { label: t('settings'), run: openSettings },
        {
          label: t('fullscreen'),
          hint: /mac|iphone|ipad/i.test(navigator.userAgentData?.platform || navigator.platform || '') ? t('fullscreenHintMac') : t('fullscreenHint'),
          run: () => fullscreen.toggle(),
        },
        { label: t('exit'), run: askExit },
      ],
    };
    state.screen = 'pause';
    host.input.resume();
    render();
  };

  const closePause = () => {
    enterGame();
    play?.resume(OWNER);
  };

  // A confirm sits on top of the screen it was asked from and goes back to it.
  const ask = (options) => {
    state.confirm = { focus: 0, under: state.screen, ...options };
    state.screen = 'confirm';
    render();
  };
  const answer = (yes) => {
    const c = state.confirm;
    state.screen = c.under;
    state.confirm = null;
    render();
    (yes ? c.onYes : c.onNo)?.();
  };

  const exit = async () => {
    if (leaving) return;
    leaving = true;
    try {
      await play?.destroy();
    } catch (error) {
      console.warn(`[${ENGINE} app] destroy failed`, error);
    }
    play = null;
    host.exit();
  };

  const askExit = () =>
    ask({ title: t('leaveAsk'), text: t('leaveText'), yes: t('leave'), no: t('stay'), onYes: exit });

  // ---- settings, fullscreen, performance (engine-specs 0.6) -----------------------

  // The player's choices, per engine (OPFS settings/<engine>.json): the engine's config
  // (smoothing), the shared ones (keep the screen on, show performance) and the controls.
  let saved = { version: 1, values: {}, controls: {} };
  const setting = (key) => (key in saved.values ? saved.values[key] : SHARED_SETTINGS[key]?.default);
  const store = () => saveSettings(ENGINE_ID, saved).catch((error) => console.warn(`[${ENGINE_ID} app] settings not saved`, error));
  const engineValues = () =>
    Object.fromEntries(Object.entries(saved.values).filter(([key]) => !(key in SHARED_SETTINGS)));

  const fullscreen = createFullscreenToggle(root);
  const wake = createWakeLock();
  // The engine runs its own loop and reports no frames: the counter counts the display's.
  const perf = createPerfCounter(root, { locale });
  const applyShared = () => {
    if (setting('showPerformance')) perf.show();
    else perf.hide();
    wake.setActive(state.screen === 'game' && setting('keepScreenOn') !== false);
  };

  let screen = null;
  // Only the config's labelled rows are settings: the pack's GAME OPTIONS stay in the game.
  const described = async () => ({ ...(await play.config()), ...SHARED_SETTINGS });
  const controlRows = () => controlsModel(BUTTONS, DEFAULT_CONTROLS, saved.controls, locale);
  /** The engine's buttons: the player's key, and the pad button the menus read it as (the default). */
  const menuControls = () =>
    Object.entries(DEFAULT_CONTROLS).map(([id, d]) => ({ code: saved.controls[id]?.code ?? d.code, button: d.button }));
  /** The keys bound to the pad's menu buttons work in the menus too (the launcher's input). */
  const applyMenuKeys = () => host.input.setKeyAliases?.(menuKeyAliases(menuControls()));

  const openSettings = async () => {
    const all = await described();
    state.screen = 'settings';
    render();
    overlay.innerHTML = '';
    const layer = document.createElement('div');
    layer.className = 'rsdk-confirm rsdk-settings';
    overlay.append(layer);
    screen = createSettingsScreen(layer, {
      sections: settingsModel(all, saved.values, locale),
      controls: controlRows(),
      input: host.input,
      locale,
      onChange(key, value) {
        saved.values = { ...saved.values, [key]: value };
        if (key in SHARED_SETTINGS) applyShared();
        else play.config({ [key]: value });
        void store();
      },
      onControl(_id, _binding, bindings) {
        saved.controls = bindings;
        play.setControls(toControls(bindings));
        applyMenuKeys();
        void store();
      },
      onReset() {
        const defaults = settingsDefaults(all);
        saved = { version: 1, values: {}, controls: {} };
        play.config(Object.fromEntries(Object.entries(defaults).filter(([key]) => !(key in SHARED_SETTINGS))));
        play.setControls({});
        applyMenuKeys();
        applyShared();
        void store();
        screen.update(settingsModel(all, defaults, locale), controlRows());
      },
      onClose: () => {
        screen?.destroy();
        screen = null;
        openPause();
      },
    });
  };

  // ---- input ----------------------------------------------------------------------

  const onPause = (action) => {
    const p = state.pause;
    if (action === 'up') p.focus = (p.focus + p.items.length - 1) % p.items.length;
    else if (action === 'down') p.focus = (p.focus + 1) % p.items.length;
    else if (action === 'accept') return p.items[p.focus].run();
    else if (action === 'back' || action === 'menu') return closePause();
    else return;
    render();
  };

  const onConfirm = (action) => {
    const c = state.confirm;
    if (action === 'left' || action === 'up') c.focus = 0;
    else if (action === 'right' || action === 'down') c.focus = 1;
    else if (action === 'accept') return answer(c.focus === 1);
    else if (action === 'back') return answer(false);
    else return;
    render();
  };

  const off = host.input.on((action) => {
    if (leaving) return;
    const s = state.screen;
    if (s === 'settings') return;
    if (s === 'game') {
      if (action === 'menu') openPause();
    } else if (s === 'pause') onPause(action);
    else if (s === 'confirm') onConfirm(action);
    else if (s === 'error' && (action === 'accept' || action === 'back')) exit();
    else if (s === 'boot' && action === 'back') exit();
  });

  // Pointer: hover focuses, click activates — the same paths as the pad. Hover is read
  // from real movement only: every render replaces the buttons, and the browser fires
  // a fresh pointerover for whatever lands under a resting cursor.
  let lastPointer = '';
  const onPointer = (event) => {
    if (event.type === 'pointermove') {
      const at = `${event.clientX},${event.clientY}`;
      if (at === lastPointer) return;
      lastPointer = at;
    }
    const el = event.target.closest('[data-item],[data-confirm],[data-exit]');
    if (!el || leaving) return;
    if (event.type === 'pointermove') {
      if (el.dataset.item != null && state.screen === 'pause' && state.pause.focus !== +el.dataset.item) {
        state.pause.focus = +el.dataset.item;
        render();
      }
      return;
    }
    if (el.dataset.item != null) state.pause.items[+el.dataset.item].run();
    else if (el.dataset.confirm != null) answer(el.dataset.confirm === '1');
    else if (el.dataset.exit != null) exit();
  };
  overlay.addEventListener('click', onPointer);
  overlay.addEventListener('pointermove', onPointer);

  const handle = {
    async unmount() {
      host.input.setKeyAliases?.({});
      destroyed = true;
      leaving = true;
      off();
      overlay.removeEventListener('click', onPointer);
      overlay.removeEventListener('pointermove', onPointer);
      try {
        await play?.destroy();
      } catch {
        /* already gone */
      }
      play = null;
      screen?.destroy();
      fullscreen.destroy();
      wake.destroy();
      perf.destroy();
      root.remove();
    },
  };

  // ---- boot -----------------------------------------------------------------------

  render();
  host.input.resume();
  try {
    saved = await loadSettings(ENGINE_ID);
    play = await new Rsdkv3SDK()
      .mount(stage)
      .assets(host.assets)
      .storage(host.storage)
      // The saved smoothing and soundtrack: the engine's config.
      .config(engineValues())
      .on('error', ({ detail }) => console.error(`[${ENGINE} app]`, detail))
      .on('exit', () => exit())
      .start();
    if (destroyed) {
      // Unmounted while booting: nothing to show any more.
      await play.destroy().catch(() => {});
      play = null;
      return handle;
    }
    play.setControls(toControls({ ...DEFAULT_CONTROLS, ...saved.controls }));
    applyMenuKeys();
    applyShared();
    enterGame();
  } catch (error) {
    console.error(`[${ENGINE} app]`, error);
    state.error = error?.message ?? String(error);
    state.screen = 'error';
    render();
  }

  return handle;
}
