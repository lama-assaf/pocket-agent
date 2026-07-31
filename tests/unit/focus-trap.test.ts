/**
 * ui/chat/focus-trap.js — the shared modal focus-trap utility (see its own
 * module doc for the full rationale). This is a plain global-scope browser
 * script (no import/export, matching every other file in ui/chat/, and this
 * project's root package.json sets "type": "module" so a CommonJS `require()`
 * of a bare .js file would be rejected as ESM anyway) — so it's loaded here
 * by running its source text in an isolated `vm` context, exactly like a
 * `<script>` tag would, with no jsdom dependency needed. Its top-level code
 * never touches `document`/`window` (only function BODIES do, guarded), so
 * this loads cleanly with no browser globals present.
 *
 * Covers both:
 *  - the pure logic (which elements count as focusable, and the Tab/Shift+Tab
 *    wraparound math) against plain duck-typed fake elements — no real DOM
 *    needed at all.
 *  - a fuller integration pass (Tab cycles, Shift+Tab cycles, Escape closes,
 *    focus restores on deactivate, empty-container fallback) against a small
 *    hand-built fake DOM tree that implements just the subset of the real DOM
 *    API this file actually calls (querySelectorAll, focus, contains,
 *    get/set/removeAttribute, parentElement/children, activeElement).
 *
 * The real wiring into each of the app's actual modals (About modal, the
 * clients-view.js prompts, the plan-approval overlay) is reviewed manually
 * and exercised via the project's Playwright e2e harness rather than here —
 * see the PR/task notes for what was auto-tested vs manually verified.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface FocusTrapModule {
  focusTrapActivate: (container: FakeElement, options?: FocusTrapOptions) => void;
  focusTrapDeactivate: () => void;
  _ftGetFocusableElements: (container: unknown) => unknown[];
  _ftComputeNextFocusIndex: (currentIndex: number, length: number, direction: number) => number;
  _ftIsVisible: (el: unknown) => boolean;
  _ftIsDisabled: (el: unknown) => boolean;
}

interface FocusTrapOptions {
  initialFocus?: FakeElement;
  onEscape?: () => void;
}

function loadFocusTrap(): FocusTrapModule {
  const filePath = path.resolve(__dirname, '../../ui/chat/focus-trap.js');
  const code = fs.readFileSync(filePath, 'utf8');
  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: filePath });
  return sandbox as unknown as FocusTrapModule;
}

// ---- Minimal fake DOM (only the subset focus-trap.js actually calls) ----

class FakeElement {
  tagName: string;
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  hidden = false;
  disabled = false;
  private attrs = new Map<string, string>();
  private focusableCandidates: FakeElement[] = [];
  private doc: FakeDocument | null = null;
  inert = false;

  constructor(tagName = 'DIV') {
    this.tagName = tagName;
  }

  setDoc(doc: FakeDocument): this {
    this.doc = doc;
    return this;
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    child.doc = this.doc;
    this.children.push(child);
    return child;
  }

  /** Test hook: fixes what querySelectorAll() returns, since the real CSS-selector matching isn't re-implemented here — focus-trap.js only trusts whatever its own filtering (_ftIsVisible/_ftIsDisabled) does with the result. */
  setFocusableCandidates(elements: FakeElement[]): void {
    this.focusableCandidates = elements;
  }

  querySelectorAll(): FakeElement[] {
    return this.focusableCandidates;
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }

  getAttribute(name: string): string | null {
    return this.attrs.has(name) ? this.attrs.get(name)! : null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, String(value));
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }

  contains(el: FakeElement | null): boolean {
    let node: FakeElement | null = el;
    while (node) {
      if (node === (this as unknown as FakeElement)) return true;
      node = node.parentElement;
    }
    return false;
  }

  focus(): void {
    if (this.doc) this.doc.activeElement = this;
  }
}

class FakeDocument {
  body = new FakeElement('BODY');
  activeElement: FakeElement | null = null;
  private keydownListeners: Array<(e: FakeKeyboardEvent) => void> = [];

  constructor() {
    this.body.setDoc(this);
  }

  addEventListener(type: string, handler: (e: FakeKeyboardEvent) => void): void {
    if (type === 'keydown') this.keydownListeners.push(handler);
  }

  contains(el: FakeElement | null): boolean {
    return this.body.contains(el) || el === this.body;
  }

  /** Test hook — dispatches a fake keydown to every registered listener, exactly like a real browser would for a document-level capture listener. */
  dispatchKeydown(event: FakeKeyboardEvent): void {
    for (const listener of this.keydownListeners) listener(event);
  }
}

class FakeKeyboardEvent {
  key: string;
  shiftKey: boolean;
  target: FakeElement;
  defaultPrevented = false;
  propagationStopped = false;

  constructor(key: string, target: FakeElement, shiftKey = false) {
    this.key = key;
    this.target = target;
    this.shiftKey = shiftKey;
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }

  stopPropagation(): void {
    this.propagationStopped = true;
  }
}

function makeButton(doc: FakeDocument, id: string): FakeElement {
  const btn = new FakeElement('BUTTON').setDoc(doc);
  btn.setAttribute('id', id);
  return btn;
}

