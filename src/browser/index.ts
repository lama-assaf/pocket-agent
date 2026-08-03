/**
 * Browser automation with two tiers
 *
 * The SDK's built-in WebFetch handles simple HTTP requests.
 * This module adds capabilities WebFetch doesn't have:
 *
 * 1. Electron hidden window: JS rendering without interrupting user
 * 2. CDP connection: Access to user's logged-in Chrome sessions
 */

import { ElectronTier } from './electron-tier';
import { CdpTier } from './cdp-tier';
import { BrowserAction, BrowserResult, BrowserTier, BrowserToolInput } from './types';
import { SettingsManager } from '../settings';
// Import the session-context module directly (NOT the `../tools` barrel,
// which itself imports this file — going through the barrel would create an
// import cycle).
import { getCurrentSessionId } from '../tools/session-context';

export * from './types';

export interface BrowserManagerOptions {
  /**
   * Default directory for downloads when an action does not specify one.
   * Injected from the Electron main process (e.g. `app.getPath('downloads')`)
   * so the browser module never has to import Electron itself.
   */
  downloadPath?: string;
}

/**
 * BrowserManager - Orchestrates Electron and CDP tiers
 */
export class BrowserManager {
  private electronTier: ElectronTier | null = null;
  private cdpTier: CdpTier | null = null;
  private lastTier: BrowserTier = 'electron';
  private downloadPath?: string;

  constructor(options: BrowserManagerOptions = {}) {
    this.downloadPath = options.downloadPath;
  }

  /** Update the default downloads directory (propagates to existing tiers). */
  setDownloadPath(downloadPath: string): void {
    this.downloadPath = downloadPath;
    if (this.cdpTier) this.cdpTier.setDownloadPath(downloadPath);
  }

  /**
   * Get or create Electron tier (lazy init)
   */
  private getElectronTier(): ElectronTier {
    if (!this.electronTier) {
      this.electronTier = new ElectronTier();
    }
    return this.electronTier;
  }

  /**
   * Get or create CDP tier (lazy init)
   */
  private getCdpTier(): CdpTier {
    if (!this.cdpTier) {
      this.cdpTier = new CdpTier({ downloadPath: this.downloadPath });
    }
    return this.cdpTier;
  }

  /**
   * Determine the best tier for an action
   */
  private selectTier(action: BrowserAction): BrowserTier {
    // Explicit tier requested
    if (action.tier && (action.tier === 'electron' || action.tier === 'cdp')) {
      console.log(`[Browser] Tier explicitly set to: ${action.tier}`);
      return action.tier;
    }

    // Auth required → CDP
    if (action.requiresAuth) {
      console.log('[Browser] requires_auth=true, selecting CDP');
      return 'cdp';
    }

    // "Use My Browser" setting enabled → prefer CDP
    const useMyBrowserSetting = SettingsManager.get('browser.useMyBrowser');
    console.log(`[Browser] useMyBrowser setting = "${useMyBrowserSetting}"`);
    if (useMyBrowserSetting === 'true') {
      console.log('[Browser] Use My Browser enabled, selecting CDP');
      return 'cdp';
    }

    // If we were already using CDP (for auth), stay there
    if (this.lastTier === 'cdp' && this.cdpTier?.isConnected()) {
      console.log('[Browser] Already on CDP, staying there');
      return 'cdp';
    }

    // Default to Electron for JS rendering
    console.log('[Browser] Defaulting to Electron');
    return 'electron';
  }

  /**
   * Execute a browser action
   */
  async execute(action: BrowserAction): Promise<BrowserResult> {
    const tier = this.selectTier(action);
    this.lastTier = tier;

    console.log(`[Browser] Executing "${action.action}" via ${tier} tier`);

    switch (tier) {
      case 'electron':
        return this.getElectronTier().execute(action);

      case 'cdp': {
        const result = await this.getCdpTier().execute(action);
        // If CDP was auto-selected (not explicitly requested) and failed, fall back to Electron
        const isExplicit = action.tier === 'cdp' || action.requiresAuth;
        if (!result.success && !isExplicit && result.error?.includes('CDP connection failed')) {
          console.log(`[Browser] CDP failed, falling back to Electron`);
          this.lastTier = 'electron';
          return this.getElectronTier().execute(action);
        }
        return result;
      }

      default:
        return {
          success: false,
          tier: 'electron',
          error: `Unknown tier: ${tier}`,
        };
    }
  }

