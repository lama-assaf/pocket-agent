// ============ Project Selector (active client's projects) ============
//
// The scope *pill* was retired in favor of the Client Picker (clients-view.js):
// you pick a workspace up front, and the active client is shown as a sidebar
// header. What remains next to the mode selector is a compact Project selector —
// it refines the active *client* workspace down to one of its projects (or "All
// of <client>"). It is hidden for Personal/Agency workspaces, which have no
// projects.
//
// State lives in clients-view.js (getActiveWorkspace / setActiveWorkspaceState).
// This module only drives the <select id="project-select"> control.

async function initMemoryScope() {
  // Binding lives in event-bindings.js (onProjectSelectChange); here we just
  // populate the control to reflect the active workspace.
  await refreshProjectSelector();
}

// Change handler for the Project selector — bound in event-bindings.js. Refines
// the active client workspace to a project (or back to "All of <client>").
async function onProjectSelectChange() {
  const select = document.getElementById('project-select');
  if (!select) return;
  const ws = getActiveWorkspace();
  if (ws.contextType !== 'client' && ws.contextType !== 'project') return;
  const projectKey = select.value || null;
  const next = {
    contextType: projectKey ? 'project' : 'client',
    clientId: ws.clientId,
    projectKey,
  };
  setActiveWorkspaceState(next);
  // Apply to the current chat so its memory scopes to the chosen project.
  if (typeof applyWorkspaceToSession === 'function') {
    await applyWorkspaceToSession(currentSessionId, next);
  }
  // Reflect on the local session object + re-filter the sidebar.
  const session = typeof sessions !== 'undefined' ? sessions.find((s) => s.id === currentSessionId) : null;
  if (session && typeof wsToSessionFields === 'function') {
    Object.assign(session, wsToSessionFields(next));
  }
  if (typeof renderTabs === 'function') renderTabs();
  if (typeof updateActiveClientHeader === 'function') updateActiveClientHeader();
}

// Populate the Project selector from the active client's projects and reflect the
// current selection. Hidden entirely unless a client workspace is active.
async function refreshProjectSelector() {
  const select = document.getElementById('project-select');
  if (!select) return;

  const ws = getActiveWorkspace();
  if (ws.contextType !== 'client' && ws.contextType !== 'project') {
    select.classList.add('hidden');
    return;
  }

  let projects = [];
  try {
    projects = (await window.pocketAgent.projects.list(ws.clientId)) || [];
  } catch (err) {
    console.error('[ProjectSelector] Failed to list projects:', err);
  }

  select.innerHTML = [
    '<option value="">All of client</option>',
    ...projects.map((p) => `<option value="${_msEscape(p.id)}">${_msEscape(p.name)}</option>`),
  ].join('');

  const value = ws.contextType === 'project' && ws.projectKey ? ws.projectKey : '';
  select.value = value;
  if (select.value !== value) select.value = '';
  select.classList.remove('hidden');
}

// Reflect a session's stored workspace when switching chats. Kept for call sites
// in sessions.js (switchSession) that used to update the scope pill.
async function updateScopeUIForSession() {
  await refreshProjectSelector();
}

function _msEscape(text) {
  const div = document.createElement('div');
  div.textContent = String(text ?? '');
  return div.innerHTML;
}
