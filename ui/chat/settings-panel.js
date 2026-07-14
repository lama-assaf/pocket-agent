/* Return to chat view — dismiss all panels and exit global chat */
function returnToChatView() {
  _dismissOtherPanels(null);
  const chatView = document.getElementById('chat-view');
  if (chatView) chatView.classList.remove('hidden');
  // Exit global chat if active
  if (typeof globalChatMode !== 'undefined' && globalChatMode) {
    toggleGlobalChat();
  }
}

/* Shared panel helper — dismiss other panels */
function _dismissOtherPanels(keepId) {
  const panels = {
    'settings-view': 'sidebar-settings-btn',
    'brain-view': 'sidebar-brain-btn',
    'agents-view': 'sidebar-agents-btn',
    'content-view': 'sidebar-content-btn',
    'campaigns-view': 'sidebar-campaigns-btn',
    'analytics-view': 'sidebar-analytics-btn',
    'routines-view': 'sidebar-routines-btn',
    'personalize-view': 'sidebar-personalize-btn',
    'clients-view': 'active-client-header',
  };
  for (const [viewId, btnId] of Object.entries(panels)) {
    if (viewId === keepId) continue;
    const v = document.getElementById(viewId);
    if (v && v.classList.contains('active')) {
      v.classList.remove('active');
      const btn = document.getElementById(btnId);
      if (btn) btn.classList.remove('active');
    }
  }
}

/* Settings Panel — embedded in chat.html */

let _stgInitialized = false;
let _stgSettings = {};
let _stgNotyf = null;
let _stgUpdateStatusCleanup = null;
let _stgPocketCliInstalledVersion = null;
let _stgCurrentSkinId = 'default';
let _stgThemesCache = null;

const _stgRoot = () => document.getElementById('settings-view');

// ---- Show / Hide ----

function showSettingsPanel(tab) {
  const chatView = document.getElementById('chat-view');
  const settingsView = document.getElementById('settings-view');
  const brainView = document.getElementById('brain-view');
  if (!settingsView) return;

  // Hide other panels if open
  _dismissOtherPanels('settings-view');

  chatView.classList.add('hidden');
  settingsView.classList.add('active');
  if (window._sidebarEnterPanelMode) window._sidebarEnterPanelMode();

  // Mark sidebar button active
  const sidebarBtn = document.getElementById('sidebar-settings-btn');
  if (sidebarBtn) sidebarBtn.classList.add('active');

  if (!_stgInitialized) {
    _initSettingsPanel();
    _stgInitialized = true;
  }

  if (tab) _stgNavigateToSection(tab);
}

function hideSettingsPanel() {
  const chatView = document.getElementById('chat-view');
  const settingsView = document.getElementById('settings-view');
  if (!settingsView) return;

  settingsView.classList.remove('active');
  chatView.classList.remove('hidden');
  if (window._sidebarExitPanelMode) window._sidebarExitPanelMode();

  // Unmark sidebar button
  const sidebarBtn = document.getElementById('sidebar-settings-btn');
  if (sidebarBtn) sidebarBtn.classList.remove('active');
}

function toggleSettingsPanel() {
  const settingsView = document.getElementById('settings-view');
  if (settingsView && settingsView.classList.contains('active')) {
    hideSettingsPanel();
  } else {
    showSettingsPanel();
  }
}

// ---- Toast ----

function _stgShowToast(message, type) {
  if (!_stgNotyf) {
    _stgNotyf = new Notyf({
      duration: 3000, position: { x: 'right', y: 'bottom' },
      dismissible: true,
      types: [
        { type: 'success', background: '#4ade80' },
        { type: 'error', background: '#f87171' }
      ]
    });
  }
  _stgNotyf[type === 'error' ? 'error' : 'success'](window.cleanToastMessage ? window.cleanToastMessage(message) : message);
}

// ---- Initialization ----

function _initSettingsPanel() {
  const root = _stgRoot();
  if (!root) return;

  // Handle external links
  root.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (link && link.href && (link.target === '_blank' || link.href.startsWith('http'))) {
      e.preventDefault();
      window.pocketAgent.app.openExternal(link.href);
    }
  });

  _stgLoadSettings().then(() => {
    _stgLoadAppVersion();
    _stgSetupNavigation();
    _stgSetupAutoSave();
    _stgRefreshModelDropdown();
    _stgInitializeBrowserSection();
    _stgInitMcpSection();
    _stgInitPocketCli();
    _stgInitSkinPicker();
    _stgInitializeUpdates();
    _stgLoadLinkedInRedirectUri();
  });

  // Listen for auth expiry events from the main process
  window.pocketAgent.auth.onExpired(() => {
    _stgLoadSettings();
  });
}

async function _stgLoadAppVersion() {
  try {
    const version = await window.pocketAgent.app.getVersion();
    const el = document.getElementById('current-version');
    if (el) el.textContent = `v${version}`;
  } catch (err) {
    console.error('[Settings] Failed to load app version:', err);
  }
}

async function _stgLoadSettings() {
  try {
    _stgSettings = await window.pocketAgent.settings.getAll();
    _stgPopulateFields();
    _stgUpdateToggles();
    _stgUpdateAuthStatus();
    _stgUpdateOpenAIAuthStatus();
    _stgUpdateKimiAuthStatus();
    _stgUpdateLinkedInAuthStatus();
    _stgUpdateDeleteButtons();
  } catch (err) {
    console.error('[Settings] Failed to load settings:', err);
    _stgShowToast('Hmm, couldn\'t grab settings', 'error');
  }
}

async function _stgRefreshModelDropdown() {
  try {
    const models = await window.pocketAgent.settings.getAvailableModels();
    const dropdown = document.getElementById('agent.model');
    if (!dropdown) return;
    const savedModel = _stgSettings['agent.model'] || await window.pocketAgent.settings.get('agent.model');

    dropdown.innerHTML = '';

    if (models.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Add API key to enable models';
      option.disabled = true;
      dropdown.appendChild(option);
      return;
    }

    const groups = { anthropic: 'Anthropic', moonshot: 'Kimi (Moonshot)', glm: 'GLM (Z.AI)' };
    for (const [provider, label] of Object.entries(groups)) {
      const providerModels = models.filter(m => m.provider === provider);
      if (providerModels.length > 0) {
        const group = document.createElement('optgroup');
        group.label = label;
        for (const model of providerModels) {
          const option = document.createElement('option');
          option.value = model.id;
          option.textContent = model.name;
          group.appendChild(option);
        }
        dropdown.appendChild(group);
      }
    }

    const isValidSelection = models.some(m => m.id === savedModel);
    if (isValidSelection) {
      dropdown.value = savedModel;
    } else if (models.length > 0) {
      dropdown.value = models[0].id;
      await window.pocketAgent.settings.set('agent.model', models[0].id);
    }
  } catch (err) {
    console.error('[Settings] Failed to refresh model dropdown:', err);
  }
}

function _stgPopulateFields() {
  const root = _stgRoot();
  if (!root) return;
  const inputs = root.querySelectorAll('input, select');
  for (const input of inputs) {
    const key = input.id;
    if (_stgSettings[key] !== undefined) {
      if (input.type === 'checkbox') {
        input.checked = _stgSettings[key] === 'true';
      } else {
        let value = _stgSettings[key];
        if (value === '[]') value = '';
        if (input.type === 'password') {
          // Remember the field's original placeholder once so we can restore it
          // when the key is removed (otherwise the "key saved" hint sticks).
          if (input.dataset.basePlaceholder === undefined) {
            input.dataset.basePlaceholder = input.placeholder || '';
          }
          if (value === '••••••••') {
            input.placeholder = '••••••••  (key saved)';
            input.value = '';
            continue;
          }
          // No stored key — show the original placeholder, empty field.
          input.placeholder = input.dataset.basePlaceholder;
        }
        input.value = value;
      }
    }
  }
}

function _stgUpdateToggles() {
  const toggleMap = {
    'telegram.enabled': { toggle: 'telegram.enabled-toggle', config: 'telegram-config' },
    'browser.enabled': { toggle: 'browser.enabled-toggle', config: 'browser-config' },
    'browser.useMyBrowser': { toggle: 'browser.useMyBrowser-toggle' },
    'pocketCli.autoCheck': { toggle: 'pocketCli.autoCheck-toggle', defaultTrue: true },
    'updates.autoCheck': { toggle: 'updates.autoCheck-toggle', defaultTrue: true },
  };

  for (const [key, cfg] of Object.entries(toggleMap)) {
    const toggleEl = document.getElementById(cfg.toggle);
    if (!toggleEl) continue;
    const enabled = cfg.defaultTrue
      ? _stgSettings[key] !== 'false'
      : _stgSettings[key] === 'true';
    toggleEl.classList.toggle('active', enabled);
    if (cfg.config) {
      const configEl = document.getElementById(cfg.config);
      if (configEl) configEl.classList.toggle('disabled-section', !enabled);
    }
  }
}

function _stgSetupNavigation() {
  const root = _stgRoot();
  if (!root) return;
  const navItems = root.querySelectorAll('.settings-nav-item');
  const sections = root.querySelectorAll('.settings-section');

  navItems.forEach((item, index) => {
    item.classList.toggle('active', index === 0);
  });
  sections.forEach((section, index) => {
    section.classList.toggle('active', index === 0);
  });

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      _stgNavigateToSection(item.dataset.section);
    });
  });

  if (window.pocketAgent?.events?.onModelChanged) {
    window.pocketAgent.events.onModelChanged(() => _stgRefreshModelDropdown());
  }
}