  /**
   * Process tool input from agent
   */
  async handleToolInput(input: BrowserToolInput): Promise<BrowserResult> {
    const action: BrowserAction = {
      action: input.action as BrowserAction['action'],
      url: input.url,
      selector: input.selector,
      text: input.text,
      script: input.script,
      extractType: input.extract_type as BrowserAction['extractType'],
      extractSelector: input.extract_selector,
      waitFor: input.wait_for,
      tier: input.tier as BrowserTier,
      requiresAuth: input.requires_auth,
      // New fields
      scrollDirection: input.scroll_direction as BrowserAction['scrollDirection'],
      scrollAmount: input.scroll_amount,
      downloadPath: input.download_path,
      downloadTimeout: input.download_timeout,
      filePath: input.file_path,
      tabId: input.tab_id,
    };

    return this.execute(action);
  }

  /**
   * Force CDP reconnection after system wake/unlock.
   * No-op if CDP tier hasn't been initialized (never used).
   */
  async forceReconnectCdp(): Promise<void> {
    if (this.cdpTier) {
      await this.cdpTier.forceReconnect();
    }
  }

  /**
   * Close all tiers
   */
  close(): void {
    this.electronTier?.close();
    this.cdpTier?.disconnect();
    console.log('[Browser] All tiers closed');
  }
}

// One BrowserManager per session, keyed by the AsyncLocalStorage session ID
// (see src/tools/session-context.ts). This keeps concurrent sessions from
// sharing (and tearing down) one another's Electron/CDP tiers. Call sites
// with no active session context resolve to getCurrentSessionId()'s fallback
// ("default"), which is also what gives backward compatibility to call sites
// that never ran inside runWithSessionId (e.g. app startup, power events).
const browserManagersBySession = new Map<string, BrowserManager>();

// Downloads directory injected once by the Electron main process at startup
// (see src/main/index.ts). Applied to every session's manager — both
// existing ones (late-binding) and any created afterwards — since it reflects
// an OS-level path, not something scoped to a particular session.
let defaultDownloadPath: string | undefined;

export function getBrowserManager(options?: BrowserManagerOptions): BrowserManager {
  if (options?.downloadPath) {
    defaultDownloadPath = options.downloadPath;
  }

  const sessionId = getCurrentSessionId();
  let manager = browserManagersBySession.get(sessionId);
  if (!manager) {
    manager = new BrowserManager({ downloadPath: defaultDownloadPath, ...options });
    browserManagersBySession.set(sessionId, manager);
  } else if (options?.downloadPath) {
    // Late-binding: allow the main process to set the path on an
    // already-created manager for this session.
    manager.setDownloadPath(options.downloadPath);
  }
  return manager;
}

/**
 * Close the current session's browser manager only. Other sessions'
 * managers (and their underlying Electron/CDP tiers) are untouched.
 */
export function closeBrowserManager(): void {
  const sessionId = getCurrentSessionId();
  const manager = browserManagersBySession.get(sessionId);
  manager?.close();
  browserManagersBySession.delete(sessionId);
}

/**
 * Close every session's browser manager. Used for full app shutdown, where
 * all Electron/CDP tiers across all sessions must be torn down.
 */
export function closeAllBrowserManagers(): void {
  for (const manager of browserManagersBySession.values()) {
    manager.close();
  }
  browserManagersBySession.clear();
}

/**
 * Run `fn` against every currently-live session's browser manager. Used for
 * OS-level events (system resume, screen unlock) that affect every open CDP
 * connection, not just one session's.
 */
export function forEachBrowserManager(fn: (manager: BrowserManager) => void): void {
  for (const manager of browserManagersBySession.values()) {
    fn(manager);
  }
}

/**
 * Browser tool definition for Claude Agent SDK
 *
 * Note: For simple page fetching, use the built-in WebFetch tool.
 * This tool is for:
 * - JS-heavy pages that need rendering (Electron)
 * - Pages requiring logged-in sessions (CDP)
 */
