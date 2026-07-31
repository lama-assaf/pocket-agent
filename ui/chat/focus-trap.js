// ============ Focus Trap (shared modal accessibility utility) ============
//
// One reusable trap for every modal/dialog overlay in the renderer (About
// modal, the client/project create + join prompts in clients-view.js, the
// plan-approval overlay, and any future one) so Tab/Shift+Tab cycle inside
// the modal instead of escaping to the page behind it, Escape can close it,
// and focus is restored to whatever had it before the modal opened.
//
// Plain global functions, no build step, no dependency — matches every other
// file in ui/chat/ (see memory-scope.js, clients-view.js). The "pure" pieces
// (which elements count as focusable, and where Tab/Shift+Tab should land
// next) are ordinary functions with no top-level `document`/`window` access,
// so a test can load this file's source into an isolated vm context (no
// jsdom needed) and exercise them directly — see tests/unit/focus-trap.test.ts.
//
// activate() re-queries focusable elements on every Tab press rather than
// caching them once, so content added/removed from the modal while it's open
// (e.g. a row appearing after a save) is always reflected.

/** Selector for "normally focusable" elements — matches the standard set any focus-trap needs (buttons, inputs, links, explicit tabindex, contenteditable). */
const FT_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

/** Single active trap at a time — activating a new one deactivates any prior trap first (defensive: never two traps stacked). */
let _ftState = null;
let _ftListenerInstalled = false;

/**
 * True if `el` should count as a focusable candidate. Guards every DOM-only
 * check so this stays callable with plain duck-typed objects in tests: a
 * fake element that doesn't implement `getComputedStyle`/`hidden` simply
 * skips that check rather than throwing.
 */
function _ftIsVisible(el) {
  if (!el) return false;
  if (el.hidden) return false;
  if (typeof el.getAttribute === 'function' && el.getAttribute('aria-hidden') === 'true') return false;
  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    try {
      const style = window.getComputedStyle(el);
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    } catch (_) {
      /* getComputedStyle can throw for a detached/foreign node — treat as visible rather than block the trap */
    }
  }
  return true;
}

function _ftIsDisabled(el) {
  if (!el) return true;
  if (el.disabled === true) return true;
  if (typeof el.getAttribute === 'function' && el.getAttribute('aria-disabled') === 'true') return true;
  return false;
}

/**
 * Every currently-focusable element inside `container`, in DOM (tab) order.
 * Queried fresh on every call — never cached — so it stays correct across
 * dynamic content changes. Pure enough to unit-test with a fake `container`
 * object that only implements `querySelectorAll`.
 */
function _ftGetFocusableElements(container) {
  if (!container || typeof container.querySelectorAll !== 'function') return [];
  const found = container.querySelectorAll(FT_FOCUSABLE_SELECTOR);
  const list = Array.prototype.slice.call(found);
  return list.filter((el) => _ftIsVisible(el) && !_ftIsDisabled(el));
}

/**
 * Pure wraparound math for "what index does Tab/Shift+Tab land on next".
 * `direction` is +1 for Tab, -1 for Shift+Tab. `currentIndex` of -1 (focus
 * isn't on any tracked element — e.g. it drifted to the container itself)
 * lands on the first element going forward, or the last going backward,
 * rather than skipping past index 0. No DOM involved — directly unit-tested.
 */
function _ftComputeNextFocusIndex(currentIndex, length, direction) {
  if (length <= 0) return -1;
  if (currentIndex < 0) return direction >= 0 ? 0 : length - 1;
  return (currentIndex + direction + length) % length;
}

/**
 * Hides everything OUTSIDE `overlayEl` from assistive tech and keyboard/mouse
 * interaction while it's open, by walking up from the overlay to <body> and
 * marking every sibling at each level along the way (both `inert` — which
 * also blocks pointer interaction and script-initiated focus, not just Tab —
 * and `aria-hidden` for older engines that don't yet know `inert`). Returns
 * the list of elements it touched so deactivate can restore exactly those.
 * Elements already hidden/inerted for an unrelated reason are left alone
 * (not added to the restore list), so this never un-hides something that
 * wasn't this trap's doing.
 */
