import { app, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { getWindow } from '../windows';

/**
 * Dev-only screenshot/resize hook for the running app.
 *
 * OS-level screen capture and Accessibility-based automation are unreliable
 * from an outside sandbox (wrong-display captures, empty a11y trees). This
 * gives an *internal* capture path instead: the renderer calls
 * `window.pocketAgent.debug.capture()` (itself reachable from outside via
 * Electron's --remote-debugging-port + CDP `Runtime.evaluate`, no OS APIs
 * involved), main calls `webContents.capturePage()` on the real
 * BrowserWindow, and the PNG lands on disk at a known path.
 *
 * Double-gated so this never ships as an attack surface:
 *   1. `!app.isPackaged` — never registered in a built/distributed app.
 *   2. `POCKET_AGENT_DEBUG_CAPTURE=1` — opt-in even in dev, so a plain
 *      `npm run dev` doesn't silently expose it either.
 */
export function registerDebugIPC(): void {
  if (app.isPackaged || process.env.POCKET_AGENT_DEBUG_CAPTURE !== '1') return;

  const captureDir = path.join(app.getPath('userData'), 'debug-captures');

  ipcMain.handle('debug:capture', async (_event, windowId: string, name?: string) => {
    const win = getWindow(windowId);
    if (!win) throw new Error(`[debug:capture] No window registered as "${windowId}"`);

    // A CDP-driven capture session never gives the window real OS focus, and
    // Chromium stops compositing fresh frames for an occluded/unfocused
    // window (backing-store throttling) — capturePage() would otherwise
    // return a stale frame from before the window lost focus, silently
    // showing pre-interaction UI state. Bringing it to front (an Electron
    // window-management call, not an OS Accessibility API) forces a real
    // paint before we grab it.
    win.show();
    win.focus();
    await win.webContents.executeJavaScript(
      'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))'
    );

    fs.mkdirSync(captureDir, { recursive: true });
    const image = await win.webContents.capturePage();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = (name || 'capture').replace(/[^a-z0-9_-]/gi, '-');
    const filePath = path.join(captureDir, `${stamp}-${safeName}.png`);
    fs.writeFileSync(filePath, image.toPNG());
    return filePath;
  });

  ipcMain.handle(
    'debug:resize',
    async (_event, windowId: string, width: number, height: number) => {
      const win = getWindow(windowId);
      if (!win) throw new Error(`[debug:resize] No window registered as "${windowId}"`);
      win.setSize(Math.round(width), Math.round(height));
      return win.getBounds();
    }
  );

  console.log(`[Main] Debug capture IPC enabled — screenshots write to ${captureDir}`);
}