function _stgNavigateToSection(sectionId) {
  const root = _stgRoot();
  if (!root) return;
  const navItems = root.querySelectorAll('.settings-nav-item');
  const sections = root.querySelectorAll('.settings-section');
  const targetNav = root.querySelector(`.settings-nav-item[data-section="${sectionId}"]`);
  const targetSection = document.getElementById(sectionId);

  if (targetNav && targetSection) {
    navItems.forEach(n => n.classList.remove('active'));
    targetNav.classList.add('active');
    sections.forEach(s => s.classList.remove('active'));
    targetSection.classList.add('active');
  }

}

function _stgSetupAutoSave() {
  const root = _stgRoot();
  if (!root) return;
  const excludedIds = [
    'anthropic.apiKey', 'openai.apiKey', 'moonshot.apiKey', 'glm.apiKey',
    'auth-api-key', 'oauth-code',
    'telegram.botToken', 'telegram.allowedUserIds', 'telegram.defaultChatId',
    'chat.adminKey',
    'linkedin.clientId', 'linkedin.clientSecret',
  ];

  const inputs = root.querySelectorAll('input, select');

  inputs.forEach(input => {
    if (excludedIds.includes(input.id)) return;

    input.addEventListener('change', async () => {
      const key = input.id;
      const value = input.type === 'checkbox' ? input.checked.toString() : input.value;
      const oldValue = _stgSettings[key];
      _stgSettings[key] = value;

      try {
        await window.pocketAgent.settings.set(key, value);
        _stgShowToast('Got it', 'success');
        const rebootSettings = ['agent.model', 'telegram.allowedUserIds', 'telegram.botToken'];
        if (rebootSettings.includes(key)) _stgActivateReboot();
      } catch (err) {
        _stgSettings[key] = oldValue;
        console.error('[Settings] Failed to save setting:', err);
        _stgShowToast('Oops, couldn\'t save that', 'error');
      }
    });
  });
}

// ---- Key Validation ----

const _stgKeyValidators = {
  'anthropic.apiKey': { pattern: /^sk-ant-[A-Za-z0-9_-]{90,}$/, hint: 'Anthropic keys start with "sk-ant-"' },
  'openai.apiKey': { pattern: /^sk-[A-Za-z0-9_-]{40,}$/, hint: 'OpenAI keys start with "sk-"' },
  'moonshot.apiKey': { pattern: /^sk-[A-Za-z0-9_-]{40,}$/, hint: 'Moonshot keys start with "sk-"' },
  'glm.apiKey': { pattern: /^.{10,}$/, hint: 'Enter your Z.AI API key' },
  'xiaomi.apiKey': { pattern: /^.{10,}$/, hint: 'Enter your Xiaomi API key' },
  'minimax.apiKey': { pattern: /^.{10,}$/, hint: 'Enter your MiniMax API key' },
  'deepseek.apiKey': { pattern: /^.{10,}$/, hint: 'Enter your DeepSeek API key' },
  'telegram.botToken': { pattern: /^\d{6,}:[A-Za-z0-9_-]{30,}$/, hint: 'Telegram tokens are in format "123456789:ABC..."' }
};

function _stgValidateKeyFormat(inputId, key) {
  const validator = _stgKeyValidators[inputId];
  if (!validator) return { valid: true };
  if (!validator.pattern.test(key)) return { valid: false, error: validator.hint };
  return { valid: true };
}

// These functions are called from inline onclick handlers in the HTML
// They must be global

async function stgSaveKey(inputId) {
  const input = document.getElementById(inputId);
  const key = input.value.trim();
  if (!key) { _stgShowToast('Need a key first', 'error'); return; }
  const validation = _stgValidateKeyFormat(inputId, key);
  if (!validation.valid) { _stgShowToast(validation.error, 'error'); return; }
  try {
    await window.pocketAgent.settings.set(inputId, key);
    _stgSettings[inputId] = key;
    _stgShowToast('Got it', 'success');
    const deleteBtn = document.getElementById(`${inputId}-delete`);
    if (deleteBtn) deleteBtn.classList.add('visible');
    // Provider API keys auto-restart the agent in the main process (see
    // PROVIDER_CREDENTIAL_KEYS in src/main/ipc/settings-ipc.ts), so the
    // user doesn't need a reboot prompt for those. Telegram still does.
    const rebootKeys = ['telegram.botToken'];
    if (rebootKeys.includes(inputId)) _stgActivateReboot();
  } catch (err) {
    console.error('[Settings] Failed to save key:', err);
    _stgShowToast('Save hiccup, try again?', 'error');
  }
}

function _stgUpdateDeleteButtons() {
  const keyIds = ['anthropic.apiKey', 'openai.apiKey', 'moonshot.apiKey', 'glm.apiKey', 'xiaomi.apiKey', 'minimax.apiKey', 'deepseek.apiKey', 'telegram.botToken', 'linkedin.clientSecret'];
  for (const keyId of keyIds) {
    const deleteBtn = document.getElementById(`${keyId}-delete`);
    if (deleteBtn) {
      const hasKey = _stgSettings[keyId] && _stgSettings[keyId].trim() !== '';
      deleteBtn.classList.toggle('visible', hasKey);
    }
  }
  const authDeleteBtn = document.getElementById('auth-api-key-delete');
  if (authDeleteBtn) {
    const hasKey = _stgSettings['anthropic.apiKey'] && _stgSettings['anthropic.apiKey'].trim() !== '';
    authDeleteBtn.classList.toggle('visible', hasKey);
  }
}

async function stgDeleteKey(keyId, inputId) {
  const actualInputId = inputId || keyId;
  try {
    await window.pocketAgent.settings.set(keyId, '');
    _stgSettings[keyId] = '';
    const input = document.getElementById(actualInputId);
    if (input) {
      input.value = '';
      // Restore the original placeholder so the field no longer reads "key saved".
      if (input.dataset.basePlaceholder !== undefined) {
        input.placeholder = input.dataset.basePlaceholder;
      }
    }
    const deleteBtn = document.getElementById(`${actualInputId}-delete`);
    if (deleteBtn) deleteBtn.classList.remove('visible');
    _stgShowToast('Key removed', 'success');
    _stgActivateReboot();
    if (keyId === 'anthropic.apiKey') _stgUpdateAuthStatus();
  } catch (err) {
    console.error('[Settings] Failed to delete key:', err);
    _stgShowToast('Oops, couldn\'t delete that', 'error');
  }
}

async function stgToggleSetting(key) {
  const currentValue = _stgSettings[key] === 'true';
  const newValue = (!currentValue).toString();
  try {
    await window.pocketAgent.settings.set(key, newValue);
    _stgSettings[key] = newValue;
    _stgUpdateToggles();
    _stgShowToast('Got it', 'success');
  } catch (err) {
    console.error('[Settings] Failed to toggle setting:', err);
    _stgShowToast('Oops, couldn\'t save that', 'error');
  }
}

async function stgValidateKey(provider) {
  const inputId = provider === 'telegram' ? 'telegram.botToken' : `${provider}.apiKey`;
  const input = document.getElementById(inputId);
  const button = input.parentElement.querySelector('button:not(.delete-btn)');
  const key = input.value.trim();

  // If input is empty but a key is already saved, validate via backend
  if (!key && _stgSettings[inputId] === '••••••••') {
    button.classList.add('validating');
    button.textContent = 'Testing...';
    try {
      const result = await window.pocketAgent.validate.storedKey(provider);
      if (result.valid) {
        _stgShowToast('All good', 'success');
      } else {
        _stgShowToast(result.error || 'That key didn\'t work', 'error');
      }
    } catch (err) {
      _stgShowToast('Validation failed: ' + err.message, 'error');
    }
    _stgResetTestButton(button);
    return;
  }

  if (!key) { _stgShowToast('Key please', 'error'); return; }
  const formatValidation = _stgValidateKeyFormat(inputId, key);
  if (!formatValidation.valid) { _stgShowToast(formatValidation.error, 'error'); return; }

  button.classList.add('validating');
  button.textContent = 'Testing...';

  try {
    let result;
    if (provider === 'anthropic') result = await window.pocketAgent.validate.anthropicKey(key);
    else if (provider === 'openai') result = await window.pocketAgent.validate.openAIKey(key);
    else if (provider === 'moonshot') result = await window.pocketAgent.validate.moonshotKey(key);
    else if (provider === 'glm') result = await window.pocketAgent.validate.glmKey(key);
    else if (provider === 'xiaomi') result = await window.pocketAgent.validate.xiaomiKey(key);
    else if (provider === 'minimax') result = await window.pocketAgent.validate.minimaxKey(key);
    else if (provider === 'deepseek') result = await window.pocketAgent.validate.deepseekKey(key);
    else if (provider === 'telegram') result = await window.pocketAgent.validate.telegramToken(key);

    if (result.valid) {
      await window.pocketAgent.settings.set(inputId, key);
      _stgSettings[inputId] = key;
      _stgShowToast(result.botInfo ? `Valid — Bot: @${result.botInfo.username}` : 'All good', 'success');
      const deleteBtn = document.getElementById(`${inputId}-delete`);
      if (deleteBtn) deleteBtn.classList.add('visible');
      if (['anthropic', 'telegram'].includes(provider)) _stgActivateReboot();
    } else {
      _stgShowToast(result.error || 'That key didn\'t work', 'error');
    }
  } catch (err) {
    _stgShowToast('Validation failed: ' + err.message, 'error');
  }

  _stgResetTestButton(button);
}

