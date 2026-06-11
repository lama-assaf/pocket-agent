(function () {
  var BASELINE = {
    'bg-primary': '#21222c',
    'bg-secondary': '#282a36',
    'bg-tertiary': '#44475a',
    border: '#44475a',
    'text-primary': '#f8f8f2',
    'text-secondary': '#bfc7d5',
    'text-muted': '#7d8ab3',
    accent: '#bd93f9',
    'accent-secondary': '#ff79c6',
    'accent-hover': '#caa9fa',
    error: '#ff5555',
    success: '#50fa7b',
    warning: '#f1fa8c',
    orange: '#ffb86c',
    'user-bubble': '#6272a4',
    'user-bubble-solid': '#6272a4',
    'assistant-bubble': '#44475a'
  };

  function expandHex(value) {
    var hex = String(value || '').trim().replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(function (char) { return char + char; }).join('');
    if (hex.length === 8) hex = hex.slice(0, 6);
    if (hex.length !== 6) return null;
    return hex;
  }

  function hexToRgb(value) {
    var hex = expandHex(value);
    if (!hex) return null;
    return [0, 2, 4].map(function (offset) { return parseInt(hex.slice(offset, offset + 2), 16); });
  }

  function channelToLinear(channel) {
    var normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  }

  function luminance(value) {
    var rgb = hexToRgb(value);
    if (!rgb) return 0;
    return (0.2126 * channelToLinear(rgb[0])) +
      (0.7152 * channelToLinear(rgb[1])) +
      (0.0722 * channelToLinear(rgb[2]));
  }

  function contrastRatio(foreground, background) {
    var fg = luminance(foreground);
    var bg = luminance(background);
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  }

  function bestOnColor(background) {
    return contrastRatio('#ffffff', background) >= contrastRatio('#000000', background)
      ? '#ffffff'
      : '#000000';
  }

  function readableOnSurface(candidate, surface, fallback) {
    if (contrastRatio(candidate, surface) >= 4.5) return candidate;
    if (contrastRatio(fallback, surface) >= 4.5) return fallback;
    return bestOnColor(surface);
  }

  function withDerivedPalette(palette) {
    var p = Object.assign({}, BASELINE, palette || {});
    p['on-accent'] = bestOnColor(p.accent);
    p['on-accent-hover'] = bestOnColor(p['accent-hover']);
    p['on-user-bubble'] = bestOnColor(p['user-bubble']);
    p['on-error'] = bestOnColor(p.error);
    p['accent-readable'] = readableOnSurface(p.accent, p['bg-primary'], p['text-primary']);
    p['success-readable'] = readableOnSurface(p.success, p['bg-primary'], p['text-primary']);
    p['warning-readable'] = readableOnSurface(p.warning, p['bg-primary'], p['text-primary']);
    p['error-readable'] = readableOnSurface(p.error, p['bg-primary'], p['text-primary']);
    return p;
  }

  function applyPalette(palette) {
    var root = document.documentElement;
    var next = withDerivedPalette(palette);
    Object.keys(next).forEach(function (key) {
      root.style.setProperty('--' + key, next[key]);
    });
  }

  window.addEventListener('DOMContentLoaded', function () {
    applyPalette(null);
    if (!window.pocketAgent) return;
    Promise.all([window.pocketAgent.themes.list(), window.pocketAgent.themes.getSkin()]).then(function (res) {
      var themes = res[0];
      var skinId = res[1];
      var theme = themes[skinId];
      applyPalette(theme ? theme.palette : null);
      window.pocketAgent.themes.onSkinChanged(function (id) {
        var nextTheme = themes[id];
        applyPalette(nextTheme ? nextTheme.palette : null);
      });
    }).catch(function () {});
  });
})();

/**
 * Shared toast message sanitizer. Keeps notifications short and human:
 *   - unwraps JSON error payloads to their message field
 *   - strips raw JSON blobs / stack traces
 *   - collapses whitespace and truncates to one tidy sentence
 * Loaded in every window (chat + standalone panels) via theme-loader.
 */
window.cleanToastMessage = function (input) {
  var MAX = 120;
  if (input == null) return 'Something went wrong';
  var msg = typeof input === 'string' ? input : (input && input.message) || String(input);

  var trimmed = msg.trim();
  // If the whole thing is a JSON object/array, pull out a human field.
  if ((trimmed[0] === '{' || trimmed[0] === '[')) {
    try {
      var parsed = JSON.parse(trimmed);
      var picked =
        (parsed && (parsed.error && (parsed.error.message || parsed.error))) ||
        (parsed && (parsed.message || parsed.detail || parsed.msg));
      if (typeof picked === 'string' && picked.trim()) {
        msg = picked;
      } else {
        return 'Something went wrong';
      }
    } catch (e) {
      // Not valid JSON but starts like it — drop the blob.
      return 'Something went wrong';
    }
  }

  // Pull a message out of an embedded JSON fragment, e.g. prefix + {"error":...}.
  var embedded = msg.match(/"(?:message|error|detail)"\s*:\s*"([^"]+)"/);
  if (embedded && embedded[1]) msg = embedded[1];

  // Collapse whitespace/newlines (kills stack traces and pretty-printed JSON).
  msg = msg.replace(/\s+/g, ' ').trim();

  // Cut anything that still looks like a JSON/braces dump.
  var braceAt = msg.indexOf(' {');
  if (braceAt > 0) msg = msg.slice(0, braceAt).trim();

  if (!msg) return 'Something went wrong';
  if (msg.length > MAX) msg = msg.slice(0, MAX - 1).trim() + '\u2026';
  return msg;
};
