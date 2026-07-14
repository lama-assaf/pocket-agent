/* Campaign Board Panel — embedded in chat.html (roadmap item 10). Read-only-
   leaning board for multi-deliverable plans: list campaigns → drill into a
   campaign's deliverables with status/dependency display, plus a human path
   to create campaigns/deliverables and move statuses (the agent has the
   same tools server-side — src/tools/campaign-tools.ts). The "Nudge" button
   resolves the next unblocked deliverable (src/main/ipc/campaign-ipc.ts's
   campaigns:nudgePrompt) and prefills the chat composer so the human decides
   whether/when to send it — no auto-dispatch. Follows content-panel.js's
   conventions (list/detail views, _dismissOtherPanels, scope-label helpers,
   toast). */

let _cpnNotyf = null;
let _cpnCampaigns = []; // cached list from the last load
let _cpnCurrentCampaignId = null;
let _cpnCurrentStatusFilter = null; // null = all statuses
let _cpnClientsCache = null;
let _cpnProjectsCache = {};

const CPN_DELIVERABLE_STATUSES = ['pending', 'in_progress', 'review', 'done', 'blocked'];

// ---- Show / Hide ----

function showCampaignsPanel() {
  const chatView = document.getElementById('chat-view');
  const campaignsView = document.getElementById('campaigns-view');
  if (!campaignsView) return;

  _dismissOtherPanels('campaigns-view');

  chatView.classList.add('hidden');
  campaignsView.classList.add('active');
  if (window._sidebarEnterPanelMode) window._sidebarEnterPanelMode();

  const sidebarBtn = document.getElementById('sidebar-campaigns-btn');
  if (sidebarBtn) sidebarBtn.classList.add('active');

  _cpnShowList();
  _cpnLoadCampaigns();
}

function hideCampaignsPanel() {
  const chatView = document.getElementById('chat-view');
  const campaignsView = document.getElementById('campaigns-view');
  if (!campaignsView) return;

  campaignsView.classList.remove('active');
  chatView.classList.remove('hidden');
  if (window._sidebarExitPanelMode) window._sidebarExitPanelMode();

  const sidebarBtn = document.getElementById('sidebar-campaigns-btn');
  if (sidebarBtn) sidebarBtn.classList.remove('active');
}

function toggleCampaignsPanel() {
  const campaignsView = document.getElementById('campaigns-view');
  if (campaignsView && campaignsView.classList.contains('active')) {
    hideCampaignsPanel();
  } else {
    showCampaignsPanel();
  }
}

function cpnRefresh() {
  _cpnLoadCampaigns();
  _cpnShowToast('Refreshed', 'success');
}

// ---- Toast ----

function _cpnShowToast(message, type) {
  if (!_cpnNotyf) {
    _cpnNotyf = new Notyf({
      duration: 3000, position: { x: 'right', y: 'bottom' },
      dismissible: true,
      types: [
        { type: 'success', background: '#4ade80' },
        { type: 'error', background: '#f87171' }
      ]
    });
  }
  _cpnNotyf[type === 'error' ? 'error' : 'success'](window.cleanToastMessage ? window.cleanToastMessage(message) : message);
}

// ---- Helpers ----

function _cpnEscapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// The active workspace context — same shape as content-panel.js's _cntContext.
function _cpnContext() {
  if (typeof getActiveWorkspace === 'function') return getActiveWorkspace();
  return { contextType: 'personal', clientId: null, projectKey: null };
}

async function _cpnEnsureScopeLabelData() {
  if (!_cpnClientsCache) {
    try {
      _cpnClientsCache = (await window.pocketAgent.clients.list()) || [];
    } catch (_) {
      _cpnClientsCache = [];
    }
  }
  const ctx = _cpnContext();
  if (ctx.clientId && !_cpnProjectsCache[ctx.clientId]) {
    try {
      _cpnProjectsCache[ctx.clientId] = (await window.pocketAgent.projects.list(ctx.clientId)) || [];
    } catch (_) {
      _cpnProjectsCache[ctx.clientId] = [];
    }
  }
}

