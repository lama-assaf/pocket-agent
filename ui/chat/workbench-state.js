// Shared inline empty/error-state handling for workbench panels (Brain,
// Agents, Content, Campaigns, Analytics, Routines).
//
// Before this: a failed fetch and an empty-but-successful fetch looked
// identical — blank space under the list — with the only signal being a
// generic "Failed to load X" toast that auto-dismisses in a few seconds.
// Reload the panel a minute later and there's no trace anything went wrong.
//
// Each panel already has one static "empty" placeholder element per list
// (icon + message + small print, e.g. "No facts in this space yet"). Rather
// than adding a second element per list for the error case, `wbShowError`
// caches that element's original (pristine) markup the first time it's
// touched, swaps in an error state with the real message + a Retry action,
// and `wbShowEmpty` restores the cached pristine markup for the genuine
// zero-results case. This keeps both states visually consistent siblings
// without a second DOM node to keep in sync per list.

const _wbPristineHtml = new Map();

function _wbCachePristine(el) {
  if (el && !_wbPristineHtml.has(el)) _wbPristineHtml.set(el, el.innerHTML);
}

/** Show the panel's real empty state (zero results, load succeeded). */
function wbShowEmpty(el) {
  if (!el) return;
  _wbCachePristine(el);
  el.classList.remove('hidden');
  if (_wbPristineHtml.has(el)) el.innerHTML = _wbPristineHtml.get(el);
}

/**
 * Show an inline error state in place of the panel's empty placeholder.
 * `retryExpr` is a JS expression string invoked from the Retry button's
 * onclick, e.g. "_wbLoad('facts')" or "_agtLoadAgents()" — matching this
 * codebase's existing onclick="playNormalClick(); someFn()" convention
 * rather than introducing a callback-registry indirection per call site.
 */
function wbShowError(el, message, retryExpr) {
  if (!el) return;
  _wbCachePristine(el);
  el.classList.remove('hidden');
  const safeMessage = typeof escapeHtml === 'function' ? escapeHtml(String(message || '')) : String(message || '');
  el.innerHTML = `
    <div class="wb-state wb-state--error">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v5"/><path d="M12 16h.01"/></g></svg>
      <p>Couldn't load this</p>
      <small>${safeMessage}</small>
      <button type="button" class="wb-state-retry is-cinamon" onclick="playNormalClick(); ${retryExpr}">Retry</button>
    </div>`;
}
