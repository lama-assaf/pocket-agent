/* Brain Panel — embedded in chat.html */

let _brainInitialized = false;
let _brainNotyf = null;
// Which memory space the workbench is viewing: 'user' | 'world' | 'client:<id>' |
// 'project:<id>'. Defaults to the active workspace when the panel opens.
let _brainSpace = 'user';

// Memory Workbench sections. All three are `facts` rows in the same scope,
// differentiated by category (the single-source-of-truth decision):
//   facts    — knowledge about the brand (any category except the two below)
//   lessons  — append-style learnings (category 'lesson')
//   howtoact — voice + guardrails + instincts (category 'how_to_act')
const WB_SECTIONS = {
  facts: {
    fixedCategory: null,
    match: (c) => c !== 'lesson' && c !== 'how_to_act',
    placeholder: 'Add a fact about this brand…',
    subjects: [],
  },
  lessons: {
    fixedCategory: 'lesson',
    match: (c) => c === 'lesson',
    placeholder: 'What worked or what to avoid…',
    subjects: [],
  },
  howtoact: {
    fixedCategory: 'how_to_act',
    match: (c) => c === 'how_to_act',
    placeholder: 'How the brand should act…',
    // Settled taxonomy for the how-to-act subject keys (editor + injection agree).
    subjects: ['voice', 'banned_words', 'tone', 'instincts'],
  },
};

// Map the active workspace (from clients-view.js) to a memory scope string.
function _brainActiveScope() {
  if (typeof getActiveWorkspace !== 'function') return 'user';
  const ws = getActiveWorkspace();
  switch (ws.contextType) {
    case 'world':
      return 'world';
    case 'client':
      return ws.clientId ? `client:${ws.clientId}` : 'world';
    case 'project':
      return ws.projectKey
        ? `project:${ws.projectKey}`
        : ws.clientId
          ? `client:${ws.clientId}`
          : 'world';
    case 'personal':
    default:
      return 'user';
  }
}

// Human label for the current workbench scope (from the space picker).
function _wbScopeLabel() {
  const sel = document.getElementById('brain-space-select');
  if (sel && sel.selectedOptions && sel.selectedOptions[0]) {
    return sel.selectedOptions[0].textContent.trim();
  }
  return _brainSpace;
}

// ---- Show / Hide ----

// `scope` optionally overrides the workbench space (e.g. a deep-link from the
// client picker's "Memory & voice" opens straight to that client's how-to-act),
// independent of the active chat's workspace. Defaults to the active workspace.
function showBrainPanel(tab, scope) {
  const chatView = document.getElementById('chat-view');
  const brainView = document.getElementById('brain-view');
  if (!brainView) return;

  _dismissOtherPanels('brain-view');

  chatView.classList.add('hidden');
  brainView.classList.add('active');
  if (window._sidebarEnterPanelMode) window._sidebarEnterPanelMode();

  // Mark sidebar button active
  const sidebarBtn = document.getElementById('sidebar-brain-btn');
  if (sidebarBtn) sidebarBtn.classList.add('active');

  if (!_brainInitialized) {
    _initBrainPanel();
    _brainInitialized = true;
  }

  // Client-first: the workbench opens scoped to the active workspace, unless a
  // caller pins an explicit scope (deep-link into a specific client's memory).
  _brainSpace = scope || _brainActiveScope();

  if (tab) {
    _brainSwitchTab(tab);
  }

  // Refresh the space list (picks up clients + projects), then reload the active
  // tab for the active scope and update the sync bar.
  _brainPopulateSpaceOptions().then(() => {
    _brainRefreshActiveTab();
    _brainUpdateSyncBar();
  });
}

function hideBrainPanel() {
  const chatView = document.getElementById('chat-view');
  const brainView = document.getElementById('brain-view');
  if (!brainView) return;

  brainView.classList.remove('active');
  chatView.classList.remove('hidden');
  if (window._sidebarExitPanelMode) window._sidebarExitPanelMode();

  // Unmark sidebar button
  const sidebarBtn = document.getElementById('sidebar-brain-btn');
  if (sidebarBtn) sidebarBtn.classList.remove('active');
}

