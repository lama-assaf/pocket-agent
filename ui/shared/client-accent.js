/**
 * Client-identity accent — a CSS custom-property layer (--client-accent) that
 * skins consume rather than fight. Skins (theme-loader.js) define the app's
 * chrome (backgrounds, text, --accent as the Personal/default identity);
 * this file layers a per-workspace brand color on top of whichever skin is
 * active, so switching clients is FELT through color without redefining the
 * skin itself.
 *
 * Resolution order per workspace:
 *   - Personal → no override, ever. --client-accent is cleared so every
 *     consumer falls back to the skin's own --accent. Personal must never
 *     read as "a brand" (explicit product requirement).
 *   - World (Agency) → user override in the 'ui.worldAccentColor' setting
 *     (World has no row in the clients table), else a deterministic
 *     id-derived default.
 *   - Client / Project → user override in that client's accent_color column
 *     (a project inherits its parent client's accent — it doesn't get its
 *     own), else a deterministic name/id-derived default.
 *
 * Contrast: WCAG AA for UI components is 3:1. A raw hash-derived (or
 * user-picked) hue can land well under that against the active skin's
 * background — --client-accent-readable is the same color nudged in
 * lightness (via HSL) until it clears 3:1 against --bg-primary, and is what
 * every consumer should actually paint with. --client-accent itself stays
 * the untouched color (e.g. for the color-picker swatch itself).
 */
