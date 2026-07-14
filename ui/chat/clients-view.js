// ============ Client Picker (front door) ============
//
// The opening screen of the agency workspace: pick a client (brand) and
// everything downstream — chats, memory, "how to act" — scopes to it. Personal
// is a first-class entry that keeps the single-brain behavior.
//
// This module owns the *active workspace* (the selected client/project), the
// picker UI, and the sidebar's active-client header. The Project selector and
// its bindings live in memory-scope.js (repurposed) and read state from here.

const CV_PERSONAL = { contextType: 'personal', clientId: null, projectKey: null };

// Cached source of truth for the active workspace, mirrored to localStorage so a
// relaunch can resume the last client (see cvLaunch).
let _activeWorkspace = null;
let _cvInitialized = false;

// ---- Active workspace state ----

function getActiveWorkspace() {
  if (_activeWorkspace) return _activeWorkspace;
  try {
    const raw = localStorage.getItem('activeWorkspace');
    if (raw) _activeWorkspace = JSON.parse(raw);
  } catch (_) {
    /* ignore malformed */
  }
  if (!_activeWorkspace) _activeWorkspace = { ...CV_PERSONAL };
  return _activeWorkspace;
}

function setActiveWorkspaceState(ws) {
  _activeWorkspace = {
    contextType: ws.contextType || 'personal',
    clientId: ws.clientId ?? null,
    projectKey: ws.projectKey ?? null,
  };
  try {
    localStorage.setItem('activeWorkspace', JSON.stringify(_activeWorkspace));
  } catch (_) {
    /* ignore quota */
  }
  return _activeWorkspace;
}

// Session context fields for a workspace (mirrors what the DB stores per session).
function wsToSessionFields(ws) {
  return {
    context_type: ws.contextType || 'personal',
    client_id: ws.clientId ?? null,
    project_key: ws.projectKey ?? null,
  };
}

// True when a session belongs to the given workspace. A client-level workspace
// (no project) groups all of that client's chats, including its projects; a
// project-level workspace shows only that project's chats.
function sessionMatchesWorkspace(s, ws) {
  const type = s.context_type || 'personal';
  switch (ws.contextType) {
    case 'world':
      return type === 'world';
    case 'client':
      return s.client_id === ws.clientId && (type === 'client' || type === 'project');
    case 'project':
      return type === 'project' && s.client_id === ws.clientId && s.project_key === ws.projectKey;
    case 'personal':
    default:
      return type === 'personal';
  }
}

function cvEscape(text) {
  const div = document.createElement('div');
  div.textContent = String(text ?? '');
  return div.innerHTML;
}

function cvInitials(name) {
  const t = String(name ?? '').trim();
  return t ? t[0].toUpperCase() : '?';
}

// Human label for the active workspace, shown in the sidebar header.
function cvWorkspaceLabel(ws, clients, projects) {
  if (ws.contextType === 'personal') return 'Personal';
  if (ws.contextType === 'world') return 'Agency';
  const client = (clients || []).find((c) => c.id === ws.clientId);
  const clientName = client ? client.name : ws.clientId || 'Client';
  if (ws.contextType === 'project' && ws.projectKey) {
    const project = (projects || []).find((p) => p.id === ws.projectKey);
    return `${clientName} · ${project ? project.name : ws.projectKey}`;
  }
  return clientName;
}

// ---- Show / Hide ----

function showClientsView() {
  const chatView = document.getElementById('chat-view');
  const clientsView = document.getElementById('clients-view');
  if (!clientsView) return;

  if (typeof _dismissOtherPanels === 'function') _dismissOtherPanels('clients-view');
  if (chatView) chatView.classList.add('hidden');
  clientsView.classList.add('active');
  if (window._sidebarEnterPanelMode) window._sidebarEnterPanelMode();

  renderClientPicker();
}

function hideClientsView() {
  const chatView = document.getElementById('chat-view');
  const clientsView = document.getElementById('clients-view');
  if (!clientsView) return;

  clientsView.classList.remove('active');
  if (chatView) chatView.classList.remove('hidden');
  if (window._sidebarExitPanelMode) window._sidebarExitPanelMode();
}

