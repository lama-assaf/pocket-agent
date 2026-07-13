/* Agents Panel — embedded in chat.html. Browse + detail view over the
   marketplace pack agent registry (Atelier/Salon), grouped by pack then lane.
   Every agent can carry a local override (prompt/tools/model) scoped to the
   active workspace — nearer scope (client) wins over the agency (world)
   default, same rule as the Brain workbench's how-to-act facts. "Call" primes
   a fresh chat scoped to the agent's lane so the model's subagent tool
   dispatches to it (and picks up the override — src/tools/subagent.ts
   resolveSpecialist resolves overrides on every dispatch). */

let _agtNotyf = null;
let _agtAgents = []; // cached list from the last load, for detail lookups without a re-fetch
let _agtCurrentDetail = null; // { packId, name, lane } for the open detail/edit view
let _agtClientsCache = null; // clients.list() result, cached for scope labels
let _agtProjectsCache = {}; // clientId -> projects.list(clientId) result, cached for scope labels

// ---- Show / Hide ----

function showAgentsPanel() {
  const chatView = document.getElementById('chat-view');
  const agentsView = document.getElementById('agents-view');
  if (!agentsView) return;

  _dismissOtherPanels('agents-view');

  chatView.classList.add('hidden');
  agentsView.classList.add('active');
  if (window._sidebarEnterPanelMode) window._sidebarEnterPanelMode();

  const sidebarBtn = document.getElementById('sidebar-agents-btn');
  if (sidebarBtn) sidebarBtn.classList.add('active');

  _agtShowList();
  _agtLoadAgents();
}

function hideAgentsPanel() {
  const chatView = document.getElementById('chat-view');
  const agentsView = document.getElementById('agents-view');
  if (!agentsView) return;

  agentsView.classList.remove('active');
  chatView.classList.remove('hidden');
  if (window._sidebarExitPanelMode) window._sidebarExitPanelMode();

  const sidebarBtn = document.getElementById('sidebar-agents-btn');
  if (sidebarBtn) sidebarBtn.classList.remove('active');
}

function toggleAgentsPanel() {
  const agentsView = document.getElementById('agents-view');
  if (agentsView && agentsView.classList.contains('active')) {
    hideAgentsPanel();
  } else {
    showAgentsPanel();
  }
}

function agtRefresh() {
  _agtLoadAgents();
  _agtShowToast('Refreshed', 'success');
}

// ---- Toast ----

function _agtShowToast(message, type) {
  if (!_agtNotyf) {
    _agtNotyf = new Notyf({
      duration: 3000, position: { x: 'right', y: 'bottom' },
      dismissible: true,
      types: [
        { type: 'success', background: '#4ade80' },
        { type: 'error', background: '#f87171' }
      ]
    });
  }
  _agtNotyf[type === 'error' ? 'error' : 'success'](window.cleanToastMessage ? window.cleanToastMessage(message) : message);
}

// ---- Helpers ----

