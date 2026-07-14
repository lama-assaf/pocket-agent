/* Analytics Panel — embedded in chat.html. Per-post X/LinkedIn/etc.
   performance: overall metrics, per-post drill-down, filtered by client and
   channel. Follows content-panel.js's conventions (list/detail views,
   _dismissOtherPanels, scope-label helpers, toast, manual "record a
   snapshot" form) — the same UI shape as the Content Queue, since analytics
   rows are scoped the same way content drafts are.

   Degrades gracefully with zero configuration: an empty Analytics store
   (no manual entries, no MCP connected) renders the empty state below, never
   an error — see analytics-optimizer skill's "degrading gracefully" section
   for the agent-side equivalent of this same contract. */

let _antNotyf = null;
let _antRows = []; // cached latest-per-post rows from the last load
let _antCurrentChannelFilter = null; // null = all channels
let _antClientsCache = null;
let _antProjectsCache = {};

// ---- Show / Hide ----

function showAnalyticsPanel() {
  const chatView = document.getElementById('chat-view');
  const analyticsView = document.getElementById('analytics-view');
  if (!analyticsView) return;

  _dismissOtherPanels('analytics-view');

  chatView.classList.add('hidden');
  analyticsView.classList.add('active');
  if (window._sidebarEnterPanelMode) window._sidebarEnterPanelMode();

  const sidebarBtn = document.getElementById('sidebar-analytics-btn');
  if (sidebarBtn) sidebarBtn.classList.add('active');

  _antShowList();
  _antLoadAll();
}

function hideAnalyticsPanel() {
  const chatView = document.getElementById('chat-view');
  const analyticsView = document.getElementById('analytics-view');
  if (!analyticsView) return;

  analyticsView.classList.remove('active');
  chatView.classList.remove('hidden');
  if (window._sidebarExitPanelMode) window._sidebarExitPanelMode();

  const sidebarBtn = document.getElementById('sidebar-analytics-btn');
  if (sidebarBtn) sidebarBtn.classList.remove('active');
}

function toggleAnalyticsPanel() {
  const analyticsView = document.getElementById('analytics-view');
  if (analyticsView && analyticsView.classList.contains('active')) {
    hideAnalyticsPanel();
  } else {
    showAnalyticsPanel();
  }
}

function antRefresh() {
  _antLoadAll();
  _antShowToast('Refreshed', 'success');
}

// ---- Toast ----

function _antShowToast(message, type) {
  if (!_antNotyf) {
    _antNotyf = new Notyf({
      duration: 3000, position: { x: 'right', y: 'bottom' },
      dismissible: true,
      types: [
        { type: 'success', background: '#4ade80' },
        { type: 'error', background: '#f87171' }
      ]
    });
  }
  _antNotyf[type === 'error' ? 'error' : 'success'](window.cleanToastMessage ? window.cleanToastMessage(message) : message);
}

// ---- Helpers ----

function _antEscapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// The active workspace context — same shape as content-panel.js's _cntContext.
function _antContext() {
  if (typeof getActiveWorkspace === 'function') return getActiveWorkspace();
  return { contextType: 'personal', clientId: null, projectKey: null };
}

async function _antEnsureScopeLabelData() {
  if (!_antClientsCache) {
    try {
      _antClientsCache = (await window.pocketAgent.clients.list()) || [];
    } catch (_) {
      _antClientsCache = [];
    }
  }
  const ctx = _antContext();
  if (ctx.clientId && !_antProjectsCache[ctx.clientId]) {
    try {
      _antProjectsCache[ctx.clientId] = (await window.pocketAgent.projects.list(ctx.clientId)) || [];
    } catch (_) {
      _antProjectsCache[ctx.clientId] = [];
    }
  }
}

function _antScopeLabel(scope) {
  if (!scope) return '';
  if (scope === 'world') return 'Agency-wide';
  if (scope === 'user') return 'Personal';
  if (scope.startsWith('client:')) {
    const id = scope.slice('client:'.length);
    const client = (_antClientsCache || []).find((c) => c.id === id);
    return client ? client.name : id;
  }
  if (scope.startsWith('project:')) {
    const id = scope.slice('project:'.length);
    for (const projects of Object.values(_antProjectsCache)) {
      const project = (projects || []).find((p) => p.id === id);
      if (project) return project.name;
    }
    return id;
  }
  return scope;
}

function _antFormatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString();
  } catch (_) {
    return iso;
  }
}

function _antFormatNumber(n) {
  return (n || 0).toLocaleString();
}

function _antFormatRate(rate) {
  return `${((rate || 0) * 100).toFixed(2)}%`;
}