function toggleClientsView() {
  const clientsView = document.getElementById('clients-view');
  if (clientsView && clientsView.classList.contains('active')) {
    hideClientsView();
  } else {
    showClientsView();
  }
}

// ---- Picker render ----

async function renderClientPicker() {
  const grid = document.getElementById('cv-grid');
  if (!grid) return;

  let clients = [];
  try {
    clients = (await window.pocketAgent.clients.list()) || [];
  } catch (err) {
    console.error('[ClientPicker] Failed to list clients:', err);
  }

  // Fetch each client's projects in parallel for the sub-chips.
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

  const active = getActiveWorkspace();
  const isActive = (kind, clientId, projectKey) =>
    active.contextType === kind &&
    (active.clientId ?? null) === (clientId ?? null) &&
    (active.projectKey ?? null) === (projectKey ?? null);

  const cards = [];

  // Each card carries a "Memory & voice" link that deep-links into The Brain
  // scoped to that space (facts for Personal; how-to-act for shared spaces).
  // Inline SVG (not a CSS mask) to match the app's icon pattern + strict CSP.
  const bookIcon =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';
  const memoryLink = (kind, clientId) =>
    `<button class="cv-card-memory" data-memory="${kind}"${clientId ? ` data-client="${cvEscape(clientId)}"` : ''}>${bookIcon}<span>Memory & voice</span></button>`;

  // Personal — always first, keeps the single-brain behavior.
  cards.push(`
    <div class="cv-card cv-card--fixed ${isActive('personal', null, null) ? 'active' : ''}"
         data-kind="personal">
      <div class="cv-card-main" data-select="personal">
        <span class="cv-avatar cv-avatar--personal">P</span>
        <span class="cv-card-meta">
          <span class="cv-card-name">Personal</span>
          <span class="cv-card-sub">Your private brain</span>
        </span>
      </div>
      <div class="cv-card-foot">${memoryLink('personal')}</div>
    </div>`);

  // Agency (World) — shared canon beneath every brand.
  cards.push(`
    <div class="cv-card cv-card--fixed ${isActive('world', null, null) ? 'active' : ''}"
         data-kind="world">
      <div class="cv-card-main" data-select="world">
        <span class="cv-avatar cv-avatar--world">A</span>
        <span class="cv-card-meta">
          <span class="cv-card-name">Agency</span>
          <span class="cv-card-sub">Shared across all clients</span>
        </span>
      </div>
      <div class="cv-card-foot">${memoryLink('world')}</div>
    </div>`);

  // One card per client, each with its projects as selectable chips.
  const linkIcon =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 8c0-.575 0-.822.045-1.075A2.98 2.98 0 0 1 9.833 4.7c.24-.1.523-.165 1.09-.294l2.728-.623c3.39-.774 5.084-1.161 6.217-.27C21 4.405 21 6.126 21 9.568v4.864c0 3.442 0 5.164-1.132 6.055c-1.133.891-2.827.504-6.217-.27l-2.728-.623c-.567-.13-.85-.194-1.09-.294a2.98 2.98 0 0 1-1.788-2.225C8 16.822 8 16.575 8 16"/><path d="M13 9s3 2.21 3 3s-3 3-3 3m2.5-3H3"/></g></svg>';
  for (const c of clients) {
    const projects = projectsByClient[c.id] || [];
    const clientActive = isActive('client', c.id, null);
    const chips = projects
      .map(
        (p) => `
        <button class="cv-project-chip ${isActive('project', c.id, p.id) ? 'active' : ''}"
                data-select="project" data-client="${cvEscape(c.id)}" data-project="${cvEscape(p.id)}">
          ${cvEscape(p.name)}
        </button>`
      )
      .join('');
    const syncBadge = cvSyncStatusBadge(c);
    const shareBtn = c.repo_url
      ? `<button class="cv-card-memory" data-share="${cvEscape(c.id)}">${linkIcon}<span>Copy setup link</span></button>`
      : '';
    cards.push(`
      <div class="cv-card ${clientActive ? 'active' : ''}" data-kind="client">
        <div class="cv-card-main" data-select="client" data-client="${cvEscape(c.id)}">
          <span class="cv-avatar">${cvEscape(cvInitials(c.name))}</span>
          <span class="cv-card-meta">
            <span class="cv-card-name">${cvEscape(c.name)}</span>
            <span class="cv-card-sub">${projects.length} project${projects.length === 1 ? '' : 's'} · ${cvEscape(c.sync_mode)}${syncBadge}</span>
          </span>
        </div>
        <div class="cv-projects">
          ${chips}
          <button class="cv-project-chip cv-project-chip--new" data-new-project="${cvEscape(c.id)}">+ Project</button>
        </div>
        <div class="cv-card-foot">${memoryLink('client', c.id)}${shareBtn}</div>
      </div>`);
  }

  grid.innerHTML = cards.join('');
  _cvBindGrid(grid);
}