function _agtEscapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function _agtEscapeAttr(text) {
  return String(text).replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function _agtFormatLaneName(lane) {
  return lane.charAt(0).toUpperCase() + lane.slice(1);
}

// The active workspace context (personal/world/client/project) — drives which
// scope an override resolves from/writes to, same shape as sessions.setContext.
function _agtContext() {
  if (typeof getActiveWorkspace === 'function') return getActiveWorkspace();
  return { contextType: 'personal', clientId: null, projectKey: null };
}

// Mirrors src/memory/scope.ts resolveNearestScope — the scope a toggle in the
// current context writes to / reads its own explicit override from.
function _agtNearestScope(ctx) {
  switch (ctx.contextType) {
    case 'world':
      return 'world';
    case 'client':
      return ctx.clientId ? `client:${ctx.clientId}` : 'world';
    case 'project':
      if (ctx.projectKey) return `project:${ctx.projectKey}`;
      if (ctx.clientId) return `client:${ctx.clientId}`;
      return 'world';
    case 'personal':
    default:
      return 'user';
  }
}

// Populate the client/project name caches used by _agtScopeLabel. Cheap to
// call repeatedly — only fetches once per client id.
async function _agtEnsureScopeLabelData() {
  if (!_agtClientsCache) {
    try {
      _agtClientsCache = (await window.pocketAgent.clients.list()) || [];
    } catch (_) {
      _agtClientsCache = [];
    }
  }
  const ctx = _agtContext();
  if (ctx.clientId && !_agtProjectsCache[ctx.clientId]) {
    try {
      _agtProjectsCache[ctx.clientId] = (await window.pocketAgent.projects.list(ctx.clientId)) || [];
    } catch (_) {
      _agtProjectsCache[ctx.clientId] = [];
    }
  }
}

// Human label for an enablement/override scope key, e.g. "client:acme" -> the
// client's name. Falls back to the raw key when name data isn't cached yet.
function _agtScopeLabel(scope) {
  if (!scope || scope === 'default') return 'Agency-wide (default)';
  if (scope === 'world') return 'Agency-wide';
  if (scope === 'user') return 'Personal';
  if (scope.startsWith('client:')) {
    const id = scope.slice('client:'.length);
    const client = (_agtClientsCache || []).find((c) => c.id === id);
    return client ? client.name : id;
  }
  if (scope.startsWith('project:')) {
    const id = scope.slice('project:'.length);
    for (const projects of Object.values(_agtProjectsCache)) {
      const project = (projects || []).find((p) => p.id === id);
      if (project) return project.name;
    }
    return id;
  }
  return scope;
}

// ---- List view (grouped by pack, then lane) ----

function _agtShowList() {
  const listView = document.getElementById('agt-list-view');
  const detailView = document.getElementById('agt-detail-view');
  if (listView) listView.classList.remove('hidden');
  if (detailView) detailView.classList.add('hidden');
  _agtCurrentDetail = null;
}

async function _agtLoadAgents() {
  const groupsEl = document.getElementById('agt-groups');
  const emptyEl = document.getElementById('agt-empty');
  const countEl = document.getElementById('agt-active-count');
  if (!groupsEl) return;

  try {
    await _agtEnsureScopeLabelData();
    const agents = await window.pocketAgent.marketplace.listAgents(_agtContext());
    _agtAgents = agents || [];
    if (countEl) countEl.textContent = `(${_agtAgents.length})`;

    if (_agtAgents.length === 0) {
      groupsEl.innerHTML = '';
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');

    // Group by pack, preserving first-seen pack order, then by lane within it.
    const byPack = new Map();
    for (const a of _agtAgents) {
      if (!byPack.has(a.packId)) byPack.set(a.packId, { packName: a.packName, byLane: new Map() });
      const pack = byPack.get(a.packId);
      if (!pack.byLane.has(a.lane)) pack.byLane.set(a.lane, []);
      pack.byLane.get(a.lane).push(a);
    }

    groupsEl.innerHTML = [...byPack.entries()].map(([packId, pack]) => `
      <div class="agt-pack-group">
        <div class="agt-pack-title">${_agtEscapeHtml(pack.packName)}</div>
        ${[...pack.byLane.entries()].map(([lane, laneAgents]) => `
          <div class="agt-lane-group">
            <div class="agt-lane-title">${_agtEscapeHtml(_agtFormatLaneName(lane))}</div>
            <div class="agt-cards">
              ${laneAgents.map((a) => _agtCardHtml(packId, a)).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `).join('');
  } catch (err) {
    console.error('[Agents] Failed to load agents:', err);
    _agtShowToast('Failed to load agents', 'error');
  }
}

function _agtCardHtml(packId, a) {
  const toolBadges = (a.tools || [])
    .map((t) => `<span class="badge">${_agtEscapeHtml(t)}</span>`)
    .join('');
  const modelBadge = a.model ? `<span class="badge is-default">${_agtEscapeHtml(a.model)}</span>` : '';
  const modifiedBadge = a.hasOverride ? `<span class="badge agt-modified-badge" title="Locally edited in this workspace">Modified</span>` : '';
  const disabledBadge = !a.enabled
    ? `<span class="badge agt-disabled-badge" title="Disabled for ${_agtEscapeHtml(_agtScopeLabel(a.enablementScope))}">Disabled</span>`
    : '';
  return `
    <button class="agt-card${!a.enabled ? ' agt-card-disabled' : ''}" onclick="playNormalClick(); agtShowDetail('${_agtEscapeAttr(packId)}', '${_agtEscapeAttr(a.name)}')">
      <div class="agt-card-head">
        <span class="agt-card-name">${_agtEscapeHtml(a.name)}</span>
        ${disabledBadge}
        ${modifiedBadge}
        ${modelBadge}
      </div>
      <div class="agt-card-desc">${_agtEscapeHtml(a.description)}</div>
      <div class="agt-card-tools">${toolBadges}</div>
    </button>`;
}

// ---- Detail view ----

function agtBackToList() {
  _agtShowList();
}

async function agtShowDetail(packId, name) {
  const listView = document.getElementById('agt-list-view');
  const detailView = document.getElementById('agt-detail-view');
  const body = document.getElementById('agt-detail-body');
  if (!body) return;

  if (listView) listView.classList.add('hidden');
  if (detailView) detailView.classList.remove('hidden');
  body.innerHTML = '<div class="agt-detail-desc">Loading…</div>';

  try {
    await _agtEnsureScopeLabelData();
    const agent = await window.pocketAgent.marketplace.getAgent(packId, name, _agtContext());
    if (!agent) {
      body.innerHTML = '<div class="agt-detail-desc">Agent not found.</div>';
      return;
    }
    _agtCurrentDetail = { packId, name, lane: agent.lane };
    _agtRenderDetail(agent);
  } catch (err) {
    console.error('[Agents] Failed to load agent detail:', err);
    body.innerHTML = '<div class="agt-detail-desc">Failed to load agent.</div>';
  }
}

function _agtRenderDetail(agent) {
  const body = document.getElementById('agt-detail-body');
  if (!body) return;

  const toolBadges = (agent.tools || [])
    .map((t) => `<span class="badge">${_agtEscapeHtml(t)}</span>`)
    .join('');
  const modelBadge = agent.model ? `<span class="badge is-default">${_agtEscapeHtml(agent.model)}</span>` : '';
  const laneBadge = `<span class="badge">${_agtEscapeHtml(_agtFormatLaneName(agent.lane))} lane</span>`;
  const packBadge = `<span class="badge">${_agtEscapeHtml(agent.packName)}</span>`;
  const modifiedBadge = agent.hasOverride
    ? `<span class="badge agt-modified-badge" title="Edited at ${_agtEscapeHtml(agent.overrideScope || '')}">Modified</span>`
    : '';

  const basePromptBlock = agent.hasOverride
    ? `
      <div class="agt-prompt-label">Marketplace default (read-only)</div>
      <div class="agt-prompt-body agt-prompt-base">${_agtEscapeHtml(agent.basePrompt)}</div>
      <div class="agt-prompt-label">Active prompt (edited at ${_agtEscapeHtml(agent.overrideScope || 'this workspace')})</div>
      <div class="agt-prompt-body">${_agtEscapeHtml(agent.prompt)}</div>
    `
    : `
      <div class="agt-prompt-label">System prompt</div>
      <div class="agt-prompt-body">${_agtEscapeHtml(agent.prompt)}</div>
    `;

  const resetBtn = agent.hasOverride
    ? `<button class="btn-danger" onclick="playNormalClick(); agtResetOverride()">Reset to marketplace default</button>`
    : '';

  // Enablement: current context's own scope vs where the effective decision
  // actually comes from. "Clear" only appears when this scope itself holds an
  // explicit fact (not just inheriting a broader scope's decision).
  const nearestScope = _agtNearestScope(_agtContext());
  const hasLocalEnablement = agent.enablementScope === nearestScope && agent.enablementScope !== 'default';
  const enablementStatus = agent.enabled
    ? `<span class="status success">Enabled</span>`
    : `<span class="status warning">Disabled for ${_agtEscapeHtml(_agtScopeLabel(agent.enablementScope))}</span>`;
  const enablementScopeNote = agent.enabled && agent.enablementScope !== 'default'
    ? `<span class="agt-enablement-note">(set at ${_agtEscapeHtml(_agtScopeLabel(agent.enablementScope))})</span>`
    : '';
  const toggleLabel = agent.enabled ? `Disable for ${_agtEscapeHtml(_agtScopeLabel(nearestScope))}` : `Enable for ${_agtEscapeHtml(_agtScopeLabel(nearestScope))}`;
  const clearEnablementBtn = hasLocalEnablement
    ? `<button class="btn-shell" onclick="playNormalClick(); agtClearEnablement()">Clear override (inherit)</button>`
    : '';
  const callBtn = agent.enabled
    ? `<button class="btn-cinamon" onclick="playNormalClick(); agtCallAgent('${_agtEscapeAttr(agent.packId)}', '${_agtEscapeAttr(agent.name)}', '${_agtEscapeAttr(agent.lane)}')">Call this agent</button>`
    : `<button class="btn-cinamon" disabled title="Disabled for this workspace">Call this agent</button>`;

  body.innerHTML = `
    <div class="agt-detail-head">
      <span class="agt-detail-name">${_agtEscapeHtml(agent.name)}</span>
      ${modifiedBadge}
    </div>
    <div class="agt-detail-desc">${_agtEscapeHtml(agent.description)}</div>
    <div class="agt-detail-meta">${packBadge}${laneBadge}${modelBadge}${toolBadges}</div>
    <div class="agt-enablement-row">
      ${enablementStatus} ${enablementScopeNote}
      <button class="btn-shell" onclick="playNormalClick(); agtToggleEnablement()">${toggleLabel}</button>
      ${clearEnablementBtn}
    </div>
    <div class="agt-detail-actions">
      ${callBtn}
      <button class="btn-shell" onclick="playNormalClick(); agtEditAgent()">Edit</button>
      ${resetBtn}
    </div>
    ${basePromptBlock}
  `;
}

// ---- Edit form ----

function agtEditAgent() {
  if (!_agtCurrentDetail) return;
  _agtLoadEditForm();
}

async function _agtLoadEditForm() {
  const body = document.getElementById('agt-detail-body');
  if (!body || !_agtCurrentDetail) return;
  const { packId, name } = _agtCurrentDetail;

  body.innerHTML = '<div class="agt-detail-desc">Loading…</div>';
  try {
    const [agent, existing] = await Promise.all([
      window.pocketAgent.marketplace.getAgent(packId, name, _agtContext()),
      window.pocketAgent.marketplace.getAgentOverride(packId, name, _agtContext()),
    ]);
    if (!agent) {
      body.innerHTML = '<div class="agt-detail-desc">Agent not found.</div>';
      return;
    }
    // Prefill from what's already set at this exact scope; otherwise fall back
    // to the currently effective value (agent.*), which may itself be inherited
    // from a broader scope — same starting point the "unchanged" check on save
    // compares against, so editing without touching a field is always a no-op.
    const fields = existing ? existing.fields : {};
    const promptValue = fields.prompt !== undefined ? fields.prompt : agent.prompt;
    const toolsValue = (fields.tools !== undefined ? fields.tools : agent.tools).join(', ');
    const modelValue = fields.model !== undefined ? fields.model : (agent.model || '');

    body.innerHTML = `
      <div class="agt-detail-head">
        <span class="agt-detail-name">Editing ${_agtEscapeHtml(agent.name)}</span>
      </div>
      <div class="agt-detail-desc">Fields left as shown (unedited) are skipped on save, so this workspace keeps inheriting them from a broader scope or the marketplace default. This edit applies to the current workspace scope only.</div>
      <label class="agt-edit-label" for="agt-edit-prompt">Prompt</label>
      <textarea class="agt-edit-textarea" id="agt-edit-prompt" rows="14">${_agtEscapeHtml(promptValue)}</textarea>
      <label class="agt-edit-label" for="agt-edit-tools">Tools (comma-separated)</label>
      <input class="agt-edit-input" id="agt-edit-tools" value="${_agtEscapeHtml(toolsValue)}" />
      <label class="agt-edit-label" for="agt-edit-model">Model</label>
      <input class="agt-edit-input" id="agt-edit-model" value="${_agtEscapeHtml(modelValue)}" placeholder="${_agtEscapeHtml(agent.model || 'default')}" />
      <div class="agt-detail-actions">
        <button class="btn-cinamon" onclick="playNormalClick(); agtSaveOverride()">Save override</button>
        <button class="btn-shell" onclick="playNormalClick(); agtCancelEdit()">Cancel</button>
      </div>
    `;
  } catch (err) {
    console.error('[Agents] Failed to load edit form:', err);
    body.innerHTML = '<div class="agt-detail-desc">Failed to load editor.</div>';
  }
}

function agtCancelEdit() {
  if (_agtCurrentDetail) agtShowDetail(_agtCurrentDetail.packId, _agtCurrentDetail.name);
}

async function agtSaveOverride() {
  if (!_agtCurrentDetail) return;
  const { packId, name } = _agtCurrentDetail;

  const promptEl = document.getElementById('agt-edit-prompt');
  const toolsEl = document.getElementById('agt-edit-tools');
  const modelEl = document.getElementById('agt-edit-model');

  try {
    const agent = await window.pocketAgent.marketplace.getAgent(packId, name, _agtContext());
    if (!agent) {
      _agtShowToast('Agent not found', 'error');
      return;
    }

    const promptValue = promptEl ? promptEl.value : '';
    const toolsValue = (toolsEl ? toolsEl.value : '').split(',').map((t) => t.trim()).filter(Boolean);
    const modelValue = modelEl ? modelEl.value.trim() : '';

    // Only send fields the user actually edited from what was shown (the
    // currently effective value, which may already be an inherited override) —
    // an untouched field is omitted so this scope keeps inheriting it rather
    // than pinning a copy of a broader scope's value.
    const fields = {};
    if (promptValue !== agent.prompt) fields.prompt = promptValue;
    const shownTools = [...agent.tools].sort().join(',');
    if (toolsValue.sort().join(',') !== shownTools) fields.tools = toolsValue;
    if (modelValue && modelValue !== (agent.model || '')) fields.model = modelValue;

    if (Object.keys(fields).length === 0) {
      _agtShowToast('No changes to save', 'error');
      return;
    }

    const res = await window.pocketAgent.marketplace.setAgentOverride(packId, name, fields, _agtContext());
    if (!res || !res.success) {
      _agtShowToast((res && res.error) || 'Failed to save override', 'error');
      return;
    }
    _agtShowToast('Override saved', 'success');
    await agtShowDetail(packId, name);
  } catch (err) {
    console.error('[Agents] Failed to save override:', err);
    _agtShowToast('Failed to save override', 'error');
  }
}

async function agtResetOverride() {
  if (!_agtCurrentDetail) return;
  if (!confirm('Reset this agent to the marketplace default in this workspace?')) return;
  const { packId, name } = _agtCurrentDetail;

  try {
    const res = await window.pocketAgent.marketplace.clearAgentOverride(packId, name, _agtContext());
    if (!res || !res.success) {
      _agtShowToast('Failed to reset', 'error');
      return;
    }
    _agtShowToast('Reset to marketplace default', 'success');
    await agtShowDetail(packId, name);
    _agtLoadAgents(); // refresh the "Modified" badge on the list view underneath
  } catch (err) {
    console.error('[Agents] Failed to reset override:', err);
    _agtShowToast('Failed to reset', 'error');
  }
}

// ---- Scoped enable/disable ----
// Per-brand (client/project) enablement, layered on top of the marketplace
// default (enabled) and independent of prompt/tools/model overrides above.
// Blocking dispatch for a disabled agent is enforced server-side
// (src/tools/subagent.ts resolveSpecialist) — this UI just reflects and edits
// the same scoped fact.

async function agtToggleEnablement() {
  if (!_agtCurrentDetail) return;
  const { packId, name } = _agtCurrentDetail;

  try {
    const agent = await window.pocketAgent.marketplace.getAgent(packId, name, _agtContext());
    if (!agent) {
      _agtShowToast('Agent not found', 'error');
      return;
    }
    const nextEnabled = !agent.enabled;
    const res = await window.pocketAgent.marketplace.setAgentEnablement(packId, name, nextEnabled, _agtContext());
    if (!res || !res.success) {
      _agtShowToast((res && res.error) || 'Failed to update', 'error');
      return;
    }
    _agtShowToast(nextEnabled ? 'Enabled' : 'Disabled', 'success');
    await agtShowDetail(packId, name);
    _agtLoadAgents(); // refresh the "Disabled" badge on the list view underneath
  } catch (err) {
    console.error('[Agents] Failed to toggle enablement:', err);
    _agtShowToast('Failed to update', 'error');
  }
}

async function agtClearEnablement() {
  if (!_agtCurrentDetail) return;
  const { packId, name } = _agtCurrentDetail;

  try {
    const res = await window.pocketAgent.marketplace.clearAgentEnablement(packId, name, _agtContext());
    if (!res || !res.success) {
      _agtShowToast('Failed to clear', 'error');
      return;
    }
    _agtShowToast('Now inheriting from a broader scope', 'success');
    await agtShowDetail(packId, name);
    _agtLoadAgents();
  } catch (err) {
    console.error('[Agents] Failed to clear enablement override:', err);
    _agtShowToast('Failed to clear', 'error');
  }
}

// ---- Call action ----
//
// Pragmatic path (no new backend dispatch route): open a fresh chat session,
// lock its mode to the agent's lane (so the subagent tool's specialist list
// includes this agent — see src/tools/subagent.ts resolveSpecialist, which
// resolves any local override on every dispatch), and prefill the composer
// naming the specialist so the model calls subagent({ agent: name, task })
// instead of guessing. The user reviews/edits the prefilled task before
// sending — nothing is dispatched automatically.
async function agtCallAgent(packId, name, lane) {
  if (typeof sessions !== 'undefined' && sessions.length >= MAX_TABS) {
    _agtShowToast('Too many chats open — close one first', 'error');
    return;
  }

  hideAgentsPanel();
  if (typeof returnToChatView === 'function') returnToChatView();

  try {
    const result = await window.pocketAgent.sessions.create(name);
    if (!result.success || !result.session) {
      _agtShowToast(result.error || 'Failed to start chat', 'error');
      return;
    }

    // New chats inherit the active workspace, same as the New Chat button.
    if (typeof getActiveWorkspace === 'function' && typeof applyWorkspaceToSession === 'function') {
      const ws = getActiveWorkspace();
      await applyWorkspaceToSession(result.session.id, ws);
    }

    // Lock the session's mode to the agent's lane so its specialists (this
    // agent included) are dispatchable via subagent(agent=name).
    const modeResult = await window.pocketAgent.agent.setSessionMode(result.session.id, lane);
    if (!modeResult.success) {
      console.warn('[Agents] Could not set session lane:', modeResult.error);
    }

    sessions.push(result.session);
    currentSessionId = result.session.id;
    renderTabs();
    disableAutoAnimate(); messagesDiv.innerHTML = ''; enableAutoAnimate();
    showEmptyState();
    updateStats();
    updateModeUIForSession(result.session.id);

    input.value = `Use the "${name}" specialist to: `;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    if (typeof autoResizeTextarea === 'function') autoResizeTextarea();
  } catch (err) {
    console.error('[Agents] Failed to start chat with agent:', err);
    _agtShowToast('Failed to start chat', 'error');
  }
}