function toggleBrainPanel() {
  const brainView = document.getElementById('brain-view');
  if (brainView && brainView.classList.contains('active')) {
    hideBrainPanel();
  } else {
    showBrainPanel();
  }
}

// ---- Toast ----

function _brainShowToast(message, type) {
  if (!_brainNotyf) {
    _brainNotyf = new Notyf({
      duration: 3000, position: { x: 'right', y: 'bottom' },
      dismissible: true,
      types: [
        { type: 'success', background: '#4ade80' },
        { type: 'error', background: '#f87171' }
      ]
    });
  }
  _brainNotyf[type === 'error' ? 'error' : 'success'](window.cleanToastMessage ? window.cleanToastMessage(message) : message);
}

// ---- Init ----

function _initBrainPanel() {
  const brainView = document.getElementById('brain-view');
  if (!brainView) return;

  // Tab click handlers
  brainView.querySelectorAll('.brain-nav-item').forEach(tab => {
    tab.addEventListener('click', () => {
      playNormalClick();
      _brainSwitchTab(tab.dataset.tab);
    });
  });

  // Space filter — reloads the active workbench tab for the chosen space.
  const spaceSelect = document.getElementById('brain-space-select');
  if (spaceSelect) {
    spaceSelect.addEventListener('change', () => {
      _brainSpace = spaceSelect.value || 'user';
      _brainRefreshActiveTab();
      _brainUpdateSyncBar();
    });
  }
  // Pull / Publish for the active client scope.
  const pullBtn = document.getElementById('brain-pull-btn');
  if (pullBtn) pullBtn.addEventListener('click', () => { playNormalClick(); brainPullActive(); });
  const publishBtn = document.getElementById('brain-publish-btn');
  if (publishBtn) publishBtn.addEventListener('click', () => { playNormalClick(); brainPublishActive(); });
  _brainPopulateSpaceOptions();
}

// Populate the header Space filter with Personal, Agency, each client, and each
// client's projects (Client › Project). Defaults to the active workbench scope.
async function _brainPopulateSpaceOptions() {
  const select = document.getElementById('brain-space-select');
  if (!select) return;
  let clients = [];
  try {
    clients = (await window.pocketAgent.clients.list()) || [];
  } catch (err) {
    console.error('[Brain] Failed to list clients:', err);
  }
  const projectsByClient = {};
  await Promise.all(
    clients.map(async (c) => {
      try {
        projectsByClient[c.id] = (await window.pocketAgent.projects.list(c.id)) || [];
      } catch (_) {
        projectsByClient[c.id] = [];
      }
    })
  );
  const current = _brainSpace || select.value || 'user';
  const opts = [
    '<option value="user">Personal</option>',
    '<option value="world">Agency (World)</option>',
  ];
  for (const c of clients) {
    opts.push(`<option value="client:${c.id}">${_brainEscapeHtml(c.name)}</option>`);
    for (const p of projectsByClient[c.id] || []) {
      opts.push(
        `<option value="project:${p.id}">${_brainEscapeHtml(c.name)} \u203a ${_brainEscapeHtml(p.name)}</option>`
      );
    }
  }
  select.innerHTML = opts.join('');
  if ([...select.options].some((o) => o.value === current)) select.value = current;
  _brainSpace = select.value || 'user';
}

function _brainSwitchTab(tabId) {
  const brainView = document.getElementById('brain-view');
  if (!brainView) return;

  brainView.querySelectorAll('.brain-nav-item').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabId);
  });
  brainView.querySelectorAll('.brain-section').forEach(s => {
    s.classList.toggle('active', s.id === 'brain-' + tabId);
  });

  _brainRefreshActiveTab();
}