describe('_ftIsVisible / _ftIsDisabled (pure, no DOM needed)', () => {
  const { _ftIsVisible, _ftIsDisabled } = loadFocusTrap();

  it('treats a plain element with no special flags as visible and enabled', () => {
    const el = { getAttribute: () => null };
    expect(_ftIsVisible(el)).toBe(true);
    expect(_ftIsDisabled(el)).toBe(false);
  });

  it('treats a null/undefined element as not visible and disabled', () => {
    expect(_ftIsVisible(null)).toBe(false);
    expect(_ftIsDisabled(null)).toBe(true);
  });

  it('treats .hidden as not visible', () => {
    expect(_ftIsVisible({ hidden: true, getAttribute: () => null })).toBe(false);
  });

  it('treats aria-hidden="true" as not visible', () => {
    expect(_ftIsVisible({ getAttribute: (n: string) => (n === 'aria-hidden' ? 'true' : null) })).toBe(
      false
    );
  });

  it('treats .disabled === true as disabled', () => {
    expect(_ftIsDisabled({ disabled: true, getAttribute: () => null })).toBe(true);
  });

  it('treats aria-disabled="true" as disabled', () => {
    expect(
      _ftIsDisabled({ getAttribute: (n: string) => (n === 'aria-disabled' ? 'true' : null) })
    ).toBe(true);
  });
});

describe('_ftGetFocusableElements (pure w.r.t. a duck-typed container)', () => {
  const { _ftGetFocusableElements } = loadFocusTrap();

  it('returns [] for a container with no querySelectorAll', () => {
    expect(_ftGetFocusableElements(null)).toEqual([]);
    expect(_ftGetFocusableElements({})).toEqual([]);
  });

  it('returns every candidate that is visible and enabled', () => {
    const visible = { getAttribute: () => null };
    const container = { querySelectorAll: () => [visible, visible] };
    expect(_ftGetFocusableElements(container)).toHaveLength(2);
  });

  it('filters out hidden and disabled candidates, keeping DOM order', () => {
    const a = { id: 'a', getAttribute: () => null };
    const hiddenOne = { id: 'hidden', hidden: true, getAttribute: () => null };
    const disabledOne = { id: 'disabled', disabled: true, getAttribute: () => null };
    const b = { id: 'b', getAttribute: () => null };
    const container = { querySelectorAll: () => [a, hiddenOne, disabledOne, b] };
    const result = _ftGetFocusableElements(container) as Array<{ id: string }>;
    expect(result.map((el) => el.id)).toEqual(['a', 'b']);
  });
});

describe('_ftComputeNextFocusIndex (pure math, no DOM)', () => {
  const { _ftComputeNextFocusIndex } = loadFocusTrap();

  it('Tab (direction +1) advances by one', () => {
    expect(_ftComputeNextFocusIndex(0, 3, 1)).toBe(1);
    expect(_ftComputeNextFocusIndex(1, 3, 1)).toBe(2);
  });

  it('Tab wraps from the last element back to the first', () => {
    expect(_ftComputeNextFocusIndex(2, 3, 1)).toBe(0);
  });

  it('Shift+Tab (direction -1) goes back by one', () => {
    expect(_ftComputeNextFocusIndex(2, 3, -1)).toBe(1);
  });

  it('Shift+Tab wraps from the first element back to the last', () => {
    expect(_ftComputeNextFocusIndex(0, 3, -1)).toBe(2);
  });

  it('an unknown current index (-1) lands on first going forward, last going backward', () => {
    expect(_ftComputeNextFocusIndex(-1, 3, 1)).toBe(0);
    expect(_ftComputeNextFocusIndex(-1, 3, -1)).toBe(2);
  });

  it('returns -1 for a zero-length (empty) focusable list', () => {
    expect(_ftComputeNextFocusIndex(0, 0, 1)).toBe(-1);
    expect(_ftComputeNextFocusIndex(-1, 0, -1)).toBe(-1);
  });
});