function _cpnScopeLabel(scope) {
  if (!scope) return '';
  if (scope === 'world') return 'Agency-wide';
  if (scope === 'user') return 'Personal';
  if (scope.startsWith('client:')) {
    const id = scope.slice('client:'.length);
    const client = (_cpnClientsCache || []).find((c) => c.id === id);
    return client ? client.name : id;
  }
  if (scope.startsWith('project:')) {
    const id = scope.slice('project:'.length);
    for (const projects of Object.values(_cpnProjectsCache)) {
      const project = (projects || []).find((p) => p.id === id);
      if (project) return project.name;
    }
    return id;
  }
  return scope;
}

function _cpnCampaignStatusBadgeClass(status) {
  switch (status) {
    case 'active': return 'status success';
    case 'completed': return 'status info';
    case 'paused': return 'status warning';
    case 'archived': return 'status';
    default: return 'status';
  }
}

function _cpnDeliverableStatusBadgeClass(status) {
  switch (status) {
    case 'done': return 'status success';
    case 'in_progress': return 'status info';
    case 'review': return 'status warning';
    case 'blocked': return 'status error';
    default: return 'status'; // pending
  }
}

function _cpnFormatStatus(status) {
  return String(status).replace(/_/g, ' ');
}

function _cpnFormatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString();
  } catch (_) {
    return iso;
  }
}

// ---- List view ----

function _cpnShowList() {
  const listView = document.getElementById('cpn-list-view');
  const detailView = document.getElementById('cpn-detail-view');
  if (listView) listView.classList.remove('hidden');
  if (detailView) detailView.classList.add('hidden');
  _cpnCurrentCampaignId = null;
}

function cpnSetStatusFilter(status) {
  _cpnCurrentStatusFilter = status || null;
  document.querySelectorAll('.cpn-filter-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.status === (status || ''));
  });
  _cpnLoadCampaigns();
}

async function _cpnLoadCampaigns() {
  const listEl = document.getElementById('cpn-campaigns');
  const emptyEl = document.getElementById('cpn-empty');
  const countEl = document.getElementById('cpn-active-count');
  if (!listEl) return;

  try {
    await _cpnEnsureScopeLabelData();
    const campaigns = await window.pocketAgent.campaigns.list(_cpnContext(), _cpnCurrentStatusFilter || undefined);
    _cpnCampaigns = campaigns || [];
    if (countEl) countEl.textContent = `(${_cpnCampaigns.length})`;

    if (_cpnCampaigns.length === 0) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');

    listEl.innerHTML = _cpnCampaigns.map(_cpnCardHtml).join('');
  } catch (err) {
    console.error('[Campaigns] Failed to load campaigns:', err);
    _cpnShowToast('Failed to load campaigns', 'error');
  }
}

function _cpnCardHtml(c) {
  const brief = (c.brief || '').slice(0, 140);
  return `
    <button class="cpn-card" onclick="playNormalClick(); cpnShowDetail(${c.id})">
      <div class="cpn-card-head">
        <span class="cpn-card-title">${_cpnEscapeHtml(c.name)}</span>
        <span class="${_cpnCampaignStatusBadgeClass(c.status)}">${_cpnEscapeHtml(_cpnFormatStatus(c.status))}</span>
      </div>
      <div class="cpn-card-snippet">${_cpnEscapeHtml(brief)}${c.brief && c.brief.length > 140 ? '…' : ''}</div>
      <div class="cpn-card-meta">${_cpnEscapeHtml(_cpnScopeLabel(c.scope))} · updated ${_cpnEscapeHtml(_cpnFormatDate(c.updated_at))}</div>
    </button>`;
}

// ---- Detail view ----

function cpnBackToList() {
  _cpnShowList();
}

async function cpnShowDetail(id) {
  const listView = document.getElementById('cpn-list-view');
  const detailView = document.getElementById('cpn-detail-view');
  const body = document.getElementById('cpn-detail-body');
  if (!body) return;

  if (listView) listView.classList.add('hidden');
  if (detailView) detailView.classList.remove('hidden');
  body.innerHTML = '<div class="cpn-detail-desc">Loading…</div>';

  try {
    const result = await window.pocketAgent.campaigns.get(id);
    if (!result || !result.campaign) {
      body.innerHTML = '<div class="cpn-detail-desc">Campaign not found.</div>';
      return;
    }
    _cpnCurrentCampaignId = id;

    // Campaign -> attached content -> analytics (best-effort — a campaign
    // with no linked content, or content with no analytics yet, degrades to
    // an empty section rather than blocking the rest of the detail view).
    let analytics = null;
    try {
      analytics = await window.pocketAgent.campaigns.analytics(id);
    } catch (err) {
      console.error('[Campaigns] Failed to load campaign analytics:', err);
    }

    _cpnRenderDetail(result.campaign, result.deliverables || [], analytics);
  } catch (err) {
    console.error('[Campaigns] Failed to load campaign detail:', err);
    body.innerHTML = '<div class="cpn-detail-desc">Failed to load campaign.</div>';
  }
}