// Human-readable sync freshness suffix appended to a client card's subtitle
// (roadmap item 9 — stale indicator, relates to F6). Clients with no repo
// configured show nothing extra; the sync bar in The Brain is where setup
// happens.
function cvSyncStatusBadge(c) {
  if (!c.repo_url) return '';
  if (!c.last_pulled_at) return ' · <span class="cv-sync-badge cv-sync-badge--never">never pulled</span>';
  const ageMs = Date.now() - new Date(c.last_pulled_at).getTime();
  const stale = ageMs >= 24 * 60 * 60 * 1000; // mirrors src/clients/sync-status.ts's STALE_THRESHOLD_MS
  const label = cvRelativeTime(ageMs);
  return stale
    ? ` · <span class="cv-sync-badge cv-sync-badge--stale" title="Pull to check for updates">stale · pulled ${label}</span>`
    : ` · <span class="cv-sync-badge cv-sync-badge--fresh">pulled ${label}</span>`;
}

function cvRelativeTime(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

// Event delegation for the picker grid (cards + project chips + new project).
function _cvBindGrid(grid) {
  grid.querySelectorAll('[data-select]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      playNormalClick();
      const kind = el.dataset.select;
      if (kind === 'personal') cvSelectWorkspace(CV_PERSONAL);
      else if (kind === 'world')
        cvSelectWorkspace({ contextType: 'world', clientId: null, projectKey: null });
      else if (kind === 'client')
        cvSelectWorkspace({ contextType: 'client', clientId: el.dataset.client, projectKey: null });
      else if (kind === 'project')
        cvSelectWorkspace({
          contextType: 'project',
          clientId: el.dataset.client,
          projectKey: el.dataset.project,
        });
    });
  });
  grid.querySelectorAll('[data-memory]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      playNormalClick();
      cvOpenMemory(el.dataset.memory, el.dataset.client);
    });
  });
  grid.querySelectorAll('[data-new-project]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      playNormalClick();
      cvCreateProject(el.dataset.newProject);
    });
  });
  grid.querySelectorAll('[data-share]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      playNormalClick();
      cvCopySetupString(el.dataset.share);
    });
  });
}

// ---- Selection ----

// Apply a workspace: persist it, reveal chat, and land in a chat that belongs to
// the workspace — an existing one if present, else a fresh chat that inherits the
// workspace's memory context.
async function cvSelectWorkspace(ws) {
  setActiveWorkspaceState(ws);
  try {
    localStorage.setItem('cvHasLaunched', '1');
  } catch (_) {
    /* ignore */
  }

  hideClientsView();
  if (typeof returnToChatView === 'function') returnToChatView();

  const active = getActiveWorkspace();
  const matching = (typeof sessions !== 'undefined' ? sessions : []).filter((s) =>
    sessionMatchesWorkspace(s, active)
  );

  if (matching.some((s) => s.id === currentSessionId)) {
    // Current chat already belongs here — just refresh the filtered sidebar.
    if (typeof renderTabs === 'function') renderTabs();
  } else if (matching.length > 0) {
    if (typeof switchSession === 'function') await switchSession(matching[0].id);
  } else {
    await cvCreateWorkspaceSession(active);
  }

  updateActiveClientHeader();
  if (typeof refreshProjectSelector === 'function') await refreshProjectSelector();
}