function _brainRefreshActiveTab() {
  const brainView = document.getElementById('brain-view');
  if (!brainView) return;
  const activeTab = brainView.querySelector('.brain-nav-item.active');
  if (!activeTab) return;

  const tabId = activeTab.dataset.tab;
  if (tabId === 'facts' || tabId === 'lessons' || tabId === 'howtoact') _wbLoad(tabId);
  else if (tabId === 'soul') _brainLoadSoul();
  else if (tabId === 'logs') _brainLoadLogs();
}

// ---- Helpers ----

function _brainEscapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function _brainFormatAspectName(name) {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function _brainFormatDate(dateStr) {
  if (!dateStr) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = new Date(dateStr);
  return `${months[d.getMonth()]} ${d.getDate()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function _brainFormatLogDate(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const yd = new Date(now); yd.setDate(yd.getDate() - 1);
  const yesterday = `${yd.getFullYear()}-${String(yd.getMonth() + 1).padStart(2, '0')}-${String(yd.getDate()).padStart(2, '0')}`;
  if (dateStr === today) return 'Today';
  if (dateStr === yesterday) return 'Yesterday';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

const _trashSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="m19.5 5.5l-.62 10.025c-.158 2.561-.237 3.842-.88 4.763a4 4 0 0 1-1.2 1.128c-.957.584-2.24.584-4.806.584c-2.57 0-3.855 0-4.814-.585a4 4 0 0 1-1.2-1.13c-.642-.922-.72-2.205-.874-4.77L4.5 5.5M3 5.5h18m-4.944 0l-.683-1.408c-.453-.936-.68-1.403-1.071-1.695a2 2 0 0 0-.275-.172C13.594 2 13.074 2 12.035 2c-1.066 0-1.599 0-2.04.234a2 2 0 0 0-.278.18c-.395.303-.616.788-1.058 1.757L8.053 5.5"/></svg>';

// ---- Capacity Bar Helper ----

function _brainUpdateCapacityBar(prefix, usage) {
  const fillEl = document.getElementById(`${prefix}-capacity-fill`);
  const textEl = document.getElementById(`${prefix}-capacity-text`);
  if (!fillEl || !textEl) return;

  const pct = Math.min(usage.pct, 100);
  fillEl.style.width = `${pct}%`;

  // Color coding
  fillEl.classList.remove('warning', 'critical');
  if (pct >= 90) fillEl.classList.add('critical');
  else if (pct >= 70) fillEl.classList.add('warning');

  textEl.textContent = `${pct}% — ${usage.usedChars.toLocaleString()} / ${usage.budgetChars.toLocaleString()} chars`;
}

// ---- Memory Workbench (Facts / Lessons / How-to-act) ----
//
// All three tabs are `facts` rows in the active scope, split by category. Each
// supports create + inline edit + delete against the facts CRUD IPC.

const _editSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="M14.363 5.652l1.48-1.48a2 2 0 0 1 2.829 0l1.414 1.414a2 2 0 0 1 0 2.828l-1.48 1.48m-4.243-4.242l-9.616 9.615a2 2 0 0 0-.578 1.238l-.242 2.74a1 1 0 0 0 1.084 1.085l2.74-.242a2 2 0 0 0 1.238-.578l9.616-9.616m-4.243-4.242l4.243 4.242"/></svg>';

// Facts fetched for each section, so inline edit can re-render without a refetch.
const _wbFactsBySection = { facts: [], lessons: [], howtoact: [] };
// Which row (fact id) is being edited per section (null = none).
const _wbEditing = { facts: null, lessons: null, howtoact: null };

async function _wbLoad(sectionKey) {
  const cfg = WB_SECTIONS[sectionKey];
  if (!cfg) return;
  const scope = _brainSpace;
  const scopeEl = document.getElementById(`brain-${sectionKey}-scope`);
  if (scopeEl) scopeEl.textContent = _wbScopeLabel();

  // Render the create row once per load (reflects the current scope).
  _wbRenderCreate(sectionKey, scope);

  const countEl = document.getElementById(`brain-${sectionKey}-count`);
  try {
    const [all, usage] = await Promise.all([
      window.pocketAgent.facts.list(scope),
      window.pocketAgent.facts.memoryUsage(scope),
    ]);
    const facts = (all || []).filter((f) => cfg.match(f.category || ''));
    _wbFactsBySection[sectionKey] = facts;
    _wbEditing[sectionKey] = null;
    if (countEl) countEl.textContent = `(${facts.length})`;
    _brainUpdateCapacityBar(`brain-${sectionKey}`, usage);
    _wbRenderRows(sectionKey);
  } catch (err) {
    console.error(`[Brain] Failed to load ${sectionKey}:`, err);
    _brainShowToast('Failed to load memory', 'error');
  }
}

// Build the create row for a section. Facts get a free category; lessons and
// how-to-act use a fixed category, and how-to-act suggests its subject keys.
function _wbRenderCreate(sectionKey, scope) {
  const host = document.getElementById(`brain-${sectionKey}-create`);
  if (!host) return;
  const cfg = WB_SECTIONS[sectionKey];
  const catInput = cfg.fixedCategory
    ? ''
    : `<input class="wb-in wb-in-cat" id="wb-new-${sectionKey}-cat" placeholder="category" value="fact" />`;
  const listId = `wb-subjects-${sectionKey}`;
  const datalist =
    cfg.subjects.length > 0
      ? `<datalist id="${listId}">${cfg.subjects.map((s) => `<option value="${_brainEscapeHtml(s)}"></option>`).join('')}</datalist>`
      : '';
  const subjList = cfg.subjects.length > 0 ? `list="${listId}"` : '';
  host.innerHTML = `
    ${catInput}
    <input class="wb-in wb-in-subj" id="wb-new-${sectionKey}-subj" ${subjList} placeholder="subject${cfg.fixedCategory === 'how_to_act' ? ' (e.g. voice)' : ' (optional)'}" />
    <input class="wb-in wb-in-content" id="wb-new-${sectionKey}-content" placeholder="${_brainEscapeHtml(cfg.placeholder)}" />
    <button class="wb-add-btn" onclick="playNormalClick(); wbCreate('${sectionKey}')">Add</button>
    ${datalist}`;
  // Enter in the content field submits.
  const contentEl = document.getElementById(`wb-new-${sectionKey}-content`);
  if (contentEl) {
    contentEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        wbCreate(sectionKey);
      }
    });
  }
}

// Render rows for a section, honoring the per-section inline-edit state.
function _wbRenderRows(sectionKey) {
  const tbody = document.getElementById(`brain-${sectionKey}-tbody`);
  const tableEl = document.getElementById(`brain-${sectionKey}-table`);
  const emptyEl = document.getElementById(`brain-${sectionKey}-empty`);
  if (!tbody) return;
  const facts = _wbFactsBySection[sectionKey] || [];

  if (facts.length === 0) {
    tbody.innerHTML = '';
    if (tableEl) tableEl.classList.add('hidden');
    if (emptyEl) emptyEl.classList.remove('hidden');
    return;
  }
  if (tableEl) tableEl.classList.remove('hidden');
  if (emptyEl) emptyEl.classList.add('hidden');

  const editingId = _wbEditing[sectionKey];
  const cfg = WB_SECTIONS[sectionKey];
  tbody.innerHTML = facts
    .map((f) => {
      if (f.id === editingId) {
        const catCell = cfg.fixedCategory
          ? `<td class="fact-category">${_brainEscapeHtml(f.category)}</td>`
          : `<td><input class="wb-in" id="wb-edit-${sectionKey}-cat" value="${_brainEscapeHtml(f.category)}" /></td>`;
        return `
      <tr class="wb-editing">
        ${catCell}
        <td><input class="wb-in" id="wb-edit-${sectionKey}-subj" value="${_brainEscapeHtml(f.subject)}" /></td>
        <td><input class="wb-in" id="wb-edit-${sectionKey}-content" value="${_brainEscapeHtml(f.content)}" /></td>
        <td class="fact-actions">
          <button class="wb-save-btn" onclick="playNormalClick(); wbSaveRow('${sectionKey}', ${f.id})" title="Save">Save</button>
          <button class="wb-cancel-btn" onclick="playNormalClick(); wbCancelRow('${sectionKey}')" title="Cancel">Cancel</button>
        </td>
      </tr>`;
      }
      return `
      <tr>
        <td class="fact-category">${_brainEscapeHtml(f.category)}</td>
        <td class="fact-subject">${_brainEscapeHtml(f.subject)}</td>
        <td class="fact-content">${_brainEscapeHtml(f.content)}</td>
        <td class="fact-actions">
          <button class="fact-edit-btn" onclick="playNormalClick(); wbEditRow('${sectionKey}', ${f.id})" title="Edit">${_editSvg}</button>
          <button class="fact-delete-btn" onclick="playNormalClick(); brainDeleteFact(${f.id})" title="Delete">${_trashSvg}</button>
        </td>
      </tr>`;
    })
    .join('');
}

// Create a new fact/lesson/how-to-act entry in the active scope. Scoping to the
// selected space is what keeps an authored lesson at the brand, never Personal.
async function wbCreate(sectionKey) {
  const cfg = WB_SECTIONS[sectionKey];
  if (!cfg) return;
  const catEl = document.getElementById(`wb-new-${sectionKey}-cat`);
  const subjEl = document.getElementById(`wb-new-${sectionKey}-subj`);
  const contentEl = document.getElementById(`wb-new-${sectionKey}-content`);
  const category = cfg.fixedCategory || (catEl && catEl.value.trim()) || 'fact';
  const subject = (subjEl && subjEl.value.trim()) || '';
  const content = (contentEl && contentEl.value.trim()) || '';
  if (!content) {
    _brainShowToast('Enter something to remember', 'error');
    return;
  }
  try {
    const res = await window.pocketAgent.facts.create({ category, subject, content, scope: _brainSpace });
    if (!res || res.success === false) {
      _brainShowToast((res && res.error) || 'Could not add', 'error');
      return;
    }
    _brainShowToast('Added', 'success');
    _wbLoad(sectionKey);
  } catch (err) {
    console.error('[Brain] Failed to create fact:', err);
    _brainShowToast('Failed to add', 'error');
  }
}

function wbEditRow(sectionKey, id) {
  _wbEditing[sectionKey] = id;
  _wbRenderRows(sectionKey);
  const el = document.getElementById(`wb-edit-${sectionKey}-content`);
  if (el) el.focus();
}

function wbCancelRow(sectionKey) {
  _wbEditing[sectionKey] = null;
  _wbRenderRows(sectionKey);
}

async function wbSaveRow(sectionKey, id) {
  const cfg = WB_SECTIONS[sectionKey];
  const catEl = document.getElementById(`wb-edit-${sectionKey}-cat`);
  const subjEl = document.getElementById(`wb-edit-${sectionKey}-subj`);
  const contentEl = document.getElementById(`wb-edit-${sectionKey}-content`);
  const fields = {
    subject: (subjEl && subjEl.value.trim()) || '',
    content: (contentEl && contentEl.value.trim()) || '',
  };
  if (!cfg.fixedCategory && catEl) fields.category = catEl.value.trim() || 'fact';
  if (!fields.content) {
    _brainShowToast('Content cannot be empty', 'error');
    return;
  }
  try {
    const res = await window.pocketAgent.facts.update(id, fields);
    if (!res || res.success === false) {
      _brainShowToast('Could not save', 'error');
      return;
    }
    _brainShowToast('Saved', 'success');
    _wbEditing[sectionKey] = null;
    _wbLoad(sectionKey);
  } catch (err) {
    console.error('[Brain] Failed to update fact:', err);
    _brainShowToast('Failed to save', 'error');
  }
}

// Delete a row, then reload whichever workbench section is active.
async function brainDeleteFact(id) {
  if (!confirm('Delete this entry?')) return;
  try {
    await window.pocketAgent.facts.delete(id);
    _brainShowToast('Deleted', 'success');
    const brainView = document.getElementById('brain-view');
    const activeTab = brainView && brainView.querySelector('.brain-nav-item.active');
    const tabId = activeTab ? activeTab.dataset.tab : 'facts';
    if (WB_SECTIONS[tabId]) _wbLoad(tabId);
  } catch (err) {
    console.error('[Brain] Failed to delete fact:', err);
    _brainShowToast('Failed to delete', 'error');
  }
}

// ---- Soul ----

async function _brainLoadSoul() {
  const container = document.getElementById('brain-soul-cards');
  const countEl = document.getElementById('brain-soul-count');
  const emptyEl = document.getElementById('brain-soul-empty');
  if (!container) return;

  try {
    const [aspects, usage] = await Promise.all([
      window.pocketAgent.soul.listAspects(),
      window.pocketAgent.soul.memoryUsage(),
    ]);
    if (countEl) countEl.textContent = `(${aspects.length})`;
    _brainUpdateCapacityBar('brain-soul', usage);

    if (aspects.length === 0) {
      container.classList.add('hidden');
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }

    container.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');

    container.innerHTML = aspects.map(a => `
      <div class="soul-card">
        <div class="soul-card-name">${_brainEscapeHtml(_brainFormatAspectName(a.aspect))}</div>
        <div class="soul-card-content">${_brainEscapeHtml(a.content)}</div>
        <div class="soul-card-meta">Updated ${_brainFormatDate(a.updated_at)}</div>
        <button class="soul-delete-btn" onclick="playNormalClick(); brainDeleteSoul(${a.id})" title="Delete">${_trashSvg}</button>
      </div>
    `).join('');
  } catch (err) {
    console.error('[Brain] Failed to load soul:', err);
    _brainShowToast('Failed to load approach', 'error');
  }
}

async function brainDeleteSoul(id) {
  if (!confirm('Delete this approach note?')) return;
  try {
    await window.pocketAgent.soul.deleteAspect(id);
    _brainShowToast('Deleted', 'success');
    _brainLoadSoul();
  } catch (err) {
    console.error('[Brain] Failed to delete soul:', err);
    _brainShowToast('Failed to delete', 'error');
  }
}

// ---- Daily Logs ----

async function _brainLoadLogs() {
  const tbody = document.getElementById('brain-logs-tbody');
  const countEl = document.getElementById('brain-logs-count');
  const emptyEl = document.getElementById('brain-logs-empty');
  const tableEl = document.getElementById('brain-logs-table');
  if (!tbody) return;

  try {
    const [logs, usage] = await Promise.all([
      window.pocketAgent.dailyLogs.list(),
      window.pocketAgent.dailyLogs.memoryUsage(),
    ]);
    if (countEl) countEl.textContent = `(${logs.length})`;
    _brainUpdateCapacityBar('brain-logs', usage);

    if (logs.length === 0) {
      if (tableEl) tableEl.classList.add('hidden');
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }

    if (tableEl) tableEl.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');

    const today = new Date().toISOString().split('T')[0];
    tbody.innerHTML = logs.map(l => {
      const dateLabel = _brainFormatLogDate(l.date);
      const isToday = l.date === today;
      return `
        <tr>
          <td class="log-date">${_brainEscapeHtml(dateLabel)}${isToday ? '<span class="now-badge">now</span>' : ''}</td>
          <td class="log-content">${_brainEscapeHtml(l.content)}</td>
          <td class="log-actions"><button class="log-delete-btn" onclick="playNormalClick(); brainDeleteLog(${l.id})" title="Delete">${_trashSvg}</button></td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('[Brain] Failed to load logs:', err);
    _brainShowToast('Failed to load logs', 'error');
  }
}