describe('focusTrapActivate / focusTrapDeactivate (fake-DOM integration)', () => {
  let doc: FakeDocument;
  let focusTrap: FocusTrapModule;
  let outsideButton: FakeElement;
  let modalRoot: FakeElement;
  let first: FakeElement;
  let second: FakeElement;
  let third: FakeElement;

  beforeEach(() => {
    doc = new FakeDocument();
    const sandbox: Record<string, unknown> = { document: doc };
    vm.createContext(sandbox);
    vm.runInContext(
      fs.readFileSync(path.resolve(__dirname, '../../ui/chat/focus-trap.js'), 'utf8'),
      sandbox
    );
    focusTrap = sandbox as unknown as FocusTrapModule;

    outsideButton = makeButton(doc, 'outside-trigger');
    doc.body.appendChild(outsideButton);
    outsideButton.focus(); // simulates "the button that opened the modal" already having focus

    modalRoot = new FakeElement('DIV').setDoc(doc);
    doc.body.appendChild(modalRoot);
    first = makeButton(doc, 'first');
    second = makeButton(doc, 'second');
    third = makeButton(doc, 'third');
    modalRoot.appendChild(first);
    modalRoot.appendChild(second);
    modalRoot.appendChild(third);
    modalRoot.setFocusableCandidates([first, second, third]);
  });

  it('moves focus to the first focusable element on activate', () => {
    focusTrap.focusTrapActivate(modalRoot);
    expect(doc.activeElement).toBe(first);
  });

  it('honors an explicit initialFocus target instead of the first element', () => {
    const heading = new FakeElement('H2').setDoc(doc);
    modalRoot.appendChild(heading);
    focusTrap.focusTrapActivate(modalRoot, { initialFocus: heading });
    expect(doc.activeElement).toBe(heading);
  });

  it('Tab cycles forward through focusable elements and wraps to the first', () => {
    focusTrap.focusTrapActivate(modalRoot);
    expect(doc.activeElement).toBe(first);

    doc.dispatchKeydown(new FakeKeyboardEvent('Tab', first));
    expect(doc.activeElement).toBe(second);

    doc.dispatchKeydown(new FakeKeyboardEvent('Tab', second));
    expect(doc.activeElement).toBe(third);

    // wraps back to the first — this is the actual bug being fixed: today
    // Tab escapes the modal entirely instead of wrapping.
    doc.dispatchKeydown(new FakeKeyboardEvent('Tab', third));
    expect(doc.activeElement).toBe(first);
  });

  it('Shift+Tab cycles backward and wraps to the last', () => {
    focusTrap.focusTrapActivate(modalRoot);
    expect(doc.activeElement).toBe(first);

    // wraps backward from the first element to the last.
    doc.dispatchKeydown(new FakeKeyboardEvent('Tab', first, true));
    expect(doc.activeElement).toBe(third);

    doc.dispatchKeydown(new FakeKeyboardEvent('Tab', third, true));
    expect(doc.activeElement).toBe(second);
  });

  it('Escape calls the provided onEscape close path', () => {
    let closed = false;
    focusTrap.focusTrapActivate(modalRoot, { onEscape: () => { closed = true; } });
    doc.dispatchKeydown(new FakeKeyboardEvent('Escape', first));
    expect(closed).toBe(true);
  });

  it('Escape is a no-op when no onEscape is provided (matches a modal with no neutral close today)', () => {
    focusTrap.focusTrapActivate(modalRoot);
    const event = new FakeKeyboardEvent('Escape', first);
    expect(() => doc.dispatchKeydown(event)).not.toThrow();
    expect(event.defaultPrevented).toBe(false);
  });

  it('restores focus to the element that was focused before activate() on deactivate()', () => {
    expect(doc.activeElement).toBe(outsideButton);
    focusTrap.focusTrapActivate(modalRoot);
    expect(doc.activeElement).toBe(first);

    focusTrap.focusTrapDeactivate();
    expect(doc.activeElement).toBe(outsideButton);
  });

  it('deactivate() is a harmless no-op when no trap is active', () => {
    expect(() => focusTrap.focusTrapDeactivate()).not.toThrow();
  });

  it('falls back to focusing the container itself when it has no focusable children', () => {
    const empty = new FakeElement('DIV').setDoc(doc);
    doc.body.appendChild(empty);
    empty.setFocusableCandidates([]);

    focusTrap.focusTrapActivate(empty);
    expect(doc.activeElement).toBe(empty);

    // Tab with nothing to cycle through re-focuses the container rather than
    // throwing or letting focus escape.
    doc.dispatchKeydown(new FakeKeyboardEvent('Tab', empty));
    expect(doc.activeElement).toBe(empty);
  });

  it('inerts background siblings while active and restores them on deactivate', () => {
    focusTrap.focusTrapActivate(modalRoot);
    expect(outsideButton.getAttribute('aria-hidden')).toBe('true');
    expect(outsideButton.inert).toBe(true);

    focusTrap.focusTrapDeactivate();
    expect(outsideButton.getAttribute('aria-hidden')).toBeNull();
    expect(outsideButton.inert).toBe(false);
  });

  it('activating a second trap deactivates the first one first (never stacks)', () => {
    focusTrap.focusTrapActivate(modalRoot);
    expect(doc.activeElement).toBe(first);
    expect(outsideButton.getAttribute('aria-hidden')).toBe('true');

    const secondModal = new FakeElement('DIV').setDoc(doc);
    doc.body.appendChild(secondModal);
    const onlyControl = makeButton(doc, 'only');
    secondModal.appendChild(onlyControl);
    secondModal.setFocusableCandidates([onlyControl]);

    focusTrap.focusTrapActivate(secondModal);
    expect(doc.activeElement).toBe(onlyControl);
    // The first trap's own bookkeeping was torn down (not left dangling)
    // before the second one's ran — its inerted background is now re-inerted
    // fresh by the SECOND trap's own pass instead (modalRoot is just another
    // sibling from the second trap's point of view), proving deactivate()
    // genuinely ran rather than being skipped when superseded.
    expect(outsideButton.getAttribute('aria-hidden')).toBe('true');
    expect(modalRoot.getAttribute('aria-hidden')).toBe('true');
  });
});
