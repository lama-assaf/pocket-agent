/* Content Queue Panel — embedded in chat.html (roadmap item 6). Per-brand
   drafts moving through a human-gated approval pipeline: list by status,
   view body, approve/reject, post/schedule an approved draft, and see post
   history. Approval/rejection here is the ONLY place those transitions can
   happen — there is no agent tool for it (src/tools/content-tools.ts /
   src/memory/content-drafts.ts enforce this server-side too). Follows
   agents-panel.js's conventions (list/detail views, _dismissOtherPanels,
   scope-label helpers, toast). */

let _cntNotyf = null;
let _cntDrafts = []; // cached list from the last load, for detail lookups without a re-fetch
let _cntCurrentDraftId = null;
let _cntCurrentStatusFilter = null; // null = all statuses
let _cntClientsCache = null;
let _cntProjectsCache = {};

// ---- Show / Hide ----

function showContentPanel() {
  const chatView = document.getElementById('chat-view');
  const contentView = document.getElementById('content-view');
  if (!contentView) return;

  _dismissOtherPanels('content-view');

  chatView.classList.add('hidden');
  contentView.classList.add('active');
  if (window._sidebarEnterPanelMode) window._sidebarEnterPanelMode();

  const sidebarBtn = document.getElementById('sidebar-content-btn');
  if (sidebarBtn) sidebarBtn.classList.add('active');

  _cntShowList();
  _cntLoadDrafts();
}

function hideContentPanel() {
  const chatView = document.getElementById('chat-view');
  const contentView = document.getElementById('content-view');
  if (!contentView) return;

  contentView.classList.remove('active');
  chatView.classList.remove('hidden');
  if (window._sidebarExitPanelMode) window._sidebarExitPanelMode();

  const sidebarBtn = document.getElementById('sidebar-content-btn');
  if (sidebarBtn) sidebarBtn.classList.remove('active');
}

function toggleContentPanel() {
  const contentView = document.getElementById('content-view');
  if (contentView && contentView.classList.contains('active')) {
    hideContentPanel();
  } else {
    showContentPanel();
  }
}

function cntRefresh() {
  _cntLoadDrafts();
  _cntShowToast('Refreshed', 'success');
}

// ---- Toast ----

function _cntShowToast(message, type) {
  if (!_cntNotyf) {
    _cntNotyf = new Notyf({
      duration: 3000, position: { x: 'right', y: 'bottom' },
      dismissible: true,
      types: [
        { type: 'success', background: '#4ade80' },
        { type: 'error', background: '#f87171' }
      ]
    });
  }
  _cntNotyf[type === 'error' ? 'error' : 'success'](window.cleanToastMessage ? window.cleanToastMessage(message) : message);
}

// ---- Helpers ----

function _cntEscapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function _cntEscapeAttr(text) {
  return String(text).replace(/'/g, "\\'").replace(/"/g, '\\"');
}

// The active workspace context — same shape as agents-panel.js's _agtContext.
function _cntContext() {
  if (typeof getActiveWorkspace === 'function') return getActiveWorkspace();
  return { contextType: 'personal', clientId: null, projectKey: null };
}

async function _cntEnsureScopeLabelData() {
  if (!_cntClientsCache) {
    try {
      _cntClientsCache = (await window.pocketAgent.clients.list()) || [];
    } catch (_) {
      _cntClientsCache = [];
    }
  }
  const ctx = _cntContext();
  if (ctx.clientId && !_cntProjectsCache[ctx.clientId]) {
    try {
      _cntProjectsCache[ctx.clientId] = (await window.pocketAgent.projects.list(ctx.clientId)) || [];
    } catch (_) {
      _cntProjectsCache[ctx.clientId] = [];
    }
  }
}

function _cntScopeLabel(scope) {
  if (!scope) return '';
  if (scope === 'world') return 'Agency-wide';
  if (scope === 'user') return 'Personal';
  if (scope.startsWith('client:')) {
    const id = scope.slice('client:'.length);
    const client = (_cntClientsCache || []).find((c) => c.id === id);
    return client ? client.name : id;
  }
  if (scope.startsWith('project:')) {
    const id = scope.slice('project:'.length);
    for (const projects of Object.values(_cntProjectsCache)) {
      const project = (projects || []).find((p) => p.id === id);
      if (project) return project.name;
    }
    return id;
  }
  return scope;
}

function _cntStatusBadgeClass(status) {
  switch (status) {
    case 'approved': return 'status success';
    case 'posted': return 'status success';
    case 'scheduled': return 'status info';
    case 'pending_approval': return 'status warning';
    case 'rejected': return 'status error';
    case 'failed': return 'status error';
    default: return 'status'; // draft
  }
}