// Create a new chat that inherits the workspace's memory context (no forced
// rename — the picker flow should feel instant).
async function cvCreateWorkspaceSession(ws) {
  try {
    const result = await window.pocketAgent.sessions.create(
      typeof getNextSessionName === 'function' ? getNextSessionName() : 'New'
    );
    if (!result.success || !result.session) {
      if (typeof _cvToast === 'function') _cvToast(result.error || 'Failed to create chat', 'error');
      return;
    }
    await applyWorkspaceToSession(result.session.id, ws);
    Object.assign(result.session, wsToSessionFields(ws));
    sessions.push(result.session);
    currentSessionId = result.session.id;
    localStorage.setItem('currentSessionId', currentSessionId);
    if (typeof renderTabs === 'function') renderTabs();
    if (typeof disableAutoAnimate === 'function') disableAutoAnimate();
    messagesDiv.innerHTML = '';
    if (typeof enableAutoAnimate === 'function') enableAutoAnimate();
    if (typeof showEmptyState === 'function') showEmptyState();
    if (typeof updateStats === 'function') updateStats();
    if (typeof updateModeUIForSession === 'function') updateModeUIForSession(result.session.id);
    if (input) input.focus();
  } catch (err) {
    console.error('[ClientPicker] Failed to create workspace chat:', err);
  }
}

// Persist a session's memory context to match a workspace.
async function applyWorkspaceToSession(sessionId, ws) {
  try {
    const res = await window.pocketAgent.sessions.setContext(sessionId, {
      contextType: ws.contextType || 'personal',
      clientId: ws.clientId ?? null,
      projectKey: ws.projectKey ?? null,
    });
    if (!res || res.success === false) {
      console.warn('[ClientPicker] setContext failed:', res && res.error);
    }
  } catch (err) {
    console.error('[ClientPicker] setContext error:', err);
  }
}

// ---- Sidebar active-client header ----

async function updateActiveClientHeader() {
  const nameEl = document.getElementById('active-client-name');
  const subEl = document.getElementById('active-client-sub');
  const avatarEl = document.getElementById('active-client-avatar');
  if (!nameEl || !avatarEl) return;

  const ws = getActiveWorkspace();
  let clients = [];
  let projects = [];
  try {
    clients = (await window.pocketAgent.clients.list()) || [];
    if (ws.clientId) projects = (await window.pocketAgent.projects.list(ws.clientId)) || [];
  } catch (_) {
    /* best-effort labeling */
  }

  const label = cvWorkspaceLabel(ws, clients, projects);
  nameEl.textContent = label;
  if (subEl) subEl.textContent = 'Switch workspace';

  avatarEl.classList.remove('cv-avatar--personal', 'cv-avatar--world');
  if (ws.contextType === 'personal') {
    avatarEl.textContent = 'P';
    avatarEl.classList.add('cv-avatar--personal');
  } else if (ws.contextType === 'world') {
    avatarEl.textContent = 'A';
    avatarEl.classList.add('cv-avatar--world');
  } else {
    const client = clients.find((c) => c.id === ws.clientId);
    avatarEl.textContent = cvInitials(client ? client.name : ws.clientId);
  }
}

// Deep-link from a workspace card into The Brain, scoped to that space:
//   personal → the Facts tab of your private brain
//   world/client → the "How to act" tab (voice, tone, banned words)
// This is the discoverable home for editing voice + other memories per client,
// without changing the active chat's workspace.
function cvOpenMemory(kind, clientId) {
  if (typeof showBrainPanel !== 'function') return;
  // showBrainPanel dismisses the picker via _dismissOtherPanels('brain-view'),
  // so no explicit hideClientsView() is needed (avoids sidebar mode churn).
  if (kind === 'personal') {
    showBrainPanel('facts', 'user');
  } else if (kind === 'world') {
    showBrainPanel('howtoact', 'world');
  } else if (kind === 'client' && clientId) {
    showBrainPanel('howtoact', `client:${clientId}`);
  }
}

