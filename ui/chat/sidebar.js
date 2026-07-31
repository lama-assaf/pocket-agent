/* Sidebar toggle logic */
(function () {
  const sidebar = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('sidebar-toggle-btn');

  if (!sidebar || !toggleBtn) return;

  // Restore saved state
  const saved = localStorage.getItem('sidebar-collapsed');
  if (saved === 'true') {
    sidebar.classList.add('collapsed');
  }

  toggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('collapsed'));
    // A manual toggle always wins over the responsive auto-collapse — stop
    // treating the current state as "just auto-collapsed by a narrow window".
    window._sidebarAutoCollapsed = false;
  });
})();

// Auto-collapse the sidebar whenever a panel (Settings / Brain / Routines /
// Personalize) is opened, and restore the user's saved preference on close.
// Exposed for the panel show/hide functions to call.
window._sidebarEnterPanelMode = function () {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebar.classList.add('collapsed');
};

window._sidebarExitPanelMode = function () {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const saved = localStorage.getItem('sidebar-collapsed');
  // A narrow window always wins over a saved "expanded" preference on exit —
  // don't pop back to an expanded sidebar that would immediately clip the
  // chat/composer underneath it. Only mark this as an auto-collapse (not the
  // user's manual choice) when the saved preference disagrees — a genuine
  // manual-collapse preference is left alone and must NOT later be flipped
  // back to expanded by applyResponsiveCollapse() just because the window
  // widens again.
  if (window.innerWidth < window._SIDEBAR_AUTO_COLLAPSE_BREAKPOINT) {
    sidebar.classList.add('collapsed');
    if (saved !== 'true') window._sidebarAutoCollapsed = true;
    return;
  }
  if (saved === 'true') {
    sidebar.classList.add('collapsed');
  } else {
    sidebar.classList.remove('collapsed');
  }
};

// ---- Responsive auto-collapse ----
// Below this width the expanded (220px) sidebar plus a usable chat/composer
// no longer both fit — collapse to the 48px icon rail automatically, without
// touching the user's saved manual preference. Widening back out restores it,
// but only if THIS code collapsed it (a manual collapse while narrow is left
// alone, so a deliberate user choice in the moment is never fought).
(function () {
  window._SIDEBAR_AUTO_COLLAPSE_BREAKPOINT = 900;
  window._sidebarAutoCollapsed = false;

  function applyResponsiveCollapse() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    const narrow = window.innerWidth < window._SIDEBAR_AUTO_COLLAPSE_BREAKPOINT;
    if (narrow && !sidebar.classList.contains('collapsed')) {
      sidebar.classList.add('collapsed');
      window._sidebarAutoCollapsed = true;
    } else if (!narrow && window._sidebarAutoCollapsed) {
      sidebar.classList.remove('collapsed');
      window._sidebarAutoCollapsed = false;
    }
  }

  window.addEventListener('resize', applyResponsiveCollapse);
  // Run once on load, after the manual-preference restore above.
  applyResponsiveCollapse();
})();