function _cntFormatStatus(status) {
  return status.replace(/_/g, ' ');
}

function _cntFormatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString();
  } catch (_) {
    return iso;
  }
}

// ---- List view ----

function _cntShowList() {
  const listView = document.getElementById('cnt-list-view');
  const detailView = document.getElementById('cnt-detail-view');
  if (listView) listView.classList.remove('hidden');
  if (detailView) detailView.classList.add('hidden');
  _cntCurrentDraftId = null;
}

function cntSetStatusFilter(status) {
  _cntCurrentStatusFilter = status || null;
  document.querySelectorAll('.cnt-filter-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.status === (status || ''));
  });
  _cntLoadDrafts();
}

async function _cntLoadDrafts() {
  const listEl = document.getElementById('cnt-drafts');
  const emptyEl = document.getElementById('cnt-empty');
  const countEl = document.getElementById('cnt-active-count');
  if (!listEl) return;

  try {
    await _cntEnsureScopeLabelData();
    const drafts = await window.pocketAgent.content.list(_cntContext(), _cntCurrentStatusFilter || undefined);
    _cntDrafts = drafts || [];
    if (countEl) countEl.textContent = `(${_cntDrafts.length})`;

    if (_cntDrafts.length === 0) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');

    listEl.innerHTML = _cntDrafts.map(_cntCardHtml).join('');
  } catch (err) {
    console.error('[Content] Failed to load drafts:', err);
    _cntShowToast('Failed to load content queue', 'error');
  }
}

function _cntCardHtml(d) {
  const snippet = (d.body || '').slice(0, 140);
  return `
    <button class="cnt-card" onclick="playNormalClick(); cntShowDetail(${d.id})">
      <div class="cnt-card-head">
        <span class="cnt-card-title">${_cntEscapeHtml(d.title || '(untitled)')}</span>
        <span class="badge">${_cntEscapeHtml(d.channel)}</span>
        <span class="${_cntStatusBadgeClass(d.status)}">${_cntEscapeHtml(_cntFormatStatus(d.status))}</span>
      </div>
      <div class="cnt-card-snippet">${_cntEscapeHtml(snippet)}${d.body && d.body.length > 140 ? '…' : ''}</div>
      <div class="cnt-card-meta">${_cntEscapeHtml(_cntFormatDate(d.updated_at))}</div>
    </button>`;
}

// ---- Detail view ----

function cntBackToList() {
  _cntShowList();
}

async function cntShowDetail(id) {
  const listView = document.getElementById('cnt-list-view');
  const detailView = document.getElementById('cnt-detail-view');
  const body = document.getElementById('cnt-detail-body');
  if (!body) return;

  if (listView) listView.classList.add('hidden');
  if (detailView) detailView.classList.remove('hidden');
  body.innerHTML = '<div class="cnt-detail-desc">Loading…</div>';

  try {
    const draft = await window.pocketAgent.content.get(id);
    if (!draft) {
      body.innerHTML = '<div class="cnt-detail-desc">Draft not found.</div>';
      return;
    }
    _cntCurrentDraftId = id;
    await _cntRenderDetail(draft);
  } catch (err) {
    console.error('[Content] Failed to load draft detail:', err);
    body.innerHTML = '<div class="cnt-detail-desc">Failed to load draft.</div>';
  }
}

