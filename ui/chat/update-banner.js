/**
 * Small in-app affordance for a downloaded update, separate from the
 * Settings > Updates panel (ui/chat/settings-panel.js): shows a dismissible
 * banner reading "Update available — restart to apply" once a background
 * download finishes, with a Restart Now button. Never restarts on its own —
 * only the user's click calls updater.install().
 */

let _updBannerDismissedVersion = null;
let _updBannerCleanup = null;

function _updBannerShow(versionText) {
  const banner = document.getElementById('update-banner');
  const textEl = document.getElementById('update-banner-text');
  if (!banner) return;
  if (textEl) {
    textEl.textContent = versionText
      ? `Update ${versionText} available — restart to apply`
      : 'Update available — restart to apply';
  }
  banner.classList.remove('hidden');
}

function _updBannerHide() {
  const banner = document.getElementById('update-banner');
  if (banner) banner.classList.add('hidden');
}

function _updBannerHandleStatus(status) {
  if (!status) return;

  if (status.status === 'downloaded') {
    const version = status.info?.version || null;
    if (version && version === _updBannerDismissedVersion) return;
    _updBannerShow(version);
    return;
  }

  // Any other status (checking/available/downloading/error/not-available/
  // unsupported - unsigned macOS builds can never reach 'downloaded')
  // means there's nothing ready to install yet — keep the banner hidden.
  _updBannerHide();
}

// eslint-disable-next-line no-unused-vars
async function updBannerRestart() {
  const btn = document.getElementById('update-banner-restart-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Restarting…'; }
  try {
    await window.pocketAgent.updater.install();
  } catch (err) {
    console.error('[UpdateBanner] Failed to install update:', err);
    if (btn) { btn.disabled = false; btn.textContent = 'Restart Now'; }
  }
}

// eslint-disable-next-line no-unused-vars
function updBannerDismiss() {
  window.pocketAgent.updater
    .getStatus()
    .then((status) => {
      _updBannerDismissedVersion = status?.info?.version || 'unknown';
    })
    .catch(() => {
      _updBannerDismissedVersion = 'unknown';
    });
  _updBannerHide();
}

function initUpdateBanner() {
  if (!window.pocketAgent?.updater) return;
  if (_updBannerCleanup) _updBannerCleanup();
  if (window.pocketAgent.updater.onStatus) {
    _updBannerCleanup = window.pocketAgent.updater.onStatus(_updBannerHandleStatus);
  }
  window.pocketAgent.updater
    .getStatus()
    .then(_updBannerHandleStatus)
    .catch(() => {});
}

window.addEventListener('DOMContentLoaded', initUpdateBanner);