/**
 * Restore a Test button to its idle state. Removing the 'validating' class can
 * leave an empty class="" attribute, which still fails the naked-button CSS
 * selector (button:not([class])) and drops the pill styling — so strip the
 * attribute entirely when no classes remain.
 */
function _stgResetTestButton(button) {
  button.classList.remove('validating');
  if (button.classList.length === 0) button.removeAttribute('class');
  button.textContent = 'Test';
}

// ---- Reboot ----

function _stgActivateReboot() {
  const btn = document.getElementById('reboot-btn');
  if (btn) { btn.disabled = false; btn.classList.add('active'); }
}

function _stgDeactivateReboot() {
  const btn = document.getElementById('reboot-btn');
  if (btn) { btn.disabled = true; btn.classList.remove('active'); }
}

async function stgRestartAgent() {
  const btn = document.getElementById('reboot-btn');
  if (btn && btn.disabled) return;
  try {
    _stgShowToast('Waking up...', 'success');
    await window.pocketAgent.agent.restart();
    _stgDeactivateReboot();
    _stgShowToast('Welcome back', 'success');
  } catch (err) {
    _stgShowToast('Failed to restart: ' + err.message, 'error');
  }
}

// ---- Telegram ----

async function stgSaveTelegramSetting(inputId) {
  const input = document.getElementById(inputId);
  const value = input.value.trim();
  try {
    await window.pocketAgent.settings.set(inputId, value);
    _stgSettings[inputId] = value;
    _stgShowToast('Saved', 'success');
    _stgActivateReboot();
  } catch (err) {
    console.error('[Settings] Failed to save telegram setting:', err);
    _stgShowToast('Save failed, try again?', 'error');
  }
}

// ---- Chat Settings ----

const _STG_CHAT_API_URL = 'https://pocket-agent-chat-production.up.railway.app';
const _STG_CHAT_USERNAME_REGEX = /^[a-z0-9-]{1,15}$/;

async function stgSaveChatUsername() {
  const input = document.getElementById('chat.username');
  const raw = input.value.trim().toLowerCase();
  if (!raw) { _stgShowToast('Enter a username', 'error'); return; }
  if (!_STG_CHAT_USERNAME_REGEX.test(raw)) { _stgShowToast('Letters, numbers, dashes only (max 15)', 'error'); return; }

  const oldUsername = _stgSettings['chat.username'] || '';
  const adminKey = document.getElementById('chat.adminKey').value.trim() || _stgSettings['chat.adminKey'] || '';

  if (raw === oldUsername.toLowerCase()) { _stgShowToast('Username unchanged', 'success'); return; }

  try {
    const checkParams = new URLSearchParams({ name: raw });
    if (adminKey) checkParams.set('adminKey', adminKey);
    const checkRes = await fetch(`${_STG_CHAT_API_URL}/api/check-username?${checkParams}`);
    if (!checkRes.ok) { _stgShowToast('Chat server error, try again later', 'error'); return; }
    const checkData = await checkRes.json();
    if (!checkData.available) { _stgShowToast('Username taken, try another', 'error'); return; }

    const regRes = await fetch(`${_STG_CHAT_API_URL}/api/register-username`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: raw, oldUsername, adminKey }),
    });
    if (!regRes.ok) { _stgShowToast('Chat server error, try again later', 'error'); return; }
    const regData = await regRes.json();
    if (regData.error) { _stgShowToast(regData.error === 'taken' ? 'Username taken, try another' : regData.error, 'error'); return; }

    input.value = raw;
    await window.pocketAgent.settings.set('chat.username', raw);
    _stgSettings['chat.username'] = raw;
    _stgShowToast('Username saved', 'success');
  } catch (err) {
    console.error('[Settings] Failed to save username:', err);
    _stgShowToast('Could not reach chat server', 'error');
  }
}

async function stgSaveChatAdminKey() {
  try {
    const adminKey = document.getElementById('chat.adminKey').value.trim();
    await window.pocketAgent.settings.set('chat.adminKey', adminKey);
    _stgSettings['chat.adminKey'] = adminKey;
    _stgShowToast('Admin key saved', 'success');
    _stgActivateReboot();
  } catch (err) {
    console.error('[Settings] Failed to save admin key:', err);
    _stgShowToast('Save failed, try again?', 'error');
  }
}

// ---- Auth ----

async function _stgUpdateAuthStatus() {
  const statusBadge = document.getElementById('auth-status');
  const authBtn = document.getElementById('oauth-btn');
  const oauthCodeSection = document.getElementById('oauth-code-section');
  const authMethod = _stgSettings['auth.method'];
  const hasOAuth = _stgSettings['auth.oauthToken'];
  const hasApiKey = _stgSettings['anthropic.apiKey'];
  const hasMoonshotKey = _stgSettings['moonshot.apiKey'];
  const hasGlmKey = _stgSettings['glm.apiKey'];
  const anthropicKeyRow = document.getElementById('anthropic-key-row');
  const authApiKeySection = document.getElementById('auth-api-key-section');

  if (!statusBadge || !authBtn) return;

  if (oauthCodeSection) oauthCodeSection.classList.add('hidden');

  if (authMethod === 'oauth' && hasOAuth) {
    statusBadge.className = 'auth-badge loading';
    statusBadge.textContent = 'Checking…';
    authBtn.textContent = 'Sign Out';
    authBtn.className = 'logout-btn';
    if (anthropicKeyRow) anthropicKeyRow.classList.add('hidden');
    if (authApiKeySection) { authApiKeySection.classList.add('disabled-section'); authApiKeySection.style.pointerEvents = 'none'; }

    try {
      const result = await window.pocketAgent.auth.validateOAuth();
      if (result.valid) { statusBadge.className = 'auth-badge oauth'; statusBadge.textContent = 'Connected'; }
      else { statusBadge.className = 'auth-badge none'; statusBadge.textContent = 'Session expired'; authBtn.textContent = 'Sign In'; authBtn.className = 'oauth-btn'; }
    } catch {
      statusBadge.className = 'auth-badge none'; statusBadge.textContent = 'Could not verify'; authBtn.textContent = 'Sign In'; authBtn.className = 'oauth-btn';
    }
  } else {
    statusBadge.className = 'auth-badge none hidden';
    statusBadge.textContent = '';
    authBtn.textContent = 'Sign In';
    authBtn.className = 'oauth-btn';
    if (anthropicKeyRow) anthropicKeyRow.classList.remove('hidden');
    if (authApiKeySection) { authApiKeySection.classList.remove('disabled-section'); authApiKeySection.style.pointerEvents = 'auto'; }
  }
}

async function stgHandleAuthAction() {
  const authBtn = document.getElementById('oauth-btn');
  if (authBtn.classList.contains('logout-btn')) { await stgLogout(); } else { await stgStartOAuth(); }
}

async function stgStartOAuth() {
  const btn = document.getElementById('oauth-btn');
  btn.disabled = true;
  btn.textContent = 'Opening...';
  try {
    const result = await window.pocketAgent.auth.startOAuth();
    if (result.success) {
      document.getElementById('oauth-code-section').classList.remove('hidden');
      document.getElementById('oauth-code').focus();
    } else { _stgShowToast(result.error || 'Failed to start OAuth', 'error'); }
  } catch (err) { _stgShowToast(err.message || 'OAuth failed', 'error'); }
  btn.disabled = false;
  btn.textContent = 'Sign In';
}

async function stgCompleteOAuth() {
  const code = document.getElementById('oauth-code').value.trim();
  const submitBtn = document.querySelector('#oauth-code-section button');
  if (!code) { _stgShowToast('Paste the code', 'error'); return; }
  submitBtn.disabled = true;
  submitBtn.textContent = 'Verifying...';
  try {
    const result = await window.pocketAgent.auth.completeOAuth(code);
    if (result.success) {
      _stgShowToast('Connected', 'success');
      document.getElementById('oauth-code-section').classList.add('hidden');
      document.getElementById('oauth-code').value = '';
      await _stgLoadSettings();
      _stgUpdateAuthStatus();
      await _stgRefreshModelDropdown();
    } else { _stgShowToast(result.error || 'That code didn\'t work', 'error'); }
  } catch (err) { _stgShowToast(err.message || 'Verification failed', 'error'); }
  submitBtn.disabled = false;
  submitBtn.textContent = 'Submit';
}

async function stgSaveApiKey() {
  const input = document.getElementById('auth-api-key');
  const button = input.parentElement.querySelector('button:not(.delete-btn)');
  const key = input.value.trim();
  if (!key) { _stgShowToast('Need your API key', 'error'); return; }
  const formatValidation = _stgValidateKeyFormat('anthropic.apiKey', key);
  if (!formatValidation.valid) { _stgShowToast(formatValidation.error, 'error'); return; }
  button.disabled = true;
  button.textContent = 'Validating...';
  try {
    const result = await window.pocketAgent.validate.anthropicKey(key);
    if (result.valid) {
      await window.pocketAgent.settings.set('anthropic.apiKey', key);
      await window.pocketAgent.settings.set('auth.method', 'api_key');
      _stgShowToast('Key saved', 'success');
      _stgActivateReboot();
      const deleteBtn = document.getElementById('auth-api-key-delete');
      if (deleteBtn) deleteBtn.classList.add('visible');
      await _stgLoadSettings();
      _stgUpdateAuthStatus();
      await _stgRefreshModelDropdown();
    } else { _stgShowToast(result.error || 'Invalid key', 'error'); }
  } catch (err) { _stgShowToast(err.message || 'Validation failed', 'error'); }
  button.disabled = false;
  button.textContent = 'Save';
}