async function _cntRenderDetail(draft) {
  const body = document.getElementById('cnt-detail-body');
  if (!body) return;

  let history = [];
  try {
    history = (await window.pocketAgent.content.history(_cntContext(), draft.id)) || [];
  } catch (_) {
    history = [];
  }

  const actions = [];
  // A draft created by hand here (not via the agent's save_draft +
  // submit_for_approval tools) previously had no way to enter the approval
  // pipeline at all — Edit/Delete were the only actions offered for status
  // 'draft', a dead end. Mirrors submit_for_approval's own transition
  // (draft -> pending_approval only), so this only appears in that state.
  if (draft.status === 'draft') {
    actions.push(`<button class="btn-cinamon" onclick="playNormalClick(); cntSubmitForApproval(${draft.id})">Submit for approval</button>`);
  }
  if (draft.status === 'pending_approval') {
    actions.push(`<button class="btn-cinamon" onclick="playNormalClick(); cntApprove(${draft.id})">Approve</button>`);
    actions.push(`<button class="btn-danger" onclick="playNormalClick(); cntReject(${draft.id})">Reject</button>`);
  }
  if (draft.status === 'approved') {
    actions.push(`<button class="btn-cinamon" onclick="playNormalClick(); cntPostNow(${draft.id})">Post now</button>`);
    actions.push(`<button class="btn-shell" onclick="playNormalClick(); cntShowScheduleForm(${draft.id})">Schedule…</button>`);
  }
  // 'scheduled' previously had no actions but Delete — a dead end for
  // anyone who wants to stop or change a queued post before its cron job
  // fires. Both reuse existing human-only transitions already allowed by
  // content-drafts.ts's TRANSITIONS table (scheduled -> approved/draft);
  // setContentDraftStatus also cancels the underlying cron job on the way
  // out of 'scheduled', so canceling here can't leave a stray job behind.
  if (draft.status === 'scheduled') {
    actions.push(`<button class="btn-cinamon" onclick="playNormalClick(); cntApprove(${draft.id})">Cancel schedule</button>`);
    actions.push(`<button class="btn-shell" onclick="playNormalClick(); cntSetStatus(${draft.id}, 'draft')">Back to draft</button>`);
  }
  // 'failed' (a real post attempt errored) also previously had no actions
  // but Delete, even though content-drafts.ts's TRANSITIONS explicitly
  // allows failed -> draft/approved for exactly this "fix it and retry"
  // case. "Retry" re-approves without editing (transient failure, e.g. an
  // MCP tool hiccup); "Back to draft" is for when the content itself needs
  // fixing before trying again.
  if (draft.status === 'failed') {
    actions.push(`<button class="btn-cinamon" onclick="playNormalClick(); cntApprove(${draft.id})">Retry</button>`);
    actions.push(`<button class="btn-shell" onclick="playNormalClick(); cntSetStatus(${draft.id}, 'draft')">Back to draft</button>`);
  }
  if (draft.status === 'draft' || draft.status === 'rejected') {
    actions.push(`<button class="btn-shell" onclick="playNormalClick(); cntEditDraft(${draft.id})">Edit</button>`);
  }
  actions.push(`<button class="btn-shell" onclick="playNormalClick(); cntDeleteDraft(${draft.id})">Delete</button>`);

  const scheduledNote = draft.status === 'scheduled' && draft.scheduled_for
    ? `<div class="cnt-detail-note">Scheduled for ${_cntEscapeHtml(_cntFormatDate(draft.scheduled_for))}</div>`
    : '';
  const postedNote = draft.status === 'posted' && draft.posted_at
    ? `<div class="cnt-detail-note">Posted at ${_cntEscapeHtml(_cntFormatDate(draft.posted_at))}</div>`
    : '';

  const historyHtml = history.length
    ? `
      <div class="cnt-prompt-label">Post history</div>
      <div class="cnt-history-list">
        ${history.map((h) => `
          <div class="cnt-history-row">
            <span class="${_cntStatusBadgeClass(h.status === 'dry_run' ? 'scheduled' : h.status)}">${_cntEscapeHtml(h.status === 'dry_run' ? 'dry run' : h.status)}</span>
            <span class="cnt-history-detail">${_cntEscapeHtml((h.detail || '').slice(0, 200))}</span>
            <span class="cnt-history-date">${_cntEscapeHtml(_cntFormatDate(h.created_at))}</span>
          </div>
        `).join('')}
      </div>`
    : '';

  body.innerHTML = `
    <div class="cnt-detail-head">
      <span class="cnt-detail-title">${_cntEscapeHtml(draft.title || '(untitled)')}</span>
      <span class="badge">${_cntEscapeHtml(draft.channel)}</span>
      <span class="${_cntStatusBadgeClass(draft.status)}">${_cntEscapeHtml(_cntFormatStatus(draft.status))}</span>
    </div>
    <div class="cnt-detail-meta">${_cntEscapeHtml(_cntScopeLabel(draft.scope))} · updated ${_cntEscapeHtml(_cntFormatDate(draft.updated_at))}</div>
    ${scheduledNote}
    ${postedNote}
    <div class="cnt-detail-actions">${actions.join('')}</div>
    <div class="cnt-prompt-label">Body</div>
    <div class="cnt-prompt-body">${_cntEscapeHtml(draft.body)}</div>
    <div id="cnt-schedule-form"></div>
    ${historyHtml}
  `;
}

// ---- Submit for approval (human path — same transition the agent's
// submit_for_approval tool uses, just triggerable from the UI for drafts
// a human wrote directly instead of asking the agent to save+submit) ----