function _antChannelBadgeClass(channel) {
  const c = (channel || '').toLowerCase();
  if (c.includes('twitter') || c === 'x') return 'ant-badge ant-badge--x';
  if (c.includes('linkedin')) return 'ant-badge ant-badge--linkedin';
  return 'ant-badge';
}

// ---- Channel filter ----

function antSetChannelFilter(channel) {
  _antCurrentChannelFilter = channel || null;
  document.querySelectorAll('.ant-filter-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.channel === (channel || ''));
  });
  _antLoadAll();
}

// ---- Load (summary + per-post list together) ----

function _antShowList() {
  const listView = document.getElementById('ant-list-view');
  const detailView = document.getElementById('ant-detail-view');
  if (listView) listView.classList.remove('hidden');
  if (detailView) detailView.classList.add('hidden');
}

async function _antLoadAll() {
  await _antEnsureScopeLabelData();
  await Promise.all([_antLoadSummary(), _antLoadPosts()]);
}

async function _antLoadSummary() {
  const summaryEl = document.getElementById('ant-summary');
  if (!summaryEl) return;

  try {
    const summary = await window.pocketAgent.analytics.summary(_antContext(), _antCurrentChannelFilter || undefined);
    if (!summary || summary.totalPosts === 0) {
      summaryEl.innerHTML = '';
      return;
    }

    const channelCards = Object.entries(summary.byChannel || {})
      .map(([channel, c]) => `
        <div class="ant-summary-card">
          <div class="ant-summary-card-head">
            <span class="${_antChannelBadgeClass(channel)}">${_antEscapeHtml(channel)}</span>
            <span class="ant-summary-card-posts">${c.posts} post${c.posts === 1 ? '' : 's'}</span>
          </div>
          <div class="ant-summary-stat-row">
            <span class="ant-summary-stat"><b>${_antFormatNumber(c.impressions)}</b> impressions</span>
            <span class="ant-summary-stat"><b>${_antFormatRate(c.engagementRate)}</b> eng. rate</span>
          </div>
        </div>
      `).join('');

    summaryEl.innerHTML = `
      <div class="ant-summary-totals">
        <div class="ant-summary-total"><span class="ant-summary-total-val">${summary.totalPosts}</span><span class="ant-summary-total-label">Posts</span></div>
        <div class="ant-summary-total"><span class="ant-summary-total-val">${_antFormatNumber(summary.impressions)}</span><span class="ant-summary-total-label">Impressions</span></div>
        <div class="ant-summary-total"><span class="ant-summary-total-val">${_antFormatNumber(summary.likes)}</span><span class="ant-summary-total-label">Likes</span></div>
        <div class="ant-summary-total"><span class="ant-summary-total-val">${_antFormatNumber(summary.comments)}</span><span class="ant-summary-total-label">Comments</span></div>
        <div class="ant-summary-total"><span class="ant-summary-total-val">${_antFormatNumber(summary.shares)}</span><span class="ant-summary-total-label">Shares</span></div>
        <div class="ant-summary-total"><span class="ant-summary-total-val">${_antFormatNumber(summary.clicks)}</span><span class="ant-summary-total-label">Clicks</span></div>
        <div class="ant-summary-total"><span class="ant-summary-total-val">${_antFormatRate(summary.engagementRate)}</span><span class="ant-summary-total-label">Eng. rate</span></div>
      </div>
      ${channelCards ? `<div class="ant-summary-channels">${channelCards}</div>` : ''}
    `;
  } catch (err) {
    console.error('[Analytics] Failed to load summary:', err);
  }
}

async function _antLoadPosts() {
  const listEl = document.getElementById('ant-posts');
  const emptyEl = document.getElementById('ant-empty');
  const countEl = document.getElementById('ant-active-count');
  if (!listEl) return;

  try {
    const rows = await window.pocketAgent.analytics.list(_antContext(), _antCurrentChannelFilter || undefined);
    _antRows = rows || [];
    if (countEl) countEl.textContent = `(${_antRows.length})`;

    if (_antRows.length === 0) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');

    listEl.innerHTML = _antRows.map(_antCardHtml).join('');
  } catch (err) {
    console.error('[Analytics] Failed to load posts:', err);
    _antShowToast('Failed to load analytics', 'error');
  }
}

