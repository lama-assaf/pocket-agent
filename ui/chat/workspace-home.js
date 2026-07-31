// ============ Workspace Home ============
//
// Lands here after picking a client in the picker (see clients-view.js's
// cvSelectWorkspace), instead of dropping straight into an empty chat
// composer. Three jobs, all scoped to the active workspace:
//   1. Brain health — Facts/Lessons/How-to-act counts, so a bare client
//      brain is visible at a glance rather than discovered mid-chat.
//   2. Quick-entry — start a chat, optionally in an operator lane
//      (design/product/brand/social), via the same setAgentMode()/
//      session-mode pipeline the composer's lane switcher uses.
//   3. Navigation — resume a recent chat, or jump into Brain/Content/
//      Campaigns/Analytics.
//
// Follows the other panels' conventions (_dismissOtherPanels, the shared
// panel-header primitive, workbench-state.js for empty/error) rather than
// inventing new ones.

// ---- Show / Hide ----

function showWorkspaceHomeView() {
  const chatView = document.getElementById('chat-view');
  const homeView = document.getElementById('workspace-home-view');
  if (!homeView) return;

  _dismissOtherPanels('workspace-home-view');
  if (chatView) chatView.classList.add('hidden');
  homeView.classList.add('active');
  if (window._sidebarEnterPanelMode) window._sidebarEnterPanelMode();

  const sidebarBtn = document.getElementById('sidebar-home-btn');
  if (sidebarBtn) sidebarBtn.classList.add('active');

  _wshApplyWorkspaceVariant();
  _wshRefresh();
}

function hideWorkspaceHomeView() {
  const chatView = document.getElementById('chat-view');
  const homeView = document.getElementById('workspace-home-view');
  if (!homeView) return;

  homeView.classList.remove('active');
  if (chatView) chatView.classList.remove('hidden');
  if (window._sidebarExitPanelMode) window._sidebarExitPanelMode();

  const sidebarBtn = document.getElementById('sidebar-home-btn');
  if (sidebarBtn) sidebarBtn.classList.remove('active');
}

function toggleWorkspaceHomeView() {
  const homeView = document.getElementById('workspace-home-view');
  if (homeView && homeView.classList.contains('active')) hideWorkspaceHomeView();
  else showWorkspaceHomeView();
}

// ---- Refresh (parallel, independent loads — a slow/failed one never
// blocks the others; each section fills in on its own) ----

function _wshRefresh() {
  _wshUpdateHeaderAvatar();
  _wshApplyTabLimit();
  _wshLoadRecentChats(); // synchronous (reads the already-loaded sessions list)
  _wshRenderBrainSkeleton();
  _wshLoadBrainHealth(); // async (facts IPC) — fills in over the skeleton
}

// Personal must never read as a brand: dim the brand-only quick links
// (Campaigns/Analytics) the same way the sidebar already dims its own
// Campaigns/Analytics buttons for Personal (see sidebar.css).
function _wshApplyWorkspaceVariant() {
  const homeView = document.getElementById('workspace-home-view');
  if (!homeView || typeof getActiveWorkspace !== 'function') return;
  const ws = getActiveWorkspace();
  homeView.classList.toggle('workspace-personal', ws.contextType === 'personal');
}

// Mirrors the sidebar's active-workspace avatar (already kept current by
// updateActiveClientHeader() on every workspace switch) rather than
// re-fetching the clients list here.
function _wshUpdateHeaderAvatar() {
  const avatarEl = document.getElementById('wsh-avatar');
  const sourceEl = document.getElementById('active-client-avatar');
  if (!avatarEl || !sourceEl) return;
  avatarEl.textContent = sourceEl.textContent;
  const modifier = sourceEl.className.replace('active-client-avatar', '').trim();
  avatarEl.className = modifier ? `wsh-avatar ${modifier}` : 'wsh-avatar';
}

// Same MAX_TABS ceiling the sidebar's own New Chat button and lane
// quick-entry tiles respect — disable rather than silently no-op on click.
function _wshApplyTabLimit() {
  const atLimit =
    typeof visibleSessions === 'function' && typeof MAX_TABS !== 'undefined'
      ? visibleSessions().length >= MAX_TABS
      : false;
  const newChatBtn = document.getElementById('wsh-new-chat-btn');
  if (newChatBtn) newChatBtn.disabled = atLimit;
  document.querySelectorAll('#wsh-lanes .wsh-lane-tile').forEach((btn) => {
    btn.disabled = atLimit;
  });
}

// ---- Start a chat in a lane ----

// Creates a fresh chat in the active workspace (createNewSession already
// returns to the chat view) and puts it straight into the chosen operator
// lane via the existing setAgentMode()/session-mode pipeline — the same
// one the composer's lane switcher uses. Works because the session is brand
// new (no messages yet), the same precondition setAgentMode already checks.
async function _wshStartLane(laneId) {
  if (typeof createNewSession !== 'function') return;
  await createNewSession();
  if (typeof setAgentMode === 'function') setAgentMode(laneId);
}