(function () {
  var STORAGE_ID_PERSONAL = 'personal';
  var WORLD_ACCENT_SETTING_KEY = 'ui.worldAccentColor';

  function isValidHex(value) {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim());
  }

  // FNV-1a-ish string hash — deterministic, stable across runs/platforms
  // (unlike String.prototype hashCode, which doesn't exist, or relying on
  // insertion order). Only needs to be a stable, well-distributed hue picker,
  // not cryptographically sound.
  function hashString(str) {
    var hash = 2166136261;
    var s = String(str || '');
    for (var i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function hueFromId(id) {
    return hashString(id) % 360;
  }

  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = Math.max(0, Math.min(100, s)) / 100;
    l = Math.max(0, Math.min(100, l)) / 100;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2;
    var r, g, b;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    var toHex = function (v) {
      var n = Math.round((v + m) * 255);
      return (n < 16 ? '0' : '') + n.toString(16);
    };
    return '#' + toHex(r) + toHex(g) + toHex(b);
  }

  function hexToHsl(hex) {
    var PC = window.PocketColor;
    var rgb = PC ? PC.hexToRgb(hex) : null;
    if (!rgb) return { h: 0, s: 0, l: 50 };
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h, s, l = (max + min) / 2;
    if (max === min) {
      h = 0; s = 0;
    } else {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h: h, s: s * 100, l: l * 100 };
  }

  // Deterministic default accent for a client/world id — fixed saturation
  // and lightness so every brand reads as a similarly-weighted color chip;
  // only the hue (from the id hash) varies.
  function defaultAccentFor(id) {
    return hslToHex(hueFromId(id), 68, 56);
  }

  function currentBgHex() {
    var raw = getComputedStyle(document.documentElement).getPropertyValue('--bg-primary');
    return isValidHex(raw) ? raw.trim() : '#21222c';
  }

  // Nudge `hex` in HSL lightness (both directions) until it clears 3:1
  // against the active skin's background — WCAG AA for UI components. Tries
  // up to 9 steps of 6% lightness each way (covers the full 0-100% range)
  // before giving up and returning the skin's own best-contrast color.
  function contrastSafe(hex, bg) {
    var PC = window.PocketColor;
    if (!PC) return hex;
    var MIN_RATIO = 3; // WCAG AA, UI components (not text)
    if (PC.contrastRatio(hex, bg) >= MIN_RATIO) return hex;
    var hsl = hexToHsl(hex);
    for (var step = 1; step <= 9; step++) {
      var lighter = hslToHex(hsl.h, hsl.s, hsl.l + step * 6);
      if (PC.contrastRatio(lighter, bg) >= MIN_RATIO) return lighter;
      var darker = hslToHex(hsl.h, hsl.s, hsl.l - step * 6);
      if (PC.contrastRatio(darker, bg) >= MIN_RATIO) return darker;
    }
    return PC.bestOnColor(bg);
  }

  // Last-applied raw hex (or null for Personal), so a skin change can
  // recompute --client-accent-readable against the new background without
  // re-fetching the workspace/clients list.
  var _lastAppliedHex = null;

  // Pure computation (no DOM writes) of the { accent, readable, onAccent }
  // triple for a hex against the current skin's background, shared by
  // applyClientAccent (the single active-workspace --client-accent layer)
  // and any per-card preview (e.g. the client-picker grid, which shows many
  // clients at once and can't rely on one global CSS var per card).
  function resolveAccentPair(hex) {
    if (!isValidHex(hex)) return null;
    var bg = currentBgHex();
    var PC = window.PocketColor;
    return {
      accent: hex,
      readable: contrastSafe(hex, bg),
      onAccent: PC ? PC.bestOnColor(hex) : '#ffffff'
    };
  }

  // Sets (or clears, for Personal) the --client-accent CSS layer. `hex` null
  // clears the override so every consumer's var(--client-accent, var(--accent))
  // fallback kicks in — the mechanism that keeps Personal neutral.
  function applyClientAccent(hex) {
    var root = document.documentElement;
    _lastAppliedHex = hex && isValidHex(hex) ? hex : null;
    if (!_lastAppliedHex) {
      root.style.removeProperty('--client-accent');
      root.style.removeProperty('--client-accent-readable');
      root.style.removeProperty('--on-client-accent');
      return;
    }
    var pair = resolveAccentPair(_lastAppliedHex);
    root.style.setProperty('--client-accent', pair.accent);
    root.style.setProperty('--client-accent-readable', pair.readable);
    root.style.setProperty('--on-client-accent', pair.onAccent);
  }

  // Re-run the contrast-safe nudge against the *current* skin's background
  // without needing the workspace/clients list again — called after a skin
  // switch, since --bg-primary just changed and a color that cleared 3:1
  // against the old background may not against the new one.
  function reapplyForSkinChange() {
    if (_lastAppliedHex) applyClientAccent(_lastAppliedHex);
  }

  // World's override lives in settings (it has no clients-table row).
  async function getWorldAccentOverride() {
    try {
      if (!window.pocketAgent || !window.pocketAgent.settings) return null;
      var value = await window.pocketAgent.settings.get(WORLD_ACCENT_SETTING_KEY);
      return isValidHex(value) ? value.trim() : null;
    } catch (_) {
      return null;
    }
  }

  async function setWorldAccentOverride(hex) {
    if (!window.pocketAgent || !window.pocketAgent.settings) return;
    await window.pocketAgent.settings.set(WORLD_ACCENT_SETTING_KEY, hex && isValidHex(hex) ? hex.trim() : '');
  }

  // Resolve the effective accent for a workspace + already-fetched clients
  // list (callers like updateActiveClientHeader() already have both), apply
  // it, and return { hex, isOverride, editable } for a picker UI to render.
  async function resolveAndApplyAccent(ws, clients) {
    if (!ws || ws.contextType === STORAGE_ID_PERSONAL) {
      applyClientAccent(null);
      return { hex: null, isOverride: false, editable: false, id: null };
    }
    if (ws.contextType === 'world') {
      var worldOverride = await getWorldAccentOverride();
      var worldHex = worldOverride || defaultAccentFor('world');
      applyClientAccent(worldHex);
      return { hex: worldHex, isOverride: !!worldOverride, editable: true, id: 'world' };
    }
    // 'client' or 'project' — a project inherits its parent client's accent.
    var clientId = ws.clientId;
    var client = (clients || []).find(function (c) { return c.id === clientId; });
    var override = client && isValidHex(client.accent_color) ? client.accent_color.trim() : null;
    var hex = override || defaultAccentFor(clientId || 'client');
    applyClientAccent(hex);
    return { hex: hex, isOverride: !!override, editable: ws.contextType === 'client', id: clientId };
  }

  window.ClientAccent = {
    isValidHex: isValidHex,
    defaultAccentFor: defaultAccentFor,
    resolveAccentPair: resolveAccentPair,
    applyClientAccent: applyClientAccent,
    resolveAndApplyAccent: resolveAndApplyAccent,
    reapplyForSkinChange: reapplyForSkinChange,
    getWorldAccentOverride: getWorldAccentOverride,
    setWorldAccentOverride: setWorldAccentOverride,
  };
})();