async function stgLogout() {
  if (!confirm('Are you sure you want to sign out? You will need to re-authenticate.')) return;
  try {
    await window.pocketAgent.settings.set('auth.method', '');
    await window.pocketAgent.settings.set('auth.oauthToken', '');
    await window.pocketAgent.settings.set('auth.refreshToken', '');
    await window.pocketAgent.settings.set('auth.tokenExpiresAt', '');
    await window.pocketAgent.settings.set('anthropic.apiKey', '');
    _stgShowToast('Signed out', 'success');
    await _stgLoadSettings();
    _stgUpdateAuthStatus();
  } catch (err) { _stgShowToast('Failed to sign out: ' + err.message, 'error'); }
}

// ---- OpenAI OAuth ----

async function _stgUpdateOpenAIAuthStatus() {
  const statusBadge = document.getElementById('openai-auth-status');
  const authBtn = document.getElementById('openai-oauth-btn');

  if (!statusBadge || !authBtn) return;

  const authMethod = _stgSettings['openai.auth.method'];
  const isOAuth = authMethod === 'oauth';

  if (isOAuth) {
    statusBadge.className = 'auth-badge loading';
    statusBadge.textContent = 'Checking…';
    authBtn.textContent = 'Sign Out';
    authBtn.className = 'logout-btn';

    try {
      const result = await window.pocketAgent.openaiAuth.validateOAuth();
      if (result.valid) {
        statusBadge.className = 'auth-badge oauth';
        statusBadge.textContent = 'Connected';
      } else {
        statusBadge.className = 'auth-badge none';
        statusBadge.textContent = 'Session expired';
        authBtn.textContent = 'Sign In';
        authBtn.className = 'oauth-btn';
      }
    } catch {
      statusBadge.className = 'auth-badge none';
      statusBadge.textContent = 'Could not verify';
      authBtn.textContent = 'Sign In';
      authBtn.className = 'oauth-btn';
    }
  } else {
    statusBadge.className = 'auth-badge none hidden';
    statusBadge.textContent = '';
    authBtn.textContent = 'Sign In';
    authBtn.className = 'oauth-btn';
  }
}

async function stgHandleOpenAIAuth() {
  const authBtn = document.getElementById('openai-oauth-btn');
  if (authBtn.classList.contains('logout-btn')) {
    if (!confirm('Sign out of OpenAI? You will need to re-authenticate.')) return;
    try {
      await window.pocketAgent.openaiAuth.logoutOAuth();
      await _stgLoadSettings();
      _stgUpdateOpenAIAuthStatus();
      await _stgRefreshModelDropdown();
      _stgShowToast('Signed out.', 'success');
    } catch (err) { _stgShowToast('Failed: ' + err.message, 'error'); }
  } else {
    await stgStartOpenAIOAuth();
  }
}

async function stgStartOpenAIOAuth() {
  const btn = document.getElementById('openai-oauth-btn');
  btn.disabled = true;
  btn.textContent = 'Opening...';
  try {
    const result = await window.pocketAgent.openaiAuth.startOAuth();
    if (result.success) {
      await _stgLoadSettings();
      _stgUpdateOpenAIAuthStatus();
      await _stgRefreshModelDropdown();
      _stgShowToast('Connected', 'success');
    } else { _stgShowToast(result.error || 'Failed to start OAuth', 'error'); }
  } catch (err) { _stgShowToast(err.message || 'OAuth failed', 'error'); }
  btn.disabled = false;
  btn.textContent = 'Sign In';
}

// ---- LinkedIn (Community Management API — org post analytics) ----

// Populates the setup walkthrough's redirect-URL <code> from the real
// REDIRECT_URI constant (src/auth/linkedin-oauth.ts) instead of a hardcoded
// string in the HTML, so the two can never silently drift apart if the
// callback port ever changes.
async function _stgLoadLinkedInRedirectUri() {
  const el = document.getElementById('li-redirect-uri');
  if (!el) return;
  try {
    el.textContent = await window.pocketAgent.linkedin.getRedirectUri();
  } catch (err) {
    console.error('[Settings] Failed to load LinkedIn redirect URI:', err);
  }
}

function liCopyRedirectUri() {
  const el = document.getElementById('li-redirect-uri');
  if (!el) return;
  navigator.clipboard.writeText(el.textContent.trim())
    .then(() => _stgShowToast('Copied', 'success'))
    .catch(() => _stgShowToast('Could not copy', 'error'));
}

async function stgSaveLinkedInAppCredentials() {
  const idInput = document.getElementById('linkedin.clientId');
  const secretInput = document.getElementById('linkedin.clientSecret');
  const clientId = idInput ? idInput.value.trim() : '';
  const clientSecret = secretInput ? secretInput.value.trim() : '';
  if (!clientId) { _stgShowToast('Need a Client ID', 'error'); return; }
  try {
    await window.pocketAgent.settings.set('linkedin.clientId', clientId);
    if (clientSecret) await window.pocketAgent.settings.set('linkedin.clientSecret', clientSecret);
    _stgSettings['linkedin.clientId'] = clientId;
    if (clientSecret) _stgSettings['linkedin.clientSecret'] = clientSecret;
    _stgShowToast('Saved', 'success');
    if (secretInput) secretInput.value = '';
    await _stgLoadSettings();
    _stgUpdateLinkedInAuthStatus();
  } catch (err) { _stgShowToast('Failed to save: ' + err.message, 'error'); }
}

async function _stgUpdateLinkedInAuthStatus() {
  const statusBadge = document.getElementById('linkedin-auth-status');
  const authBtn = document.getElementById('linkedin-oauth-btn');
  if (!statusBadge || !authBtn) return;

  statusBadge.className = 'auth-badge loading';
  statusBadge.textContent = 'Checking…';
  try {
    const status = await window.pocketAgent.linkedin.getAuthStatus();
    if (!status.hasAppCredentials) {
      statusBadge.className = 'auth-badge none';
      statusBadge.textContent = 'Add Client ID/Secret first';
      authBtn.textContent = 'Connect LinkedIn';
      authBtn.className = 'oauth-btn';
      authBtn.disabled = true;
      return;
    }
    authBtn.disabled = false;
    if (status.connected) {
      statusBadge.className = 'auth-badge oauth';
      statusBadge.textContent = 'Connected';
      authBtn.textContent = 'Disconnect';
      authBtn.className = 'logout-btn';
    } else {
      statusBadge.className = 'auth-badge none';
      statusBadge.textContent = 'Not connected';
      authBtn.textContent = 'Connect LinkedIn';
      authBtn.className = 'oauth-btn';
    }
  } catch {
    statusBadge.className = 'auth-badge none';
    statusBadge.textContent = 'Could not verify';
    authBtn.textContent = 'Connect LinkedIn';
    authBtn.className = 'oauth-btn';
  }
}

async function stgHandleLinkedInAuth() {
  const authBtn = document.getElementById('linkedin-oauth-btn');
  if (authBtn.classList.contains('logout-btn')) {
    if (!confirm('Disconnect LinkedIn? Analytics sync will stop until you reconnect.')) return;
    try {
      await window.pocketAgent.linkedin.logout();
      _stgUpdateLinkedInAuthStatus();
      _stgShowToast('Disconnected', 'success');
    } catch (err) { _stgShowToast('Failed: ' + err.message, 'error'); }
    return;
  }

  authBtn.disabled = true;
  authBtn.textContent = 'Opening…';
  try {
    const result = await window.pocketAgent.linkedin.startOAuth();
    if (result.success) {
      _stgShowToast('Connected', 'success');
    } else {
      _stgShowToast(result.error || 'Failed to connect LinkedIn', 'error');
    }
  } catch (err) {
    _stgShowToast(err.message || 'LinkedIn sign-in failed', 'error');
  }
  authBtn.disabled = false;
  await _stgUpdateLinkedInAuthStatus();
}

// ---- Kimi (Moonshot) OAuth ----

let _stgKimiPollInterval = null;

