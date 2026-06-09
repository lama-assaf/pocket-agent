(function(){function _apply(p){var r=document.documentElement;if(!p){['bg-primary','bg-secondary','bg-tertiary','border','text-primary','text-secondary','text-muted','accent','accent-secondary','accent-hover','error','success','warning','orange','user-bubble','user-bubble-solid','assistant-bubble'].forEach(function(k){r.style.removeProperty('--'+k)});return}Object.keys(p).forEach(function(k){r.style.setProperty('--'+k,p[k])})}window.addEventListener('DOMContentLoaded',function(){if(!window.pocketAgent)return;Promise.all([window.pocketAgent.themes.list(),window.pocketAgent.themes.getSkin()]).then(function(res){var themes=res[0],skinId=res[1],t=themes[skinId];if(t)_apply(t.palette);window.pocketAgent.themes.onSkinChanged(function(id){var th=themes[id];if(th)_apply(th.palette)})}).catch(function(){})})})();

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
        (parsed && (parsed.error && (parsed.error.message || parsed.error)) ) ||
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