// ---- Resume a recent chat ----

function _wshOpenSession(sessionId) {
  if (typeof returnToChatView === 'function') returnToChatView();
  if (typeof switchSession === 'function') switchSession(sessionId);
}

// ---- Recent chats ----

function _wshLoadRecentChats() {
  const listEl = document.getElementById('wsh-recent-list');
  const emptyEl = document.getElementById('wsh-recent-empty');
  if (!listEl) return;

  let shown = [];
  try {
    // visibleSessions() only filters to the active workspace — it does not
    // guarantee order (new sessions are pushed to the end of the in-memory
    // array, not re-sorted). Sort explicitly by updated_at descending so
    // "recent" actually means recent, then take the top 5.
    const filtered = typeof visibleSessions === 'function' ? visibleSessions() : [];
    shown = [...filtered]
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 5);
  } catch (err) {
    console.error('[WorkspaceHome] Failed to read recent chats:', err);
    listEl.classList.add('hidden');
    wbShowError(emptyEl, err.message || 'Unknown error', '_wshLoadRecentChats()');
    return;
  }

  if (shown.length === 0) {
    listEl.classList.add('hidden');
    wbShowEmpty(emptyEl);
    return;
  }

  if (emptyEl) emptyEl.classList.add('hidden');
  listEl.classList.remove('hidden');
  listEl.innerHTML = shown
    .map((s) => {
      const isLane = typeof LANE_IDS !== 'undefined' && LANE_IDS.includes(s.mode);
      const laneBadge = isLane
        ? `<span class="wsh-recent-lane" data-lane="${_wshEscapeHtml(s.mode)}">${_wshEscapeHtml(s.mode)}</span>`
        : '';
      const when = typeof cvRelativeTime === 'function' && s.updated_at
        ? cvRelativeTime(Date.now() - new Date(s.updated_at).getTime())
        : '';
      return `
        <button class="wsh-recent-row" onclick="playNormalClick(); _wshOpenSession('${_wshEscapeHtml(s.id)}')">
          <span class="wsh-recent-name">${_wshEscapeHtml(s.name)}</span>
          ${laneBadge}
          <span class="wsh-recent-time">${_wshEscapeHtml(when)}</span>
        </button>`;
    })
    .join('');
}

// ---- Brain health ----

// Immediate placeholder shown while facts.list() resolves — a graceful
// progressive fill instead of a blank gap or a blocking spinner.
function _wshRenderBrainSkeleton() {
  const container = document.getElementById('wsh-brain-stats');
  if (!container) return;
  container.classList.remove('hidden');
  const emptyEl = document.getElementById('wsh-brain-empty');
  if (emptyEl) emptyEl.classList.add('hidden');
  container.innerHTML = ['facts', 'lessons', 'howtoact']
    .map(() => '<div class="wsh-stat wsh-stat--skeleton" aria-hidden="true"></div>')
    .join('');
}

async function _wshLoadBrainHealth() {
  const container = document.getElementById('wsh-brain-stats');
  const emptyEl = document.getElementById('wsh-brain-empty');
  if (!container) return;

  // Same scope resolution The Brain itself uses (brain-panel.js) — Facts/
  // Lessons/How-to-act are all `facts` rows in this scope, split by category.
  const scope = typeof _brainActiveScope === 'function' ? _brainActiveScope() : 'user';

  try {
    const all = (await window.pocketAgent.facts.list(scope)) || [];
    const counts = {};
    for (const key of Object.keys(WB_SECTIONS)) {
      counts[key] = all.filter((f) => WB_SECTIONS[key].match(f.category || '')).length;
    }
    container.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');
    container.innerHTML =
      _wshBrainStatHtml('facts', 'Facts', counts.facts) +
      _wshBrainStatHtml('lessons', 'Lessons', counts.lessons) +
      _wshBrainStatHtml('howtoact', 'How to act', counts.howtoact);
  } catch (err) {
    console.error('[WorkspaceHome] Failed to load brain health:', err);
    container.classList.add('hidden');
    wbShowError(emptyEl, err.message || 'Unknown error', '_wshLoadBrainHealth()');
  }
}

function _wshBrainStatHtml(tabId, label, count) {
  const started = count > 0;
  const nudge = started ? '' : '<span class="wsh-stat-nudge">Not started</span>';
  return `
    <button class="wsh-stat wsh-stat--${tabId}${started ? '' : ' wsh-stat--empty'}" onclick="playNormalClick(); showBrainPanel('${tabId}')">
      <span class="wsh-stat-count">${count}</span>
      <span class="wsh-stat-label">${_wshEscapeHtml(label)}</span>
      ${nudge}
    </button>`;
}

// ---- Helpers ----

function _wshEscapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text ?? '');
  return div.innerHTML;
}