function _antCardHtml(r) {
  const rate = (r.impressions ? (r.likes + r.comments + r.shares) / r.impressions : 0);
  return `
    <button class="ant-card" onclick="playNormalClick(); antShowDetail(${r.id})">
      <div class="ant-card-head">
        <span class="ant-card-title">${_antEscapeHtml(r.title || r.external_ref)}</span>
        <span class="${_antChannelBadgeClass(r.channel)}">${_antEscapeHtml(r.channel)}</span>
        ${r.source === 'manual' ? '<span class="ant-source-tag" title="Entered by hand">manual</span>' : '<span class="ant-source-tag ant-source-tag--mcp" title="Fetched via a connected MCP server">live</span>'}
      </div>
      <div class="ant-card-stats">
        <span>${_antFormatNumber(r.impressions)} impressions</span>
        <span>${_antFormatNumber(r.likes)} likes</span>
        <span>${_antFormatNumber(r.comments)} comments</span>
        <span>${_antFormatNumber(r.shares)} shares</span>
        <span class="ant-card-rate">${_antFormatRate(rate)} eng.</span>
      </div>
      <div class="ant-card-meta">${_antEscapeHtml(_antScopeLabel(r.scope))} · captured ${_antEscapeHtml(_antFormatDate(r.captured_at))}</div>
    </button>`;
}

// ---- Detail view (per-post drill-down + snapshot history) ----

function antBackToList() {
  _antShowList();
}

async function antShowDetail(id) {
  const listView = document.getElementById('ant-list-view');
  const detailView = document.getElementById('ant-detail-view');
  const body = document.getElementById('ant-detail-body');
  if (!body) return;

  const row = _antRows.find((r) => r.id === id);
  if (!row) return;

  if (listView) listView.classList.add('hidden');
  if (detailView) detailView.classList.remove('hidden');
  body.innerHTML = '<div class="ant-detail-desc">Loading…</div>';

  let history = [];
  try {
    history = (await window.pocketAgent.analytics.history(row.scope, row.channel, row.external_ref)) || [];
  } catch (_) {
    history = [row];
  }

  const rate = (row.impressions ? (row.likes + row.comments + row.shares) / row.impressions : 0);
  const clickRate = (row.impressions ? row.clicks / row.impressions : 0);

  const historyHtml = history.length > 1
    ? `
      <div class="ant-prompt-label">Snapshot history</div>
      <div class="ant-history-list">
        ${history.map((h) => `
          <div class="ant-history-row">
            <span class="ant-history-date">${_antEscapeHtml(_antFormatDate(h.captured_at))}</span>
            <span>${_antFormatNumber(h.impressions)} impr.</span>
            <span>${_antFormatNumber(h.likes)} likes</span>
            <span>${_antFormatNumber(h.comments)} comments</span>
            <span>${_antFormatNumber(h.shares)} shares</span>
          </div>
        `).join('')}
      </div>`
    : '';

  body.innerHTML = `
    <div class="ant-detail-head">
      <span class="ant-detail-title">${_antEscapeHtml(row.title || row.external_ref)}</span>
      <span class="${_antChannelBadgeClass(row.channel)}">${_antEscapeHtml(row.channel)}</span>
    </div>
    <div class="ant-detail-meta">${_antEscapeHtml(_antScopeLabel(row.scope))} · captured ${_antEscapeHtml(_antFormatDate(row.captured_at))} · ${row.source === 'manual' ? 'manually entered' : 'from connected MCP'}</div>
    <div class="ant-detail-stats">
      <div class="ant-detail-stat"><span class="ant-detail-stat-val">${_antFormatNumber(row.impressions)}</span><span class="ant-detail-stat-label">Impressions</span></div>
      <div class="ant-detail-stat"><span class="ant-detail-stat-val">${_antFormatNumber(row.likes)}</span><span class="ant-detail-stat-label">Likes</span></div>
      <div class="ant-detail-stat"><span class="ant-detail-stat-val">${_antFormatNumber(row.comments)}</span><span class="ant-detail-stat-label">Comments</span></div>
      <div class="ant-detail-stat"><span class="ant-detail-stat-val">${_antFormatNumber(row.shares)}</span><span class="ant-detail-stat-label">Shares</span></div>
      <div class="ant-detail-stat"><span class="ant-detail-stat-val">${_antFormatNumber(row.clicks)}</span><span class="ant-detail-stat-label">Clicks</span></div>
      <div class="ant-detail-stat"><span class="ant-detail-stat-val">${_antFormatNumber(row.video_views)}</span><span class="ant-detail-stat-label">Video views</span></div>
      <div class="ant-detail-stat"><span class="ant-detail-stat-val">${_antFormatRate(rate)}</span><span class="ant-detail-stat-label">Engagement rate</span></div>
      <div class="ant-detail-stat"><span class="ant-detail-stat-val">${_antFormatRate(clickRate)}</span><span class="ant-detail-stat-label">Click rate</span></div>
    </div>
    <div class="ant-detail-actions">
      <button class="btn-shell" onclick="playNormalClick(); antDeleteRow(${row.id})">Delete</button>
    </div>
    ${historyHtml}
  `;
}