function _cpnDeliverableTitle(deliverables, id) {
  const d = deliverables.find((x) => x.id === id);
  return d ? d.title : `#${id}`;
}

function _cpnDeliverableRowHtml(d, deliverables) {
  const depNote = d.depends_on
    ? `<div class="cpn-dlv-dep">depends on: ${_cpnEscapeHtml(_cpnDeliverableTitle(deliverables, d.depends_on))}</div>`
    : '';
  const laneNote = d.lane ? `<span class="badge">${_cpnEscapeHtml(d.lane)}</span>` : '';
  const specialistNote = d.assigned_specialist
    ? `<span class="cpn-dlv-specialist">${_cpnEscapeHtml(d.assigned_specialist)}</span>`
    : '';
  // Content-workflow link (roadmap item 10, requirement 3): when a
  // deliverable's result_ref follows the "content_draft:<id>" convention
  // (src/memory/campaigns.ts's linkDeliverableToContentDraft), make it a
  // click-through into the Content queue panel instead of plain text.
  const contentDraftMatch = d.result_ref ? /^content_draft:(\d+)$/.exec(d.result_ref) : null;
  const resultNote = contentDraftMatch
    ? `<div class="cpn-dlv-result">result: <a href="#" class="cpn-dlv-result-link" onclick="playNormalClick(); cpnOpenContentDraft(event, ${contentDraftMatch[1]})">content draft #${contentDraftMatch[1]}</a></div>`
    : d.result_ref
      ? `<div class="cpn-dlv-result">result: ${_cpnEscapeHtml(d.result_ref)}</div>`
      : '';

  const statusOptions = CPN_DELIVERABLE_STATUSES
    .map((s) => `<option value="${s}" ${s === d.status ? 'selected' : ''}>${_cpnFormatStatus(s)}</option>`)
    .join('');

  return `
    <div class="cpn-dlv-row">
      <div class="cpn-dlv-head">
        <span class="cpn-dlv-title">${_cpnEscapeHtml(d.title)}</span>
        ${laneNote}
        ${specialistNote}
        <span class="${_cpnDeliverableStatusBadgeClass(d.status)}">${_cpnEscapeHtml(_cpnFormatStatus(d.status))}</span>
      </div>
      ${d.description ? `<div class="cpn-dlv-desc">${_cpnEscapeHtml(d.description)}</div>` : ''}
      ${depNote}
      ${resultNote}
      <div class="cpn-dlv-actions">
        <select class="cnt-edit-input cpn-dlv-status-select" id="cpn-dlv-status-${d.id}">
          ${statusOptions}
        </select>
        <button class="btn-shell btn-compact" onclick="playNormalClick(); cpnSetDeliverableStatus(${d.id})">Update</button>
        <button class="btn-shell btn-compact" onclick="playNormalClick(); cpnDeleteDeliverable(${d.id})">Delete</button>
      </div>
    </div>`;
}