async function _stgUpdateKimiAuthStatus() {
  const statusBadge = document.getElementById('kimi-auth-status');
  const authBtn = document.getElementById('kimi-oauth-btn');
  const deviceCodeSection = document.getElementById('kimi-device-code-section');
  const apiKeySection = document.getElementById('kimi-api-key-section');

  if (!statusBadge || !authBtn) return;

  const authMethod = _stgSettings['kimi.auth.method'];
  const isOAuth = authMethod === 'oauth';

  // Check pending state via IPC (in-memory on main process)
  let isPending = false;
  try {
    isPending = await window.pocketAgent.kimiAuth.isOAuthPending();
  } catch { /* ignore */ }

  if (deviceCodeSection) deviceCodeSection.classList.add('hidden');

  if (isOAuth) {
    statusBadge.className = 'auth-badge loading';
    statusBadge.textContent = 'Checking…';
    authBtn.textContent = 'Sign Out';
    authBtn.className = 'logout-btn';
    if (apiKeySection) { apiKeySection.classList.add('disabled-section'); apiKeySection.style.pointerEvents = 'none'; }

    try {
      const result = await window.pocketAgent.kimiAuth.validateOAuth();
      if (result.valid) {
        statusBadge.className = 'auth-badge oauth';
        statusBadge.textContent = 'Connected';
      } else {
        statusBadge.className = 'auth-badge none';
        statusBadge.textContent = 'Session expired';
        authBtn.textContent = 'Sign In';
        authBtn.className = 'oauth-btn';
        if (apiKeySection) { apiKeySection.classList.remove('disabled-section'); apiKeySection.style.pointerEvents = 'auto'; }
      }
    } catch {
      statusBadge.className = 'auth-badge none';
      statusBadge.textContent = 'Could not verify';
      authBtn.textContent = 'Sign In';
      authBtn.className = 'oauth-btn';
      if (apiKeySection) { apiKeySection.classList.remove('disabled-section'); apiKeySection.style.pointerEvents = 'auto'; }
    }
  } else if (isPending) {
    // Device-code flow in progress — show waiting state
    statusBadge.className = 'auth-badge loading';
    statusBadge.textContent = 'Waiting…';
    authBtn.textContent = 'Cancel';
    authBtn.className = 'oauth-btn';
    if (deviceCodeSection) deviceCodeSection.classList.remove('hidden');
    if (apiKeySection) { apiKeySection.classList.add('disabled-section'); apiKeySection.style.pointerEvents = 'none'; }
  } else {
    statusBadge.className = 'auth-badge none hidden';
    statusBadge.textContent = '';
    authBtn.textContent = 'Sign In';
    authBtn.className = 'oauth-btn';
    if (apiKeySection) { apiKeySection.classList.remove('disabled-section'); apiKeySection.style.pointerEvents = 'auto'; }
  }
}

async function stgHandleKimiAuth() {
  const authBtn = document.getElementById('kimi-oauth-btn');
  if (authBtn.classList.contains('logout-btn')) {
    // Sign out
    if (!confirm('Sign out of Kimi? You will need to re-authenticate.')) return;
    try {
      await window.pocketAgent.kimiAuth.logoutOAuth();
      _stgSettings['kimi.auth.method'] = '';
      _stgSettings['kimi.accessToken'] = '';
      _stgStopKimiPolling();
      await _stgLoadSettings();
      _stgUpdateKimiAuthStatus();
      await _stgRefreshModelDropdown();
      _stgShowToast('Signed out.', 'success');
    } catch (err) { _stgShowToast('Failed: ' + err.message, 'error'); }
  } else if (authBtn.textContent === 'Cancel') {
    // Cancel pending flow
    await window.pocketAgent.kimiAuth.cancelOAuth();
    _stgStopKimiPolling();
    _stgUpdateKimiAuthStatus();
    _stgShowToast('Cancelled.', 'success');
  } else {
    await stgStartKimiOAuth();
  }
}

async function stgStartKimiOAuth() {
  const btn = document.getElementById('kimi-oauth-btn');
  btn.disabled = true;
  btn.textContent = 'Starting...';
  try {
    const result = await window.pocketAgent.kimiAuth.startOAuth();
    if (result.success) {
      // Show device code info
      const urlEl = document.getElementById('kimi-verification-url');
      const codeEl = document.getElementById('kimi-user-code');
      if (urlEl && result.verificationUri) {
        urlEl.textContent = result.verificationUri;
        urlEl.onclick = () => window.pocketAgent.app.openExternal(result.verificationUri);
      }
      if (codeEl && result.userCode) {
        codeEl.textContent = result.userCode;
      }

      _stgUpdateKimiAuthStatus();

      // Start polling for auth completion
      _stgStartKimiPolling();
    } else { _stgShowToast(result.error || 'Failed to start Kimi OAuth', 'error'); }
  } catch (err) { _stgShowToast(err.message || 'OAuth failed', 'error'); }
  btn.disabled = false;
  btn.textContent = 'Sign In';
}

function _stgStartKimiPolling() {
  _stgStopKimiPolling();
  _stgKimiPollInterval = setInterval(async () => {
    try {
      const isPending = await window.pocketAgent.kimiAuth.isOAuthPending();
      if (!isPending) {
        // Auth completed (or failed/timed out)
        _stgStopKimiPolling();
        await _stgLoadSettings();
        _stgUpdateKimiAuthStatus();
        await _stgRefreshModelDropdown();

        // Check if we actually got authenticated
        const settings = await window.pocketAgent.settings.getAll();
        if (settings['kimi.auth.method'] === 'oauth' && settings['kimi.accessToken']) {
          _stgShowToast('Connected to Kimi', 'success');
        } else {
          _stgShowToast('Kimi authorization failed or timed out', 'error');
        }
      }
    } catch {
      // Ignore polling errors
    }
  }, 3000);
}

function _stgStopKimiPolling() {
  if (_stgKimiPollInterval) {
    clearInterval(_stgKimiPollInterval);
    _stgKimiPollInterval = null;
  }
}

// ---- Pocket CLI ----

const _STG_CLI_IS_WINDOWS = typeof window.pocketAgent?.app?.getPlatform === 'function' && window.pocketAgent.app.getPlatform() === 'win32';

const _stgCliCommands = {
  which: _STG_CLI_IS_WINDOWS ? '(Get-Command pocket -ErrorAction SilentlyContinue).Source' : 'which pocket',
  version: (pocketPath) => _STG_CLI_IS_WINDOWS ? null : `strings "${pocketPath}" | grep -E '^v[0-9]+\\.[0-9]+\\.[0-9]+$' | head -1`,
  fetchLatest: _STG_CLI_IS_WINDOWS
    ? 'Invoke-RestMethod https://api.github.com/repos/KenKaiii/pocket-agent-cli/releases/latest | ConvertTo-Json -Depth 10'
    : 'curl -fsSL https://api.github.com/repos/KenKaiii/pocket-agent-cli/releases/latest',
  install: _STG_CLI_IS_WINDOWS
    ? [
        '$installDir = Join-Path $env:LOCALAPPDATA "pocket-agent-cli"',
        'New-Item -ItemType Directory -Force -Path $installDir | Out-Null',
        '$release = Invoke-RestMethod "https://api.github.com/repos/KenKaiii/pocket-agent-cli/releases/latest"',
        '$asset = $release.assets | Where-Object { $_.name -like "*windows*amd64*" } | Select-Object -First 1',
        'if (-not $asset) { throw "No Windows release asset found" }',
        '$zipPath = Join-Path $env:TEMP "pocket_cli.zip"',
        'Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath',
        'Expand-Archive -Path $zipPath -DestinationPath $installDir -Force',
        'Remove-Item $zipPath -Force',
        '$userPath = [Environment]::GetEnvironmentVariable("Path", "User")',
        'if ($userPath -notlike "*$installDir*") { [Environment]::SetEnvironmentVariable("Path", "$userPath;$installDir", "User") }',
        'Write-Output "Installed to $installDir"',
      ].join('; ')
    : 'curl -fsSL https://raw.githubusercontent.com/KenKaiii/pocket-agent-cli/main/scripts/install.sh -o /tmp/pocket-cli-install.sh && sed -i "" "s/^.*exec .*$//" /tmp/pocket-cli-install.sh && bash /tmp/pocket-cli-install.sh && rm -f /tmp/pocket-cli-install.sh',
};

async function _stgInitPocketCli() {
  const versionEl = document.getElementById('pocket-cli-version');
  const statusEl = document.getElementById('pocket-cli-status');
  const checkBtn = document.getElementById('pocket-cli-check-btn');
  const installBtn = document.getElementById('pocket-cli-install-btn');
  if (!versionEl || !statusEl) return;

  try {
    const result = await window.pocketAgent.shell.runCommand(_stgCliCommands.which);
    if (result && result.trim()) {
      const versionCmd = _stgCliCommands.version(result.trim());
      if (versionCmd) {
        try {
          const versionResult = await window.pocketAgent.shell.runCommand(versionCmd);
          if (versionResult && versionResult.trim()) {
            _stgPocketCliInstalledVersion = versionResult.trim().replace(/^v/, '');
            versionEl.textContent = `v${_stgPocketCliInstalledVersion}`;
          } else { versionEl.textContent = 'Installed'; }
        } catch (e) { versionEl.textContent = 'Installed'; }
      } else { versionEl.textContent = 'Installed'; }
      statusEl.className = 'status success';
      statusEl.textContent = 'Installed';
      if (installBtn) installBtn.classList.add('hidden');
      if (checkBtn) checkBtn.classList.remove('hidden');
    } else {
      statusEl.className = 'status warning'; statusEl.textContent = 'Not installed';
      if (installBtn) { installBtn.classList.remove('hidden'); installBtn.textContent = 'Install'; }
      if (checkBtn) checkBtn.classList.add('hidden');
      versionEl.textContent = '—';
    }
  } catch (err) {
    statusEl.className = 'status warning'; statusEl.textContent = 'Not installed';
    if (installBtn) { installBtn.classList.remove('hidden'); installBtn.textContent = 'Install'; }
    if (checkBtn) checkBtn.classList.add('hidden');
    versionEl.textContent = '—';
  }

  const autoCheck = _stgSettings['pocketCli.autoCheck'] !== 'false';
  if (autoCheck && _stgPocketCliInstalledVersion) stgCheckPocketCliUpdates();
}