async function antDeleteRow(id) {
  if (!confirm('Delete this analytics snapshot? This cannot be undone.')) return;
  try {
    const res = await window.pocketAgent.analytics.delete(id);
    if (!res || !res.success) {
      _antShowToast('Failed to delete', 'error');
      return;
    }
    _antShowToast('Deleted', 'success');
    _antShowList();
    _antLoadAll();
  } catch (err) {
    console.error('[Analytics] Failed to delete row:', err);
    _antShowToast('Failed to delete', 'error');
  }
}

// ---- Record a new snapshot (manual entry — the zero-config default path) ----

function antShowRecordForm() {
  const listView = document.getElementById('ant-list-view');
  const detailView = document.getElementById('ant-detail-view');
  const body = document.getElementById('ant-detail-body');
  if (!body) return;

  if (listView) listView.classList.add('hidden');
  if (detailView) detailView.classList.remove('hidden');

  body.innerHTML = `
    <div class="ant-detail-head"><span class="ant-detail-title">Record a snapshot</span></div>
    <div class="ant-detail-note">Paste numbers straight from X/LinkedIn's own analytics dashboard — no API key needed.</div>
    <label class="ant-edit-label" for="ant-new-channel">Channel</label>
    <input class="ant-edit-input" id="ant-new-channel" placeholder="twitter, linkedin…" />
    <label class="ant-edit-label" for="ant-new-ref">Post URL / ID</label>
    <input class="ant-edit-input" id="ant-new-ref" placeholder="https://x.com/you/status/…" />
    <label class="ant-edit-label" for="ant-new-title">Title (optional)</label>
    <input class="ant-edit-input" id="ant-new-title" />
    <div class="ant-edit-grid">
      <div><label class="ant-edit-label" for="ant-new-impressions">Impressions</label><input class="ant-edit-input" type="number" min="0" id="ant-new-impressions" /></div>
      <div><label class="ant-edit-label" for="ant-new-likes">Likes</label><input class="ant-edit-input" type="number" min="0" id="ant-new-likes" /></div>
      <div><label class="ant-edit-label" for="ant-new-comments">Comments</label><input class="ant-edit-input" type="number" min="0" id="ant-new-comments" /></div>
      <div><label class="ant-edit-label" for="ant-new-shares">Shares</label><input class="ant-edit-input" type="number" min="0" id="ant-new-shares" /></div>
      <div><label class="ant-edit-label" for="ant-new-clicks">Clicks</label><input class="ant-edit-input" type="number" min="0" id="ant-new-clicks" /></div>
      <div><label class="ant-edit-label" for="ant-new-video-views">Video views</label><input class="ant-edit-input" type="number" min="0" id="ant-new-video-views" /></div>
    </div>
    <div class="ant-detail-actions">
      <button class="btn-cinamon" onclick="playNormalClick(); antSaveRecordForm()">Save snapshot</button>
      <button class="btn-shell" onclick="playNormalClick(); antBackToList()">Cancel</button>
    </div>
  `;
}

async function antSaveRecordForm() {
  const val = (id) => {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  };
  const num = (id) => {
    const el = document.getElementById(id);
    const n = el ? parseInt(el.value, 10) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  const channel = val('ant-new-channel');
  const externalRef = val('ant-new-ref');
  const title = val('ant-new-title');

  if (!channel || !externalRef) {
    _antShowToast('Channel and post URL/ID are required', 'error');
    return;
  }

  try {
    const res = await window.pocketAgent.analytics.record({
      channel,
      externalRef,
      title,
      impressions: num('ant-new-impressions'),
      likes: num('ant-new-likes'),
      comments: num('ant-new-comments'),
      shares: num('ant-new-shares'),
      clicks: num('ant-new-clicks'),
      videoViews: num('ant-new-video-views'),
      source: 'manual',
    }, _antContext());
    if (!res || !res.success) {
      _antShowToast((res && res.error) || 'Failed to save snapshot', 'error');
      return;
    }
    _antShowToast('Snapshot saved', 'success');
    _antShowList();
    _antLoadAll();
  } catch (err) {
    console.error('[Analytics] Failed to save snapshot:', err);
    _antShowToast('Failed to save snapshot', 'error');
  }
}