// Compact aggregate + per-post analytics for a campaign's linked content
// (campaign -> deliverable.result_ref='content_draft:<id>' -> content_posts
// -> post_analytics, see MemoryManager.getCampaignAnalytics). Mirrors
// analytics-panel.js's summary/card rendering conventions (same stat-total
// language, same per-post line shape) so the numbers read consistently
// whether you're looking at them here or on the Analytics page.
function _cpnAnalyticsSectionHtml(analytics) {
  const posts = (analytics && analytics.posts) || [];
  if (posts.length === 0) {
    return `
      <div class="cpn-prompt-label">Analytics (linked content)</div>
      <div class="cpn-dlv-empty">No analytics recorded yet for this campaign's linked content.</div>`;
  }
  const s = analytics.summary;
  const rate = ((s.engagementRate || 0) * 100).toFixed(2);
  const totals = `
    <div class="cpn-analytics-totals">
      <span><b>${s.totalPosts}</b> posts</span>
      <span><b>${(s.impressions || 0).toLocaleString()}</b> impressions</span>
      <span><b>${(s.likes || 0).toLocaleString()}</b> likes</span>
      <span><b>${(s.comments || 0).toLocaleString()}</b> comments</span>
      <span><b>${(s.shares || 0).toLocaleString()}</b> shares</span>
      <span><b>${rate}%</b> eng. rate</span>
    </div>`;
  const rows = posts.map((p) => {
    const pRate = p.impressions ? (((p.likes + p.comments + p.shares) / p.impressions) * 100).toFixed(2) : '0.00';
    return `
      <div class="cpn-analytics-row">
        <span class="badge">${_cpnEscapeHtml(p.channel)}</span>
        <span class="cpn-analytics-row-title">${_cpnEscapeHtml(p.title || p.external_ref)}</span>
        <span>${p.impressions.toLocaleString()} impr.</span>
        <span>${pRate}% eng.</span>
      </div>`;
  }).join('');
  return `
    <div class="cpn-prompt-label">Analytics (linked content)</div>
    ${totals}
    <div class="cpn-analytics-rows">${rows}</div>`;
}

function _cpnRenderDetail(campaign, deliverables, analytics) {
  const body = document.getElementById('cpn-detail-body');
  if (!body) return;

  const done = deliverables.filter((d) => d.status === 'done').length;
  const progressNote = deliverables.length
    ? `<div class="cpn-detail-note">${done} / ${deliverables.length} deliverables done</div>`
    : '';

  const deliverablesHtml = deliverables.length
    ? deliverables.map((d) => _cpnDeliverableRowHtml(d, deliverables)).join('')
    : '<div class="cpn-dlv-empty">No deliverables yet.</div>';

  const dependsOnOptions = deliverables
    .map((d) => `<option value="${d.id}">${_cpnEscapeHtml(d.title)}</option>`)
    .join('');

  body.innerHTML = `
    <div class="cpn-detail-head">
      <span class="cpn-detail-title">${_cpnEscapeHtml(campaign.name)}</span>
      <span class="${_cpnCampaignStatusBadgeClass(campaign.status)}">${_cpnEscapeHtml(_cpnFormatStatus(campaign.status))}</span>
    </div>
    <div class="cpn-detail-meta">${_cpnEscapeHtml(_cpnScopeLabel(campaign.scope))} · updated ${_cpnEscapeHtml(_cpnFormatDate(campaign.updated_at))}</div>
    ${campaign.brief ? `<div class="cpn-prompt-body">${_cpnEscapeHtml(campaign.brief)}</div>` : ''}
    ${progressNote}
    <div class="cpn-detail-actions">
      <button class="btn-cinamon" onclick="playNormalClick(); cpnNudge(${campaign.id})">Nudge — advance next deliverable</button>
      <select class="cnt-edit-input" id="cpn-campaign-status-select" style="width:auto;">
        ${['active', 'paused', 'completed', 'archived'].map((s) => `<option value="${s}" ${s === campaign.status ? 'selected' : ''}>${_cpnFormatStatus(s)}</option>`).join('')}
      </select>
      <button class="btn-shell" onclick="playNormalClick(); cpnSetCampaignStatus(${campaign.id})">Set status</button>
      <button class="btn-shell" onclick="playNormalClick(); cpnDeleteCampaign(${campaign.id})">Delete campaign</button>
    </div>

    <div class="cpn-prompt-label">Deliverables</div>
    <div class="cpn-deliverables">${deliverablesHtml}</div>

    ${_cpnAnalyticsSectionHtml(analytics)}

    <div class="cpn-prompt-label">Add deliverable</div>
    <input class="cnt-edit-input" id="cpn-new-dlv-title" placeholder="Title" />
    <input class="cnt-edit-input" id="cpn-new-dlv-lane" placeholder="Lane (optional — design, product, brand, social…)" />
    <label class="cnt-edit-label" for="cpn-new-dlv-depends">Depends on (optional)</label>
    <select class="cnt-edit-input" id="cpn-new-dlv-depends">
      <option value="">(none)</option>
      ${dependsOnOptions}
    </select>
    <textarea class="cnt-edit-textarea" id="cpn-new-dlv-desc" rows="3" placeholder="Description (optional)"></textarea>
    <div class="cpn-detail-actions">
      <button class="btn-cinamon" onclick="playNormalClick(); cpnAddDeliverable(${campaign.id})">Add deliverable</button>
    </div>
  `;
}