async function stgCheckPocketCliUpdates() {
  const statusEl = document.getElementById('pocket-cli-status');
  const checkBtn = document.getElementById('pocket-cli-check-btn');
  const updateBtn = document.getElementById('pocket-cli-update-btn');
  const installBtn = document.getElementById('pocket-cli-install-btn');
  const infoBox = document.getElementById('pocket-cli-info');
  const infoText = document.getElementById('pocket-cli-info-text');
  if (!statusEl || !checkBtn) return;

  checkBtn.disabled = true; checkBtn.textContent = 'Checking...';
  statusEl.className = 'status info'; statusEl.textContent = 'Checking...';
  try {
    const latestJson = await window.pocketAgent.shell.runCommand(_stgCliCommands.fetchLatest);
    if (latestJson) {
      const release = JSON.parse(latestJson);
      const latestVersion = (release.tag_name || '').replace(/^v/, '');
      if (!_stgPocketCliInstalledVersion) {
        statusEl.className = 'status warning'; statusEl.textContent = 'Not installed';
        if (installBtn) { installBtn.classList.remove('hidden'); installBtn.textContent = 'Install'; }
        if (checkBtn) checkBtn.classList.add('hidden');
      } else if (latestVersion && latestVersion !== _stgPocketCliInstalledVersion) {
        statusEl.className = 'status info'; statusEl.textContent = 'Update available';
        if (updateBtn) { updateBtn.classList.remove('hidden'); updateBtn.textContent = `Update to v${latestVersion}`; }
        if (infoBox) infoBox.classList.remove('hidden');
        if (infoText) infoText.textContent = `v${latestVersion} is available. You are on v${_stgPocketCliInstalledVersion}.`;
      } else {
        statusEl.className = 'status success'; statusEl.textContent = 'Up to date';
        if (updateBtn) updateBtn.classList.add('hidden');
        if (infoBox) infoBox.classList.add('hidden');
      }
    }
  } catch (e) { statusEl.className = 'status warning'; statusEl.textContent = 'Unable to check'; }
  finally { checkBtn.disabled = false; checkBtn.textContent = 'Check Now'; }
}

async function stgInstallPocketCli() {
  const statusEl = document.getElementById('pocket-cli-status');
  const installBtn = document.getElementById('pocket-cli-install-btn');
  try {
    installBtn.disabled = true; installBtn.textContent = 'Installing...';
    statusEl.className = 'status info'; statusEl.textContent = 'Installing...';
    await window.pocketAgent.shell.runCommand(_stgCliCommands.install);
    await _stgInitPocketCli();
    if (document.getElementById('pocket-cli-status').classList.contains('success')) {
      _stgShowToast('Pocket CLI installed' + (_STG_CLI_IS_WINDOWS ? ' Restart your terminal to use it.' : ''), 'success');
    }
  } catch (err) {
    statusEl.className = 'status error'; statusEl.textContent = 'Install failed';
    _stgShowToast('Failed to install Pocket CLI: ' + err.message, 'error');
  } finally { installBtn.disabled = false; await _stgInitPocketCli(); }
}

async function stgUpdatePocketCli() {
  const statusEl = document.getElementById('pocket-cli-status');
  const updateBtn = document.getElementById('pocket-cli-update-btn');
  const infoBox = document.getElementById('pocket-cli-info');
  const infoText = document.getElementById('pocket-cli-info-text');
  try {
    updateBtn.disabled = true; updateBtn.textContent = 'Updating...';
    statusEl.className = 'status info'; statusEl.textContent = 'Updating...';
    if (infoBox) infoBox.classList.remove('hidden');
    if (infoText) infoText.textContent = 'Downloading and installing latest version...';
    await window.pocketAgent.shell.runCommand(_stgCliCommands.install);
    await _stgInitPocketCli();
    if (document.getElementById('pocket-cli-status').classList.contains('success')) {
      _stgShowToast('Pocket CLI updated', 'success');
    }
  } catch (err) {
    statusEl.className = 'status error'; statusEl.textContent = 'Update failed';
    _stgShowToast('Failed to update Pocket CLI: ' + err.message, 'error');
  } finally { updateBtn.disabled = false; await _stgInitPocketCli(); }
}

// ---- Browser ----

async function _stgInitializeBrowserSection() {
  const selector = document.getElementById('browser-selector');
  const statusEl = document.getElementById('browser-status');
  if (!selector || !statusEl) return;
  try {
    const browsers = await window.pocketAgent.browser.detectInstalled();
    selector.innerHTML = '<option value="">Select browser...</option>';
    browsers.forEach(browser => {
      const option = document.createElement('option');
      option.value = browser.id;
      option.textContent = browser.name;
      selector.appendChild(option);
    });
    if (browsers.length === 1) selector.value = browsers[0].id;
    await stgTestBrowserConnection();
  } catch (err) {
    console.error('[Settings] Failed to initialize browser section:', err);
    statusEl.className = 'status error'; statusEl.textContent = 'Error loading';
  }
}

async function stgLaunchBrowserWithCdp() {
  const selector = document.getElementById('browser-selector');
  const statusEl = document.getElementById('browser-status');
  const launchBtn = document.getElementById('browser-launch-btn');
  const portInput = document.getElementById('browser-port');
  const browserId = selector.value;
  if (!browserId) { _stgShowToast('Please select a browser first', 'error'); return; }
  const port = parseInt(portInput.value) || 9222;
  launchBtn.disabled = true; launchBtn.textContent = 'Launching...';
  statusEl.className = 'status info'; statusEl.textContent = 'Launching...';
  try {
    const result = await window.pocketAgent.browser.launch(browserId, port);
    if (result.success) {
      statusEl.className = 'status success'; statusEl.textContent = 'Connected';
      _stgShowToast('Browser launched', 'success');
      const cdpInput = document.getElementById('browser.cdpUrl');
      cdpInput.value = `http://localhost:${port}`;
      await window.pocketAgent.settings.set('browser.cdpUrl', cdpInput.value);
    } else if (result.alreadyRunning) {
      statusEl.className = 'status warning'; statusEl.textContent = 'Browser running';
      _stgShowToast(result.error, 'error');
    } else {
      statusEl.className = 'status error'; statusEl.textContent = 'Launch failed';
      _stgShowToast(result.error || 'Failed to launch browser', 'error');
    }
  } catch (err) {
    statusEl.className = 'status error'; statusEl.textContent = 'Error';
    _stgShowToast('Error: ' + err.message, 'error');
  } finally { launchBtn.disabled = false; launchBtn.textContent = 'Launch Browser'; }
}

async function stgTestBrowserConnection() {
  const statusEl = document.getElementById('browser-status');
  const testBtn = document.getElementById('browser-test-btn');
  const cdpInput = document.getElementById('browser.cdpUrl');
  if (!statusEl || !testBtn) return;
  const cdpUrl = cdpInput ? (cdpInput.value || 'http://localhost:9222') : 'http://localhost:9222';
  testBtn.disabled = true; testBtn.textContent = 'Testing...';
  statusEl.className = 'status info'; statusEl.textContent = 'Testing...';
  try {
    const result = await window.pocketAgent.browser.testConnection(cdpUrl);
    if (result.connected) {
      statusEl.className = 'status success'; statusEl.textContent = 'Connected';
      if (result.browserInfo && result.browserInfo.Browser) {
        statusEl.textContent = `Connected (${result.browserInfo.Browser.split('/')[0]})`;
      }
    } else { statusEl.className = 'status error'; statusEl.textContent = 'Not connected'; }
  } catch (err) { statusEl.className = 'status error'; statusEl.textContent = 'Error'; }
  finally { testBtn.disabled = false; testBtn.textContent = 'Test Connection'; }
}

// ---- MCP Servers ----
// First-party (built-in) servers merged with marketplace-sourced ones
// (Atelier/Salon catalogs). Toggling/env are settings-backed, scoped to a
// single per-server row; risk-flagged entries require an explicit confirm
// dialog before their first enable (also enforced server-side, see
// src/main/ipc/mcp-ipc.ts). Server rows never inline JSON into onclick
// attributes (double quotes in a JSON blob would break the HTML) — instead
// every handler looks the server up by id in this module-level cache, which
// _stgLoadMcpServers refreshes on every load/toggle/save.
let _stgMcpServersCache = [];

