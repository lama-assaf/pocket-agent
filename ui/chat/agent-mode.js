// ============ Agent Mode Toggle ============

let currentAgentMode = 'coder';

async function initAgentMode() {
  try {
    // Load per-session mode for the current session
    const mode = await window.pocketAgent.agent.getSessionMode(currentSessionId);
    currentAgentMode = mode || 'coder';
    await updateModeUIForSession(currentSessionId);
  } catch (err) {
    console.error('Failed to load agent mode:', err);
  }

  // Listen for global mode changes (affects new session defaults only)
  window.pocketAgent.agent.onModeChanged((mode) => {
    // Global mode changed — doesn't affect current session, just new ones
    console.log('[Chat] Global default mode changed:', mode);
  });

  // Listen for session mode changes (from switch_agent tool)
  window.pocketAgent.agent.onSessionModeChanged((sessionId, mode) => {
    console.log('[Chat] Session mode changed via switch_agent:', sessionId, mode);
    if (sessionId === currentSessionId) {
      currentAgentMode = mode;
      updateModeButtons(mode);
    }
  });
}

async function setAgentMode(mode) {
  if (mode === currentAgentMode) return;
  currentAgentMode = mode;
  updateModeButtons(mode);

  // Set the mode on the current session (only works if no messages yet)
  try {
    const result = await window.pocketAgent.agent.setSessionMode(currentSessionId, mode);
    if (!result.success) {
      console.warn('Cannot change session mode:', result.error);
      // Revert UI to actual session mode
      const actualMode = await window.pocketAgent.agent.getSessionMode(currentSessionId);
      currentAgentMode = actualMode;
      updateModeButtons(actualMode);
      return;
    }
  } catch (err) {
    console.error('Failed to set session mode:', err);
    return;
  }

  // Also update the global default for new sessions
  window.pocketAgent.agent.setMode(mode).catch(err => {
    console.error('Failed to set global default mode:', err);
  });
}

const LANE_IDS = ['design', 'product', 'brand', 'social'];

function updateModeButtons(mode) {
  const select = document.getElementById('mode-select');
  // A lane mode isn't one of mode-select's own options — leave it on its
  // last utility value rather than forcing an invalid selection into it.
  if (select && !LANE_IDS.includes(mode)) select.value = mode;

  document.querySelectorAll('.lane-btn').forEach((btn) => {
    const active = btn.dataset.lane === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

// Locks (or unlocks) #mode-select + #lane-switcher in the DOM directly, no
// history round-trip. Shared by updateModeUIForSession (session load/switch,
// where we don't yet know if there's history) and messaging.js's sendMessage
// (where we just sent the first message, so we already know: lock now).
function applyModeLock(locked) {
  const select = document.getElementById('mode-select');
  const laneSwitcher = document.getElementById('lane-switcher');
  if (select) {
    select.classList.toggle('locked', locked);
    // `.locked` only sets pointer-events: none, which blocks mouse input
    // but not a keyboard-focused element's native behavior (arrow keys
    // still change a focused <select>). `disabled` is what actually
    // removes keyboard operability too.
    select.disabled = locked;
  }
  if (laneSwitcher) {
    laneSwitcher.classList.toggle('locked', locked);
    laneSwitcher.querySelectorAll('.lane-btn').forEach((btn) => {
      // Same gap as above: pointer-events: none doesn't stop a focused
      // button from firing `click` on Enter/Space, so a keyboard user
      // could still switch lanes after the session locks. `disabled`
      // closes that and correctly drops the button out of tab order.
      btn.disabled = locked;
    });
  }
}

async function updateModeUIForSession(sessionId) {
  try {
    const mode = await window.pocketAgent.agent.getSessionMode(sessionId);
    currentAgentMode = mode || 'coder';
    updateModeButtons(currentAgentMode);

    // Lock select + lane switcher if session has messages (same contract:
    // the agent can still switch itself via switch_agent, users can't after
    // the conversation has started).
    const history = await window.pocketAgent.agent.getHistory(1, sessionId);
    applyModeLock(history && history.length > 0);
  } catch (err) {
    console.error('Failed to update mode UI for session:', err);
  }
}