// ---- Deliverable actions ----

async function cpnSetDeliverableStatus(id) {
  const select = document.getElementById(`cpn-dlv-status-${id}`);
  const status = select ? select.value : null;
  if (!status) return;
  try {
    const res = await window.pocketAgent.campaigns.setDeliverableStatus(id, status);
    if (!res || !res.success) {
      _cpnShowToast((res && res.error) || 'Failed to update status', 'error');
      return;
    }
    _cpnShowToast('Status updated', 'success');
    if (_cpnCurrentCampaignId) await cpnShowDetail(_cpnCurrentCampaignId);
  } catch (err) {
    console.error('[Campaigns] Failed to update deliverable status:', err);
    _cpnShowToast('Failed to update status', 'error');
  }
}

async function cpnDeleteDeliverable(id) {
  if (!confirm('Delete this deliverable? This cannot be undone.')) return;
  try {
    const res = await window.pocketAgent.campaigns.deleteDeliverable(id);
    if (!res || !res.success) {
      _cpnShowToast('Failed to delete deliverable', 'error');
      return;
    }
    _cpnShowToast('Deliverable deleted', 'success');
    if (_cpnCurrentCampaignId) await cpnShowDetail(_cpnCurrentCampaignId);
  } catch (err) {
    console.error('[Campaigns] Failed to delete deliverable:', err);
    _cpnShowToast('Failed to delete deliverable', 'error');
  }
}

async function cpnAddDeliverable(campaignId) {
  const titleEl = document.getElementById('cpn-new-dlv-title');
  const laneEl = document.getElementById('cpn-new-dlv-lane');
  const dependsEl = document.getElementById('cpn-new-dlv-depends');
  const descEl = document.getElementById('cpn-new-dlv-desc');

  const title = titleEl ? titleEl.value.trim() : '';
  const lane = laneEl ? laneEl.value.trim() : '';
  const dependsOn = dependsEl && dependsEl.value ? parseInt(dependsEl.value, 10) : null;
  const description = descEl ? descEl.value.trim() : '';

  if (!title) {
    _cpnShowToast('Title is required', 'error');
    return;
  }

  try {
    const res = await window.pocketAgent.campaigns.addDeliverable({
      campaignId,
      title,
      description: description || undefined,
      lane: lane || null,
      dependsOn,
    });
    if (!res || !res.success) {
      _cpnShowToast((res && res.error) || 'Failed to add deliverable', 'error');
      return;
    }
    _cpnShowToast('Deliverable added', 'success');
    await cpnShowDetail(campaignId);
  } catch (err) {
    console.error('[Campaigns] Failed to add deliverable:', err);
    _cpnShowToast('Failed to add deliverable', 'error');
  }
}

// ---- Campaign actions ----

async function cpnSetCampaignStatus(id) {
  const select = document.getElementById('cpn-campaign-status-select');
  const status = select ? select.value : null;
  if (!status) return;
  try {
    const res = await window.pocketAgent.campaigns.update(id, { status });
    if (!res || !res.success) {
      _cpnShowToast('Failed to update campaign status', 'error');
      return;
    }
    _cpnShowToast('Campaign status updated', 'success');
    await cpnShowDetail(id);
    _cpnLoadCampaigns();
  } catch (err) {
    console.error('[Campaigns] Failed to update campaign status:', err);
    _cpnShowToast('Failed to update campaign status', 'error');
  }
}

async function cpnDeleteCampaign(id) {
  if (!confirm('Delete this campaign and all its deliverables? This cannot be undone.')) return;
  try {
    const res = await window.pocketAgent.campaigns.delete(id);
    if (!res || !res.success) {
      _cpnShowToast('Failed to delete campaign', 'error');
      return;
    }
    _cpnShowToast('Campaign deleted', 'success');
    _cpnShowList();
    _cpnLoadCampaigns();
  } catch (err) {
    console.error('[Campaigns] Failed to delete campaign:', err);
    _cpnShowToast('Failed to delete campaign', 'error');
  }
}