async function brainDeleteLog(id) {
  if (!confirm('Delete this daily log?')) return;
  try {
    await window.pocketAgent.dailyLogs.delete(id);
    _brainShowToast('Log deleted', 'success');
    _brainLoadLogs();
  } catch (err) {
    console.error('[Brain] Failed to delete log:', err);
    _brainShowToast('Failed to delete', 'error');
  }
}

// ---- Sync bar (Pull / Publish for the active client scope) ----
//
// The sync layer keys repos by bare id ('world' or a client id), while memory
// scopes are 'client:<id>'. Only world + client scopes have their own repo:
// projects share their parent client's repo (export.ts writes nothing for a
// project scope), and Personal is private — so both return null (no sync bar).
// Publish a project's memory by switching the space to its client.
function _brainSyncScope() {
  if (_brainSpace === 'world') return 'world';
  if (_brainSpace.startsWith('client:')) return _brainSpace.slice('client:'.length);
  return null;
}

// Show the Pull/Publish bar only for syncable (client/world) scopes.
async function _brainUpdateSyncBar() {
  const bar = document.getElementById('brain-sync-bar');
  if (!bar) return;
  const scope = _brainSyncScope();
  if (!scope) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  _brainRefreshSyncStatus(scope);
}

// Relative-time label for a sync timestamp, e.g. "3h ago" — mirrors
// clients-view.js's cvRelativeTime so the two surfaces read consistently.
function _brainRelativeTime(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

// Sync status label (roadmap item 9): "not configured"/"not cloned" for the
// setup states, otherwise a last-pulled timestamp with a stale flag once
// it's past the threshold (src/clients/sync-status.ts). World has no
// per-client freshness tracking (no client row), so it stays "synced".
async function _brainRefreshSyncStatus(scope) {
  const el = document.getElementById('brain-sync-status');
  if (!el) return;
  try {
    const s = await window.pocketAgent.sync.status(scope);
    if (!s.configured) {
      el.textContent = 'not configured';
      el.classList.remove('brain-sync-stale');
      return;
    }
    if (!s.cloned) {
      el.textContent = 'not cloned';
      el.classList.remove('brain-sync-stale');
      return;
    }
    if (s.freshness === 'stale' && typeof s.msSincePull === 'number') {
      el.textContent = `stale · pulled ${_brainRelativeTime(s.msSincePull)}`;
      el.classList.add('brain-sync-stale');
    } else if (typeof s.msSincePull === 'number') {
      el.textContent = `pulled ${_brainRelativeTime(s.msSincePull)}`;
      el.classList.remove('brain-sync-stale');
    } else {
      el.textContent = 'synced';
      el.classList.remove('brain-sync-stale');
    }
  } catch {
    el.textContent = '';
    el.classList.remove('brain-sync-stale');
  }
}

async function brainPullActive() {
  const scope = _brainSyncScope();
  if (!scope) return;
  const el = document.getElementById('brain-sync-status');
  if (el) el.textContent = 'pulling…';
  try {
    const res = await window.pocketAgent.sync.pull(scope);
    if (!res.ok) {
      _brainShowToast(res.error || 'Pull failed', 'error');
    } else {
      _brainShowToast(res.cloned ? 'Cloned' : res.merged ? 'Merged updates' : 'Up to date', 'success');
      _brainRefreshActiveTab();
    }
  } catch (err) {
    console.error('[Brain] Pull failed:', err);
    _brainShowToast('Pull failed', 'error');
  }
  _brainRefreshSyncStatus(scope);
}

// Publish materializes the active scope's in-app edits (facts → .atelier/memory)
// then commits + pushes — handled server-side in sync:publish.
async function brainPublishActive() {
  const scope = _brainSyncScope();
  if (!scope) return;
  const el = document.getElementById('brain-sync-status');
  if (el) el.textContent = 'publishing…';
  try {
    const res = await window.pocketAgent.sync.publish(scope);
    if (!res.ok) {
      _brainShowToast(res.error || 'Publish failed', 'error');
    } else {
      _brainShowToast(res.pushed ? 'Published' : 'Nothing to publish', 'success');
    }
  } catch (err) {
    console.error('[Brain] Publish failed:', err);
    _brainShowToast('Publish failed', 'error');
  }
  _brainRefreshSyncStatus(scope);
}

// ---- Refresh button ----

function brainRefresh() {
  _brainRefreshActiveTab();
  _brainShowToast('Refreshed', 'success');
}