async function cntSubmitForApproval(id) {
  try {
    const res = await window.pocketAgent.content.submitForApproval(id);
    if (!res || !res.success) {
      _cntShowToast((res && res.error) || 'Failed to submit for approval', 'error');
      return;
    }
    _cntShowToast('Submitted for approval', 'success');
    await cntShowDetail(id);
    _cntLoadDrafts();
  } catch (err) {
    console.error('[Content] Failed to submit draft for approval:', err);
    _cntShowToast('Failed to submit for approval', 'error');
  }
}

// ---- Approve / Reject (human-only) ----

async function cntApprove(id) {
  try {
    const res = await window.pocketAgent.content.approve(id);
    if (!res || !res.success) {
      _cntShowToast((res && res.error) || 'Failed to approve', 'error');
      return;
    }
    _cntShowToast('Approved', 'success');
    await cntShowDetail(id);
  } catch (err) {
    console.error('[Content] Failed to approve draft:', err);
    _cntShowToast('Failed to approve', 'error');
  }
}

async function cntReject(id) {
  try {
    const res = await window.pocketAgent.content.reject(id);
    if (!res || !res.success) {
      _cntShowToast((res && res.error) || 'Failed to reject', 'error');
      return;
    }
    _cntShowToast('Rejected', 'success');
    await cntShowDetail(id);
  } catch (err) {
    console.error('[Content] Failed to reject draft:', err);
    _cntShowToast('Failed to reject', 'error');
  }
}

// Generic escape hatch for the edges that don't have a dedicated verb yet
// ('scheduled' -> 'draft', 'failed' -> 'draft' — see _cntRenderDetail's
// action list). Server-enforced by the same canTransition state machine as
// every other transition here, just reached through content:setStatus
// instead of a named IPC action.
async function cntSetStatus(id, status) {
  try {
    const res = await window.pocketAgent.content.setStatus(id, status);
    if (!res || !res.success) {
      _cntShowToast((res && res.error) || 'Failed to update status', 'error');
      return;
    }
    _cntShowToast('Moved back to draft', 'success');
    await cntShowDetail(id);
    _cntLoadDrafts();
  } catch (err) {
    console.error('[Content] Failed to update draft status:', err);
    _cntShowToast('Failed to update status', 'error');
  }
}

// ---- Post / Schedule (approved only — server-enforced) ----

async function cntPostNow(id) {
  if (!confirm('Post this draft now? While dry-run mode is on, nothing is actually sent.')) return;
  try {
    const res = await window.pocketAgent.content.postNow(id, _cntContext());
    if (!res || !res.success) {
      _cntShowToast((res && res.error) || 'Failed to post', 'error');
      await cntShowDetail(id);
      return;
    }
    _cntShowToast(res.dryRun ? 'Dry run logged (no real post sent)' : 'Posted', 'success');
    await cntShowDetail(id);
    _cntLoadDrafts();
  } catch (err) {
    console.error('[Content] Failed to post draft:', err);
    _cntShowToast('Failed to post', 'error');
  }
}

function cntShowScheduleForm(id) {
  const container = document.getElementById('cnt-schedule-form');
  if (!container) return;
  container.innerHTML = `
    <div class="cnt-schedule-row">
      <input type="datetime-local" class="cnt-edit-input" id="cnt-schedule-input" />
      <button class="btn-cinamon btn-compact" onclick="playNormalClick(); cntConfirmSchedule(${id})">Confirm</button>
    </div>`;
}

async function cntConfirmSchedule(id) {
  const input = document.getElementById('cnt-schedule-input');
  if (!input || !input.value) {
    _cntShowToast('Pick a date/time first', 'error');
    return;
  }
  try {
    const iso = new Date(input.value).toISOString();
    const res = await window.pocketAgent.content.schedule(id, iso);
    if (!res || !res.success) {
      _cntShowToast((res && res.error) || 'Failed to schedule', 'error');
      return;
    }
    _cntShowToast('Scheduled', 'success');
    await cntShowDetail(id);
    _cntLoadDrafts();
  } catch (err) {
    console.error('[Content] Failed to schedule draft:', err);
    _cntShowToast('Failed to schedule', 'error');
  }
}

// ---- Delete ----

async function cntDeleteDraft(id) {
  if (!confirm('Delete this draft? This cannot be undone.')) return;
  try {
    const res = await window.pocketAgent.content.delete(id);
    if (!res || !res.success) {
      _cntShowToast('Failed to delete', 'error');
      return;
    }
    _cntShowToast('Deleted', 'success');
    _cntShowList();
    _cntLoadDrafts();
  } catch (err) {
    console.error('[Content] Failed to delete draft:', err);
    _cntShowToast('Failed to delete', 'error');
  }
}

// ---- New draft ----