// ---- New campaign ----

function cpnShowNewCampaignForm() {
  const listView = document.getElementById('cpn-list-view');
  const detailView = document.getElementById('cpn-detail-view');
  const body = document.getElementById('cpn-detail-body');
  if (!body) return;

  if (listView) listView.classList.add('hidden');
  if (detailView) detailView.classList.remove('hidden');
  _cpnCurrentCampaignId = null;

  body.innerHTML = `
    <div class="cpn-detail-head"><span class="cpn-detail-title">New campaign</span></div>
    <label class="cnt-edit-label" for="cpn-new-name">Name</label>
    <input class="cnt-edit-input" id="cpn-new-name" placeholder="Q3 launch, rebrand rollout…" />
    <label class="cnt-edit-label" for="cpn-new-brief">Brief (optional)</label>
    <textarea class="cnt-edit-textarea" id="cpn-new-brief" rows="6"></textarea>
    <div class="cpn-detail-actions">
      <button class="btn-cinamon" onclick="playNormalClick(); cpnSaveNewCampaign()">Create campaign</button>
      <button class="btn-shell" onclick="playNormalClick(); cpnBackToList()">Cancel</button>
    </div>
  `;
}

async function cpnSaveNewCampaign() {
  const nameEl = document.getElementById('cpn-new-name');
  const briefEl = document.getElementById('cpn-new-brief');

  const name = nameEl ? nameEl.value.trim() : '';
  const brief = briefEl ? briefEl.value.trim() : '';

  if (!name) {
    _cpnShowToast('Name is required', 'error');
    return;
  }

  try {
    const res = await window.pocketAgent.campaigns.create({ name, brief: brief || undefined }, _cpnContext());
    if (!res || !res.success) {
      _cpnShowToast((res && res.error) || 'Failed to create campaign', 'error');
      return;
    }
    _cpnShowToast('Campaign created', 'success');
    _cpnLoadCampaigns();
    await cpnShowDetail(res.id);
  } catch (err) {
    console.error('[Campaigns] Failed to create campaign:', err);
    _cpnShowToast('Failed to create campaign', 'error');
  }
}

// ---- Content workflow link ----

// Jump from a deliverable's "content_draft:<id>" result_ref straight into
// that draft's detail view in the Content queue panel (roadmap item 10,
// requirement 3 — content-panel.js owns the drafts themselves; this just
// switches panels and reuses its cntShowDetail).
async function cpnOpenContentDraft(event, draftId) {
  if (event) event.preventDefault();
  hideCampaignsPanel();
  if (typeof showContentPanel === 'function') showContentPanel();
  if (typeof cntShowDetail === 'function') await cntShowDetail(draftId);
}

// ---- Nudge ----
//
// Pragmatic path (no auto-dispatch): resolve the next unblocked deliverable
// server-side (src/main/ipc/campaign-ipc.ts's campaigns:nudgePrompt), leave
// the campaign board, and prefill the current chat's composer with the
// resolved prompt — same "prefill, don't send" pattern as agents-panel.js's
// "Call this agent" action. The human reviews/edits before sending.
async function cpnNudge(campaignId) {
  try {
    const res = await window.pocketAgent.campaigns.nudgePrompt(campaignId);
    if (!res || !res.success) {
      _cpnShowToast((res && res.error) || 'Nothing to advance', 'error');
      return;
    }

    hideCampaignsPanel();
    if (typeof returnToChatView === 'function') returnToChatView();

    if (typeof input !== 'undefined' && input) {
      input.value = res.prompt;
      input.focus();
      if (typeof input.setSelectionRange === 'function') {
        input.setSelectionRange(input.value.length, input.value.length);
      }
      if (typeof autoResizeTextarea === 'function') autoResizeTextarea();
    }
    _cpnShowToast('Prompt ready — review and send', 'success');
  } catch (err) {
    console.error('[Campaigns] Failed to resolve nudge prompt:', err);
    _cpnShowToast('Failed to resolve next deliverable', 'error');
  }
}