function _ftInertBackground(overlayEl) {
  const touched = [];
  if (typeof document === 'undefined' || !overlayEl || !overlayEl.parentElement) return touched;
  let node = overlayEl;
  let parent = node.parentElement;
  while (parent) {
    const siblings = Array.prototype.slice.call(parent.children || []);
    for (const sibling of siblings) {
      if (sibling === node) continue;
      const alreadyInert = ('inert' in sibling && sibling.inert) || sibling.getAttribute('aria-hidden') === 'true';
      if (alreadyInert) continue;
      if ('inert' in sibling) sibling.inert = true;
      sibling.setAttribute('aria-hidden', 'true');
      touched.push(sibling);
    }
    if (parent === document.body) break;
    node = parent;
    parent = parent.parentElement;
  }
  return touched;
}

function _ftRestoreBackground(touched) {
  for (const el of touched) {
    if ('inert' in el) el.inert = false;
    el.removeAttribute('aria-hidden');
  }
}

function _ftKeydownHandler(e) {
  if (!_ftState) return;
  const { container, onEscape } = _ftState;
  const target = e.target;
  // Defensive: if focus somehow ended up outside the trapped container
  // (shouldn't happen — Tab is fully intercepted below — but never eat keys
  // for unrelated page UI if it does), let the key through untouched.
  if (container.contains && !container.contains(target) && target !== container) return;

  if (e.key === 'Escape') {
    if (typeof onEscape === 'function') {
      e.preventDefault();
      e.stopPropagation();
      onEscape();
    }
    return;
  }

  if (e.key !== 'Tab') return;
  e.preventDefault();
  e.stopPropagation();

  const focusables = _ftGetFocusableElements(container);
  if (focusables.length === 0) {
    if (typeof container.focus === 'function') container.focus();
    return;
  }
  const currentIndex = focusables.indexOf(document.activeElement);
  const direction = e.shiftKey ? -1 : 1;
  const nextIndex = _ftComputeNextFocusIndex(currentIndex, focusables.length, direction);
  focusables[nextIndex].focus();
}

/**
 * Activate the trap for `container` (the modal's own root element — the
 * `.modal-overlay`/`.modal` node, or any dialog root). Records the
 * currently-focused element (restored on deactivate), inerts everything
 * else in the page, and moves focus inside the modal.
 *
 * `options`:
 *   - `initialFocus` (Element, optional): focus this instead of the first
 *     focusable descendant — e.g. the modal's own labelled heading, when a
 *     modal has no natural first control worth landing on.
 *   - `onEscape` (function, optional): called when Escape is pressed inside
 *     the trap. Not every modal has a neutral "cancel" action (e.g. the plan
 *     approval overlay requires an explicit Approve/Revise decision) — pass
 *     nothing to leave Escape a no-op for that trap, exactly like today.
 */
function focusTrapActivate(container, options) {
  if (!container) return;
  options = options || {};

  // Never stack two traps — closing whichever was active first restores
  // ITS previously-focused element before we record ours, so nesting can
  // never leave a false "previous focus" chain.
  if (_ftState) focusTrapDeactivate();

  const previousActiveElement = typeof document !== 'undefined' ? document.activeElement : null;
  const inertedElements = _ftInertBackground(container);

  let addedTabIndex = false;
  if (container.hasAttribute && !container.hasAttribute('tabindex')) {
    container.setAttribute('tabindex', '-1');
    addedTabIndex = true;
  }

  _ftState = { container, previousActiveElement, inertedElements, addedTabIndex, onEscape: options.onEscape };

  if (!_ftListenerInstalled && typeof document !== 'undefined') {
    // Installed once, ever — deactivate() just clears _ftState so this
    // becomes a no-op rather than adding/removing a listener every time
    // (simpler, and impossible to leak a stray listener).
    document.addEventListener('keydown', _ftKeydownHandler, true);
    _ftListenerInstalled = true;
  }

  const focusables = _ftGetFocusableElements(container);
  const target = options.initialFocus || focusables[0] || container;
  if (target && typeof target.focus === 'function') target.focus();
}

/** Deactivate the active trap (harmless no-op if none is active): un-inerts the background and restores focus to whatever had it before activate(). */
function focusTrapDeactivate() {
  if (!_ftState) return;
  const { container, previousActiveElement, inertedElements, addedTabIndex } = _ftState;
  _ftRestoreBackground(inertedElements);
  if (addedTabIndex && container.removeAttribute) container.removeAttribute('tabindex');
  _ftState = null;
  if (
    previousActiveElement &&
    typeof previousActiveElement.focus === 'function' &&
    typeof document !== 'undefined' &&
    document.contains(previousActiveElement)
  ) {
    previousActiveElement.focus();
  }
}