function cntShowNewDraftForm() {
  const listView = document.getElementById('cnt-list-view');
  const detailView = document.getElementById('cnt-detail-view');
  const body = document.getElementById('cnt-detail-body');
  if (!body) return;

  if (listView) listView.classList.add('hidden');
  if (detailView) detailView.classList.remove('hidden');
  _cntCurrentDraftId = null;

  body.innerHTML = `
    <div class="cnt-detail-head"><span class="cnt-detail-title">New draft</span></div>
    <label class="cnt-edit-label" for="cnt-new-channel">Channel</label>
    <input class="cnt-edit-input" id="cnt-new-channel" placeholder="twitter, linkedin, blog…" />
    <label class="cnt-edit-label" for="cnt-new-title">Title (optional)</label>
    <input class="cnt-edit-input" id="cnt-new-title" />
    <label class="cnt-edit-label" for="cnt-new-body">Body</label>
    <textarea class="cnt-edit-textarea" id="cnt-new-body" rows="10"></textarea>
    <div class="cnt-detail-actions">
      <button class="btn-cinamon" onclick="playNormalClick(); cntSaveNewDraft()">Save draft</button>
      <button class="btn-shell" onclick="playNormalClick(); cntBackToList()">Cancel</button>
    </div>
  `;
}

async function cntSaveNewDraft() {
  const channelEl = document.getElementById('cnt-new-channel');
  const titleEl = document.getElementById('cnt-new-title');
  const bodyEl = document.getElementById('cnt-new-body');

  const channel = channelEl ? channelEl.value.trim() : '';
  const title = titleEl ? titleEl.value.trim() : '';
  const draftBody = bodyEl ? bodyEl.value.trim() : '';

  if (!channel || !draftBody) {
    _cntShowToast('Channel and body are required', 'error');
    return;
  }

  try {
    const res = await window.pocketAgent.content.create({ channel, title, body: draftBody }, _cntContext());
    if (!res || !res.success) {
      _cntShowToast((res && res.error) || 'Failed to save draft', 'error');
      return;
    }
    _cntShowToast('Draft saved', 'success');
    _cntLoadDrafts();
    await cntShowDetail(res.id);
  } catch (err) {
    console.error('[Content] Failed to save new draft:', err);
    _cntShowToast('Failed to save draft', 'error');
  }
}

// ---- Edit existing draft (draft/rejected only — server-enforced) ----

function cntEditDraft(id) {
  const draft = _cntDrafts.find((d) => d.id === id);
  const body = document.getElementById('cnt-detail-body');
  if (!body) return;

  const channel = draft ? draft.channel : '';
  const title = draft ? draft.title : '';
  const draftBody = draft ? draft.body : '';

  body.innerHTML = `
    <div class="cnt-detail-head"><span class="cnt-detail-title">Editing draft</span></div>
    <label class="cnt-edit-label" for="cnt-edit-channel">Channel</label>
    <input class="cnt-edit-input" id="cnt-edit-channel" value="${_cntEscapeHtml(channel)}" />
    <label class="cnt-edit-label" for="cnt-edit-title">Title</label>
    <input class="cnt-edit-input" id="cnt-edit-title" value="${_cntEscapeHtml(title)}" />
    <label class="cnt-edit-label" for="cnt-edit-body">Body</label>
    <textarea class="cnt-edit-textarea" id="cnt-edit-body" rows="10">${_cntEscapeHtml(draftBody)}</textarea>
    <div class="cnt-detail-actions">
      <button class="btn-cinamon" onclick="playNormalClick(); cntSaveEdit(${id})">Save</button>
      <button class="btn-shell" onclick="playNormalClick(); cntShowDetail(${id})">Cancel</button>
    </div>
  `;
}

async function cntSaveEdit(id) {
  const channelEl = document.getElementById('cnt-edit-channel');
  const titleEl = document.getElementById('cnt-edit-title');
  const bodyEl = document.getElementById('cnt-edit-body');

  const channel = channelEl ? channelEl.value.trim() : '';
  const title = titleEl ? titleEl.value.trim() : '';
  const draftBody = bodyEl ? bodyEl.value.trim() : '';

  if (!channel || !draftBody) {
    _cntShowToast('Channel and body are required', 'error');
    return;
  }

  try {
    const res = await window.pocketAgent.content.update(id, { channel, title, body: draftBody });
    if (!res || !res.success) {
      _cntShowToast((res && res.error) || 'Failed to save edits', 'error');
      return;
    }
    _cntShowToast('Draft updated', 'success');
    _cntLoadDrafts();
    await cntShowDetail(id);
  } catch (err) {
    console.error('[Content] Failed to save draft edits:', err);
    _cntShowToast('Failed to save edits', 'error');
  }
}