// ---- Text-input modal ----
//
// Electron's renderer does NOT support window.prompt() (it returns null under
// contextIsolation), so client/project creation uses this in-DOM dialog. Reuses
// the app's .modal-overlay/.modal classes; resolves to the trimmed value, or
// null on Cancel/Escape/click-outside.
function cvTextPrompt(title, placeholder) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay cv-prompt-overlay';
    overlay.innerHTML = `
      <div class="modal cv-prompt">
        <div class="modal-header"><div class="modal-title"><h2>${cvEscape(title)}</h2></div></div>
        <div class="modal-body">
          <input class="cv-prompt-input" type="text" placeholder="${cvEscape(placeholder || '')}" maxlength="60" />
          <div class="cv-prompt-actions">
            <button class="cv-prompt-cancel">Cancel</button>
            <button class="cv-prompt-ok">Create</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('.cv-prompt-input');
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      resolve(value);
    };
    overlay.querySelector('.cv-prompt-ok').addEventListener('click', () => done(input.value.trim()));
    overlay.querySelector('.cv-prompt-cancel').addEventListener('click', () => done(null));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) done(null);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        done(input.value.trim());
      } else if (e.key === 'Escape') {
        e.preventDefault();
        done(null);
      }
    });
    requestAnimationFrame(() => {
      overlay.classList.add('show');
      input.focus();
    });
  });
}

// ---- Create client ----

async function cvCreateClient() {
  const name = ((await cvTextPrompt('New client (brand)', 'e.g. Acme Co')) || '').trim();
  if (!name) return;
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  if (!id) {
    _cvToast('Invalid client name', 'error');
    return;
  }
  try {
    const res = await window.pocketAgent.clients.create({ id, name });
    if (!res || res.success === false) {
      _cvToast((res && res.error) || 'Could not create client', 'error');
      return;
    }
    _cvToast(`Added ${name}`, 'success');
    await renderClientPicker();
  } catch (err) {
    console.error('[ClientPicker] Failed to create client:', err);
    _cvToast('Failed to create client', 'error');
  }
}

async function cvCreateProject(clientId) {
  if (!clientId) return;
  const name = ((await cvTextPrompt('New project', 'e.g. Website Redesign')) || '').trim();
  if (!name) return;
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  if (!base) {
    _cvToast('Invalid project name', 'error');
    return;
  }
  // Namespace the id by client so two clients can share a project name.
  const id = `${clientId}-${base}`.slice(0, 60);
  try {
    const res = await window.pocketAgent.projects.create({ id, clientId, name });
    if (!res || res.success === false) {
      _cvToast((res && res.error) || 'Could not create project', 'error');
      return;
    }
    _cvToast(`Added ${name}`, 'success');
    await renderClientPicker();
  } catch (err) {
    console.error('[ClientPicker] Failed to create project:', err);
    _cvToast('Failed to create project', 'error');
  }
}

// ---- Shareable setup strings (roadmap item 9 — join your team's brains) ----
//
// A "setup string" is base64(JSON) of { id, name, repoUrl, syncMode } —
// pastable anywhere (Slack, email, a notes app). It never carries a GitHub
// token: each teammate authenticates with their own token (Settings ->
// GitHub Token), so the string alone can't grant repo access.

async function cvCopySetupString(clientId) {
  if (!clientId) return;
  try {
    const res = await window.pocketAgent.clients.getSetupString(clientId);
    if (!res || !res.success) {
      _cvToast((res && res.error) || 'Could not build setup link', 'error');
      return;
    }
    await navigator.clipboard.writeText(res.setupString);
    _cvToast('Setup link copied — share it with your teammate', 'success');
  } catch (err) {
    console.error('[ClientPicker] Failed to copy setup string:', err);
    _cvToast('Failed to copy setup link', 'error');
  }
}

// In-DOM paste dialog for joining a client via a setup string, same
// overlay/modal convention as cvTextPrompt. Returns the pasted string
// (trimmed) or null on Cancel/Escape/click-outside.
function cvSetupStringPrompt() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay cv-prompt-overlay';
    overlay.innerHTML = `
      <div class="modal cv-prompt">
        <div class="modal-header"><div class="modal-title"><h2>Join a client</h2></div></div>
        <div class="modal-body">
          <p class="cv-join-hint">Paste the setup link a teammate shared with you. Make sure your GitHub token is set in Settings first so the initial pull can authenticate.</p>
          <textarea class="cv-prompt-input cv-join-textarea" rows="3" placeholder="pocketagent://join?..."></textarea>
          <div class="cv-prompt-actions">
            <button class="cv-prompt-cancel">Cancel</button>
            <button class="cv-prompt-ok">Join</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('.cv-join-textarea');
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      resolve(value);
    };
    overlay.querySelector('.cv-prompt-ok').addEventListener('click', () => done(input.value.trim()));
    overlay.querySelector('.cv-prompt-cancel').addEventListener('click', () => done(null));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) done(null);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        done(null);
      }
    });
    requestAnimationFrame(() => {
      overlay.classList.add('show');
      input.focus();
    });
  });
}