export function getBrowserToolDefinition() {
  return {
    name: 'browser',
    description: `Browser automation for JS rendering and authenticated sessions.

Use built-in tools first:
- WebSearch: Search the web
- WebFetch: Fetch page content

Use THIS tool when you need:
- JavaScript rendering (SPAs, dynamic content)
- Screenshots of rendered pages
- Clicking/typing on interactive elements
- Access to user's logged-in browser sessions
- File downloads/uploads
- Multi-tab workflows (CDP tier only)

Actions:
- navigate: Go to URL
- screenshot: Capture page image
- click: Click an element
- type: Enter text in input
- evaluate: Run JavaScript
- extract: Get page data (text/html/links/tables/structured)
- scroll: Scroll page or element
- hover: Hover over element (triggers dropdowns)
- download: Download a file
- upload: Upload file to input
- tabs_list: List open tabs (CDP only)
- tabs_open: Open new tab (CDP only)
- tabs_close: Close a tab (CDP only)
- tabs_focus: Switch to tab (CDP only)

Tiers:
- Electron (default): Hidden window for JS rendering
- CDP: Connects to user's Chrome for logged-in sessions + multi-tab

Set requires_auth=true for pages needing login (uses CDP tier).
For CDP, user must start Chrome with: --remote-debugging-port=9222`,
    input_schema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: [
            'navigate',
            'screenshot',
            'click',
            'type',
            'evaluate',
            'extract',
            'scroll',
            'hover',
            'download',
            'upload',
            'tabs_list',
            'tabs_open',
            'tabs_close',
            'tabs_focus',
          ],
          description: 'The browser action to perform',
        },
        url: {
          type: 'string',
          description: 'URL to navigate to (for navigate, tabs_open, download actions)',
        },
        selector: {
          type: 'string',
          description:
            'CSS selector for element (for click, type, hover, scroll, download, upload)',
        },
        text: {
          type: 'string',
          description: 'Text to type (for type action)',
        },
        script: {
          type: 'string',
          description: 'JavaScript to evaluate (for evaluate action)',
        },
        extract_type: {
          type: 'string',
          enum: ['text', 'html', 'links', 'tables', 'structured'],
          description: 'Type of data to extract (default: structured)',
        },
        extract_selector: {
          type: 'string',
          description: 'CSS selector to extract from (default: body)',
        },
        wait_for: {
          oneOf: [
            { type: 'string', description: 'CSS selector to wait for' },
            { type: 'number', description: 'Milliseconds to wait' },
          ],
          description: 'Wait condition after action',
        },
        tier: {
          type: 'string',
          enum: ['electron', 'cdp'],
          description: 'Force a specific browser tier',
        },
        requires_auth: {
          type: 'boolean',
          description: 'Set true if page requires login (will use CDP tier)',
        },
        scroll_direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right'],
          description: 'Direction to scroll (default: down)',
        },
        scroll_amount: {
          type: 'number',
          description: 'Pixels to scroll (default: 300)',
        },
        download_path: {
          type: 'string',
          description: 'Path to save downloaded file',
        },
        download_timeout: {
          type: 'number',
          description: 'Max ms to wait for download (default: 30000)',
        },
        file_path: {
          type: 'string',
          description: 'Path to file to upload (for upload action)',
        },
        tab_id: {
          type: 'string',
          description: 'Tab ID for tabs_close, tabs_focus actions',
        },
      },
      required: ['action'],
    },
  };
}

/**
 * Browser tool handler for agent
 */
export async function handleBrowserTool(input: unknown): Promise<string> {
  const manager = getBrowserManager();
  const result = await manager.handleToolInput(input as BrowserToolInput);

  // Format result for agent
  if (!result.success) {
    return JSON.stringify({
      error: result.error,
      tier: result.tier,
    });
  }

  const response: Record<string, unknown> = {
    success: true,
    tier: result.tier,
    url: result.url,
  };

  if (result.title) response.title = result.title;
  if (result.text) response.text = result.text;
  if (result.data) response.data = result.data;
  if (result.html) response.html = result.html;
  if (result.screenshot) {
    // Save screenshot to workspace folder
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');
    const timestamp = Date.now();
    const screenshotsDir = path.join(os.homedir(), 'Documents', 'Pocket-agent', 'screenshots');

    // Ensure screenshots directory exists
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }

    const screenshotPath = path.join(screenshotsDir, `screenshot-${timestamp}.png`);
    fs.writeFileSync(screenshotPath, Buffer.from(result.screenshot, 'base64'));
    response.screenshot = `saved to ${screenshotPath}`;
    response.screenshotSize = `${Math.round(result.screenshot.length / 1024)}KB`;
  }
  // New result fields
  if (result.downloadedFile) {
    response.downloadedFile = result.downloadedFile;
    response.downloadSize = result.downloadSize;
  }
  if (result.tabs) response.tabs = result.tabs;
  if (result.tabId) response.tabId = result.tabId;

  return JSON.stringify(response);
}