function _stgMcpEscapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function _stgMcpEscapeAttr(text) {
  return String(text).replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function _stgMcpFindServer(id) {
  return _stgMcpServersCache.find((s) => s.id === id);
}

// The active workspace context (personal/world/client/project) — same shape
// clients-view.js's getActiveWorkspace() returns, used to resolve per-scope
// enablement (src/agent/enablement.ts) for the current brand/project.
function _stgMcpContext() {
  if (typeof getActiveWorkspace === 'function') return getActiveWorkspace();
  return { contextType: 'personal', clientId: null, projectKey: null };
}

// Mirrors src/memory/scope.ts resolveNearestScope.
function _stgMcpNearestScope(ctx) {
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

let _stgMcpClientsCache = null;

async function _stgMcpEnsureClientsCache() {
  if (_stgMcpClientsCache) return;
  try {
    _stgMcpClientsCache = (await window.pocketAgent.clients.list()) || [];
  } catch (_) {
    _stgMcpClientsCache = [];
  }
}

// Synchronous — call _stgMcpEnsureClientsCache() first so client names resolve.
function _stgMcpScopeLabel(scope) {
  if (!scope || scope === 'default') return 'Agency-wide (default)';
  if (scope === 'world') return 'Agency-wide';
  if (scope === 'user') return 'Personal';
  if (scope.startsWith('client:')) {
    const id = scope.slice('client:'.length);
    const client = (_stgMcpClientsCache || []).find((c) => c.id === id);
    return client ? client.name : id;
  }
  return scope;
}

async function _stgInitMcpSection() {
  await _stgLoadMcpServers();
}

async function _stgLoadMcpServers() {
  const listEl = document.getElementById('mcp-server-list');
  const emptyEl = document.getElementById('mcp-server-empty');
  if (!listEl) return;

  try {
    await _stgMcpEnsureClientsCache();
    const servers = await window.pocketAgent.mcp.listServers(_stgMcpContext());
    _stgMcpServersCache = servers || [];
    if (_stgMcpServersCache.length === 0) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');

    // Group by source, first-party first, then each marketplace pack.
    const bySource = new Map();
    for (const s of _stgMcpServersCache) {
      if (!bySource.has(s.source)) bySource.set(s.source, []);
      bySource.get(s.source).push(s);
    }
    const sourceOrder = [...bySource.keys()].sort((a, b) => {
      if (a === 'first-party') return -1;
      if (b === 'first-party') return 1;
      return a.localeCompare(b);
    });

    listEl.innerHTML = sourceOrder.map((source) => `
      <div class="mcp-source-group">
        <div class="mcp-source-title">${_stgMcpEscapeHtml(source === 'first-party' ? 'Built-in' : source)}</div>
        <div class="mcp-server-rows">
          ${bySource.get(source).map(_stgMcpServerRowHtml).join('')}
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('[Settings] Failed to load MCP servers:', err);
    _stgShowToast('Failed to load MCP servers', 'error');
  }
}

// Live runtime pill (roadmap item 5): reflects src/mcp/manager.ts's actual
// connection state for this server, not just the settings/scope gates above.
// Only meaningful once the gates pass (enabled+configured+scopeEnabled) —
// a gated-off server is always 'not_started' since it's never spawned.
function _stgMcpRuntimePill(server) {
  const title = server.runtimeError ? ` title="${_stgMcpEscapeAttr(server.runtimeError)}"` : '';
  switch (server.runtimeStatus) {
    case 'running':
      return `<span class="status success"${title}>Running</span>`;
    case 'starting':
      return `<span class="status info"${title}>Starting…</span>`;
    case 'failed':
      return `<span class="status error"${title}>Failed</span>`;
    case 'not_started':
    default:
      return `<span class="status"${title}>Not started</span>`;
  }
}

function _stgMcpStatusPill(server) {
  if (!server.toggleable) return '<span class="status info">Built-in</span>';
  if (!server.enabled) return '<span class="status">Disabled</span>';
  if (!server.configured) return '<span class="status warning">Missing credentials</span>';
  if (!server.scopeEnabled) return `<span class="status warning">Disabled for ${_stgMcpEscapeHtml(_stgMcpScopeLabel(server.scopeEnablementScope))}</span>`;
  return `<span class="status success">Enabled</span> ${_stgMcpRuntimePill(server)}`;
}

// Per-scope (client/project) enable/disable row — only meaningful for
// toggleable (marketplace) servers; layered on top of the settings-level
// enabled/configured gate above (src/agent/enablement.ts).
function _stgMcpScopeRowHtml(server) {
  if (!server.toggleable) return '';
  const ctx = _stgMcpContext();
  const nearestScope = _stgMcpNearestScope(ctx);
  const hasLocalOverride = server.scopeEnablementScope === nearestScope && server.scopeEnablementScope !== 'default';
  const scopeNote = server.scopeEnablementScope !== 'default'
    ? `<span class="mcp-server-scope-note">(scope: ${_stgMcpEscapeHtml(_stgMcpScopeLabel(server.scopeEnablementScope))})</span>`
    : '';
  const toggleLabel = server.scopeEnabled
    ? `Disable for ${_stgMcpEscapeHtml(_stgMcpScopeLabel(nearestScope))}`
    : `Enable for ${_stgMcpEscapeHtml(_stgMcpScopeLabel(nearestScope))}`;
  const clearBtn = hasLocalOverride
    ? `<button class="skills-setup-btn btn-compact" onclick="playNormalClick(); _stgClearMcpServerScope('${_stgMcpEscapeAttr(server.id)}')">Clear</button>`
    : '';
  return `
    <div class="mcp-server-scope-row">
      ${scopeNote}
      <button class="skills-setup-btn btn-compact" onclick="playNormalClick(); _stgToggleMcpServerScope('${_stgMcpEscapeAttr(server.id)}')">${toggleLabel}</button>
      ${clearBtn}
    </div>`;
}

function _stgMcpServerRowHtml(server) {
  const riskBadge = server.riskNote
    ? `<span class="risk-badge">Risk<span class="risk-tooltip">${_stgMcpEscapeHtml(server.riskNote)}</span></span>`
    : '';
  const kindBadge = `<span class="badge">${_stgMcpEscapeHtml(server.kind)}</span>`;
  const toggle = server.toggleable
    ? `<div class="toggle ${server.enabled ? 'active' : ''}" onclick="playNormalClick(); _stgToggleMcpServer('${_stgMcpEscapeAttr(server.id)}')"></div>`
    : `<div class="toggle active disabled-toggle" title="Always on"></div>`;
  const envForm = server.toggleable && server.requiredEnv.length
    ? `
      <div class="mcp-server-env">
        ${server.requiredEnv.map((name) => `
          <div class="key-input">
            <input type="password" class="mcp-env-input" data-server-id="${_stgMcpEscapeAttr(server.id)}" data-env-name="${_stgMcpEscapeAttr(name)}" placeholder="${_stgMcpEscapeHtml(name)}">
          </div>
        `).join('')}
        <button class="skills-setup-btn btn-compact" onclick="playNormalClick(); _stgSaveMcpServerEnv('${_stgMcpEscapeAttr(server.id)}')">Save credentials</button>
      </div>`
    : '';

  return `
    <div class="mcp-server-row" data-id="${_stgMcpEscapeAttr(server.id)}">
      <div class="mcp-server-head">
        <span class="mcp-server-name">${_stgMcpEscapeHtml(server.name)}</span>
        ${kindBadge}
        ${riskBadge}
        ${_stgMcpStatusPill(server)}
        ${toggle}
      </div>
      ${server.description ? `<div class="mcp-server-desc">${_stgMcpEscapeHtml(server.description)}</div>` : ''}
      ${envForm}
      ${_stgMcpScopeRowHtml(server)}
    </div>`;
}

async function _stgToggleMcpServer(id) {
  const server = _stgMcpFindServer(id);
  if (!server) return;
  const nextEnabled = !server.enabled;

  let confirmed = false;
  if (nextEnabled && server.riskNote) {
    if (!confirm(`This server carries risk:\n\n${server.riskNote}\n\nEnable anyway?`)) return;
    confirmed = true;
  }
  try {
    const res = await window.pocketAgent.mcp.setServerEnabled(id, nextEnabled, confirmed);
    if (!res || !res.success) {
      _stgShowToast((res && res.error) || 'Failed to update server', 'error');
      return;
    }
    _stgShowToast(nextEnabled ? 'Enabled' : 'Disabled', 'success');
    _stgActivateReboot();
    _stgLoadMcpServers();
  } catch (err) {
    console.error('[Settings] Failed to toggle MCP server:', err);
    _stgShowToast('Failed to update server', 'error');
  }
}

async function _stgSaveMcpServerEnv(id) {
  const inputs = document.querySelectorAll(`.mcp-env-input[data-server-id="${CSS.escape(id)}"]`);
  const env = {};
  inputs.forEach((el) => {
    if (el.value) env[el.dataset.envName] = el.value;
  });
  if (Object.keys(env).length === 0) {
    _stgShowToast('Enter at least one credential', 'error');
    return;
  }
  try {
    const res = await window.pocketAgent.mcp.setServerEnv(id, env);
    if (!res || !res.success) {
      _stgShowToast((res && res.error) || 'Failed to save credentials', 'error');
      return;
    }
    _stgShowToast('Credentials saved', 'success');
    _stgActivateReboot();
    _stgLoadMcpServers();
  } catch (err) {
    console.error('[Settings] Failed to save MCP server env:', err);
    _stgShowToast('Failed to save credentials', 'error');
  }
}

// ---- Per-scope (client/project) enable/disable ----
// Layered on top of the settings-level enabled/configured gate above — a
// client/project can disable a server the agency has enabled and configured.
// Does not affect the settings-level `enabled` flag or stored credentials.

async function _stgToggleMcpServerScope(id) {
  const server = _stgMcpFindServer(id);
  if (!server) return;
  const nextEnabled = !server.scopeEnabled;
  try {
    const res = await window.pocketAgent.mcp.setServerScopeEnablement(id, nextEnabled, _stgMcpContext());
    if (!res || !res.success) {
      _stgShowToast((res && res.error) || 'Failed to update', 'error');
      return;
    }
    _stgShowToast(nextEnabled ? 'Enabled' : 'Disabled', 'success');
    _stgLoadMcpServers();
  } catch (err) {
    console.error('[Settings] Failed to toggle MCP server scope:', err);
    _stgShowToast('Failed to update', 'error');
  }
}

async function _stgClearMcpServerScope(id) {
  try {
    const res = await window.pocketAgent.mcp.clearServerScopeEnablement(id, _stgMcpContext());
    if (!res || !res.success) {
      _stgShowToast('Failed to clear', 'error');
      return;
    }
    _stgShowToast('Now inheriting from a broader scope', 'success');
    _stgLoadMcpServers();
  } catch (err) {
    console.error('[Settings] Failed to clear MCP server scope:', err);
    _stgShowToast('Failed to clear', 'error');
  }
}

// ---- Updates ----

function _stgInitializeUpdates() {
  if (_stgUpdateStatusCleanup) _stgUpdateStatusCleanup();
  if (window.pocketAgent?.updater?.onStatus) {
    _stgUpdateStatusCleanup = window.pocketAgent.updater.onStatus(_stgHandleUpdateStatus);
  }
  if (window.pocketAgent?.updater?.getStatus) {
    window.pocketAgent.updater.getStatus().then(_stgHandleUpdateStatus).catch(() => {});
  }
}

function _stgHandleUpdateStatus(status) {
  const statusEl = document.getElementById('update-status');
  const progressRow = document.getElementById('update-progress-row');
  const progressBar = document.getElementById('update-progress-bar');
  const progressText = document.getElementById('update-progress-text');
  const checkBtn = document.getElementById('check-updates-btn');
  const downloadBtn = document.getElementById('download-update-btn');
  const installBtn = document.getElementById('install-update-btn');
  const infoBox = document.getElementById('update-info');
  const infoText = document.getElementById('update-info-text');
  if (!statusEl || !checkBtn) return;

  if (progressRow) progressRow.classList.add('hidden');
  if (downloadBtn) downloadBtn.classList.add('hidden');
  if (installBtn) installBtn.classList.add('hidden');
  if (infoBox) infoBox.classList.add('hidden');
  checkBtn.disabled = false; checkBtn.textContent = 'Check Now';

  switch (status.status) {
    case 'idle': statusEl.className = 'status info'; statusEl.textContent = 'Ready'; break;
    case 'dev-mode':
      statusEl.className = 'status warning'; statusEl.textContent = 'Dev mode';
      checkBtn.disabled = true; checkBtn.textContent = 'Dev mode';
      if (infoBox) infoBox.classList.remove('hidden');
      if (infoText) infoText.textContent = 'Auto-updates only work in the packaged app.';
      break;
    case 'checking': statusEl.className = 'status info'; statusEl.textContent = 'Checking...'; checkBtn.disabled = true; checkBtn.textContent = 'Checking...'; break;
    case 'available':
      statusEl.className = 'status success'; statusEl.textContent = 'Update available';
      if (downloadBtn) downloadBtn.classList.remove('hidden');
      if (infoBox) infoBox.classList.remove('hidden');
      if (infoText) infoText.textContent = `Version ${status.info?.version || 'unknown'} is available for download.`;
      break;
    case 'not-available':
      statusEl.className = 'status success'; statusEl.textContent = 'Up to date';
      if (status.error && infoBox && infoText) { infoBox.classList.remove('hidden'); infoText.textContent = status.error; }
      break;
    case 'downloading':
      statusEl.className = 'status info'; statusEl.textContent = 'Downloading...';
      if (progressRow) progressRow.classList.remove('hidden');
      const percent = status.progress?.percent || 0;
      if (progressBar) progressBar.style.width = `${percent}%`;
      if (progressText) progressText.textContent = `${Math.round(percent)}%`;
      checkBtn.disabled = true;
      break;
    case 'downloaded':
      statusEl.className = 'status success'; statusEl.textContent = 'Ready to install';
      if (installBtn) installBtn.classList.remove('hidden');
      if (infoBox) infoBox.classList.remove('hidden');
      if (infoText) infoText.textContent = `Version ${status.info?.version || 'unknown'} is ready to install. Click "Install & Restart" to update.`;
      break;
    case 'error':
      statusEl.className = 'status error'; statusEl.textContent = 'Error';
      if (infoBox) infoBox.classList.remove('hidden');
      if (infoText) infoText.textContent = status.error || 'An error occurred while checking for updates.';
      break;
  }
}

async function stgCheckForUpdates() {
  const btn = document.getElementById('check-updates-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Checking...'; }
  try { await window.pocketAgent.updater.checkForUpdates(); }
  catch (err) { _stgShowToast('Failed to check for updates: ' + err.message, 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Check Now'; } }
}

async function stgDownloadUpdate() {
  const btn = document.getElementById('download-update-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Starting...'; }
  try { const result = await window.pocketAgent.updater.download(); if (!result.success) _stgShowToast(result.error || 'Download failed', 'error'); }
  catch (err) { _stgShowToast('Failed to download update: ' + err.message, 'error'); }
  if (btn) { btn.disabled = false; btn.textContent = 'Download'; }
}

async function stgInstallUpdate() {
  const btn = document.getElementById('install-update-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Installing...'; }
  try { await window.pocketAgent.updater.install(); }
  catch (err) { _stgShowToast('Failed to install update: ' + err.message, 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Install & Restart'; } }
}

// ---- Skin Picker ----

const _STG_SKIN_DESCRIPTIONS = {
  dracula: 'Classic Dracula',
  cream: 'Warm cream & cocoa',
  light: 'Clean & minimal', dawn: 'Rosé Pine Dawn',
  midnight: 'GitHub dark', nord: 'Scandinavian frost',
  mocha: 'Catppuccin Mocha', rosepine: 'Rosé Pine', gruvbox: 'Retro warm',
  solarized: 'Solarized Dark', onedark: 'Atom One Dark',
};

const _STG_SKIN_PREVIEWS = {
  dracula:   ['#21222c', '#282a36', '#bd93f9', '#ff79c6', '#f8f8f2'],
  cream:     ['#fff1b8', '#fff8e0', '#d93a63', '#ff94ac', '#33201a'],
  light:     ['#f9f9f9', '#ffffff', '#007aff', '#5856d6', '#1c1c1e'],
  dawn:      ['#fffaf3', '#faf4ed', '#907aa9', '#56949f', '#575279'],
  midnight:  ['#161b22', '#0d1117', '#58a6ff', '#79c0ff', '#e6edf3'],
  nord:      ['#3b4252', '#2e3440', '#88c0d0', '#5e81ac', '#eceff4'],
  mocha:     ['#181825', '#1e1e2e', '#89b4fa', '#cba6f7', '#cdd6f4'],
  rosepine:  ['#1f1d2e', '#191724', '#c4a7e7', '#9ccfd8', '#e0def4'],
  gruvbox:   ['#1d2021', '#282828', '#fabd2f', '#fe8019', '#ebdbb2'],
  solarized: ['#073642', '#002b36', '#268bd2', '#2aa198', '#fdf6e3'],
  onedark:   ['#21252b', '#282c34', '#61afef', '#c678dd', '#abb2bf'],
};

async function _stgInitSkinPicker() {
  try {
    _stgThemesCache = await window.pocketAgent.themes.list();
    _stgCurrentSkinId = await window.pocketAgent.themes.getSkin();
    _stgRenderSkinGrid();
    window.pocketAgent.themes.onSkinChanged((skinId) => {
      _stgCurrentSkinId = skinId;
      _stgRenderSkinGrid();
      _stgApplyTheme(skinId);
    });
  } catch (err) { console.error('[Settings] Failed to init skin picker:', err); }
}

function _stgRenderSkinGrid() {
  const grid = document.getElementById('skin-grid');
  if (!grid || !_stgThemesCache) return;
  grid.innerHTML = '';
  for (const [id, theme] of Object.entries(_stgThemesCache)) {
    const card = document.createElement('div');
    card.className = 'skin-card' + (id === _stgCurrentSkinId ? ' active' : '');
    const colors = _STG_SKIN_PREVIEWS[id] || _STG_SKIN_PREVIEWS.default;
    card.innerHTML = `
      <div class="skin-preview">
        <div class="swatch" style="background:${colors[0]}"></div>
        <div class="swatch" style="background:${colors[1]}"></div>
        <div class="swatch" style="background:${colors[2]}"></div>
        <div class="swatch" style="background:${colors[3]}"></div>
        <div class="swatch" style="background:${colors[4]}"></div>
      </div>
      <div class="skin-name">${theme.name}</div>
      <div class="skin-desc">${_STG_SKIN_DESCRIPTIONS[id] || ''}</div>
    `;
    card.addEventListener('click', () => _stgSelectSkin(id));
    grid.appendChild(card);
  }
}

async function _stgSelectSkin(skinId) {
  if (skinId === _stgCurrentSkinId) return;
  _stgCurrentSkinId = skinId;
  _stgRenderSkinGrid();
  _stgApplyTheme(skinId);
  await window.pocketAgent.settings.set('ui.skin', skinId);
}

function _stgApplyTheme(skinId) {
  if (!_stgThemesCache) return;
  const theme = _stgThemesCache[skinId];
  const root = document.documentElement;
  if (!theme || !theme.palette) {
    const props = ['bg-primary','bg-secondary','bg-tertiary','border','text-primary','text-secondary','text-muted','accent','accent-secondary','accent-hover','error','success','warning','orange','user-bubble','user-bubble-solid','assistant-bubble'];
    for (const p of props) root.style.removeProperty('--' + p);
    return;
  }
  for (const [key, value] of Object.entries(theme.palette)) {
    root.style.setProperty('--' + key, value);
  }
}


// Listen for open-settings from main process (tray menu, etc.)
if (window.pocketAgent?.app?.onOpenSettings) {
  window.pocketAgent.app.onOpenSettings((tab) => {
    showSettingsPanel(tab);
  });
}