async function cvJoinClient() {
  const raw = await cvSetupStringPrompt();
  if (!raw) return;
  try {
    const res = await window.pocketAgent.clients.join(raw);
    if (!res || !res.success) {
      _cvToast((res && res.error) || 'Could not join client', 'error');
      return;
    }
    if (res.pulled) {
      _cvToast(`Joined ${res.client.name} and pulled its brain`, 'success');
    } else {
      _cvToast(`Joined ${res.client.name}${res.pullError ? ` — ${res.pullError}` : ' (pull it once set up)'}`, 'success');
    }
    await renderClientPicker();
  } catch (err) {
    console.error('[ClientPicker] Failed to join client:', err);
    _cvToast('Failed to join client', 'error');
  }
}

// ---- Pull all (manual sweep across every live-sync client) ----

async function cvPullAll() {
  const btn = document.getElementById('cv-pull-all-btn');
  if (btn) btn.disabled = true;
  try {
    const results = (await window.pocketAgent.sync.pullAll()) || [];
    if (results.length === 0) {
      _cvToast('No live-sync clients to pull', 'success');
      return;
    }
    const failed = results.filter((r) => !r.ok);
    if (failed.length === 0) {
      _cvToast(`Pulled ${results.length} client${results.length === 1 ? '' : 's'}`, 'success');
    } else {
      _cvToast(`Pulled ${results.length - failed.length}/${results.length} — ${failed[0].name} failed: ${failed[0].error || 'unknown error'}`, 'error');
    }
    await renderClientPicker();
  } catch (err) {
    console.error('[ClientPicker] Failed to pull all clients:', err);
    _cvToast('Failed to pull clients', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---- Toast (reuses Notyf if available) ----

let _cvNotyf = null;
function _cvToast(message, type) {
  try {
    if (!_cvNotyf && typeof Notyf !== 'undefined') {
      _cvNotyf = new Notyf({
        duration: 3000,
        position: { x: 'right', y: 'bottom' },
        dismissible: true,
        types: [
          { type: 'success', background: '#4ade80' },
          { type: 'error', background: '#f87171' },
        ],
      });
    }
    if (_cvNotyf) _cvNotyf[type === 'error' ? 'error' : 'success'](message);
  } catch (_) {
    /* toast is best-effort */
  }
}

// ---- Init + launch ----

function initClientsView() {
  if (_cvInitialized) return;
  _cvInitialized = true;
  // The active-client header + New Client button are bound in event-bindings.js
  // (consistent with the app's binding pattern). Nothing else to set up here yet.
}

// Decide the launch destination (called after sessions load):
//   - zero clients  → default to Personal, no dead-end picker.
//   - resume last   → a valid saved workspace + prior launch → straight to chat.
//   - otherwise     → the picker (the front door).
async function cvLaunch() {
  let clients = [];
  try {
    clients = (await window.pocketAgent.clients.list()) || [];
  } catch (_) {
    /* treat as none */
  }

  await updateActiveClientHeader();
  if (typeof refreshProjectSelector === 'function') await refreshProjectSelector();

  if (clients.length === 0) {
    // Single-brain user: keep today's behavior, stay in chat.
    if (getActiveWorkspace().contextType !== 'personal') setActiveWorkspaceState(CV_PERSONAL);
    await updateActiveClientHeader();
    return;
  }

  const ws = getActiveWorkspace();
  const validClient =
    ws.contextType === 'personal' ||
    ws.contextType === 'world' ||
    ((ws.contextType === 'client' || ws.contextType === 'project') &&
      clients.some((c) => c.id === ws.clientId));
  const hasLaunched = localStorage.getItem('cvHasLaunched') === '1';

  if (hasLaunched && validClient) {
    // Resume the last workspace without forcing the picker.
    return;
  }
  showClientsView();
}
