/**
 * Unit tests for the tray module — focused on the Windows-specific code
 * paths (icon sizing, template-image guards) since Electron's Tray/
 * nativeImage behavior differs meaningfully between macOS and Windows and
 * this module previously had one unguarded macOS-only call
 * (nativeImage.setTemplateImage) in each icon-building helper.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { trayInstanceMock, nativeImageMocks } = vi.hoisted(() => {
  const trayInstanceMock = {
    setToolTip: vi.fn(),
    on: vi.fn(),
    setContextMenu: vi.fn(),
  };
  const makeFakeImage = () => {
    const img: Record<string, unknown> = {};
    img.isEmpty = vi.fn(() => false);
    img.resize = vi.fn(() => img);
    img.toPNG = vi.fn(() => Buffer.from('png'));
    img.setTemplateImage = vi.fn();
    img.addRepresentation = vi.fn();
    return img;
  };
  return { trayInstanceMock, nativeImageMocks: { makeFakeImage } };
});

vi.mock('electron', () => {
  const TrayCtor = vi.fn().mockImplementation(function TrayMock() {
    return trayInstanceMock;
  });
  return {
    Tray: TrayCtor,
    Menu: { buildFromTemplate: vi.fn(() => ({})) },
    nativeImage: {
      createFromPath: vi.fn(() => nativeImageMocks.makeFakeImage()),
      createFromBuffer: vi.fn(() => nativeImageMocks.makeFakeImage()),
      createEmpty: vi.fn(() => nativeImageMocks.makeFakeImage()),
    },
    app: {
      getVersion: vi.fn(() => '1.0.0'),
      quit: vi.fn(),
    },
  };
});

vi.mock('../../src/agent', () => ({
  AgentManager: {
    isInitialized: vi.fn(() => false),
    getStats: vi.fn(() => null),
  },
}));

// process.platform is read once at module load into IS_WINDOWS/IS_MACOS
// constants — set it before each dynamic import so the module picks up the
// value under test (vi.resetModules() forces a fresh module instance).
function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

const ORIGINAL_PLATFORM = process.platform;

describe('tray', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    setPlatform(ORIGINAL_PLATFORM);
  });

  describe('createTray on Windows', () => {
    it('sizes the tray icon to 16/32px (not macOS 22/44px) and never calls setTemplateImage', async () => {
      setPlatform('win32');
      const { createTray, initTray } = await import('../../src/main/tray');
      initTray({
        openChatWindow: vi.fn(),
        openSettingsWindow: vi.fn(),
        restartAgent: vi.fn(async () => {}),
        showNotification: vi.fn(),
      });

      const electron = await import('electron');
      await createTray();

      const nativeImage = electron.nativeImage as unknown as {
        createEmpty: ReturnType<typeof vi.fn>;
      };
      const emptyIconResult = nativeImage.createEmpty.mock.results[0]?.value;
      expect(emptyIconResult.addRepresentation).toHaveBeenCalledWith(
        expect.objectContaining({ scaleFactor: 1, width: 16, height: 16 })
      );
      expect(emptyIconResult.addRepresentation).toHaveBeenCalledWith(
        expect.objectContaining({ scaleFactor: 2, width: 32, height: 32 })
      );
      // setTemplateImage is a macOS-only concern (menu bar dark/light
      // auto-invert) — must never be called on the Windows icon.
      expect(emptyIconResult.setTemplateImage).not.toHaveBeenCalled();
    });
  });

  describe('createTray on macOS', () => {
    it('sizes the tray icon to 22/44px and marks it as a template image', async () => {
      setPlatform('darwin');
      const { createTray, initTray } = await import('../../src/main/tray');
      initTray({
        openChatWindow: vi.fn(),
        openSettingsWindow: vi.fn(),
        restartAgent: vi.fn(async () => {}),
        showNotification: vi.fn(),
      });

      const electron = await import('electron');
      await createTray();

      const nativeImage = electron.nativeImage as unknown as {
        createEmpty: ReturnType<typeof vi.fn>;
      };
      const emptyIconResult = nativeImage.createEmpty.mock.results[0]?.value;
      expect(emptyIconResult.addRepresentation).toHaveBeenCalledWith(
        expect.objectContaining({ scaleFactor: 1, width: 22, height: 22 })
      );
      expect(emptyIconResult.setTemplateImage).toHaveBeenCalledWith(true);
    });
  });

  describe('createDefaultIcon fallback (icon files fail to load)', () => {
    it('does not call setTemplateImage on Windows', async () => {
      setPlatform('win32');
      const electron = await import('electron');
      const nativeImage = electron.nativeImage as unknown as {
        createFromPath: ReturnType<typeof vi.fn>;
        createFromBuffer: ReturnType<typeof vi.fn>;
      };
      nativeImage.createFromPath.mockImplementation(() => {
        const img = nativeImageMocks.makeFakeImage();
        (img.isEmpty as ReturnType<typeof vi.fn>).mockReturnValue(true);
        return img;
      });

      const { createTray, initTray } = await import('../../src/main/tray');
      initTray({
        openChatWindow: vi.fn(),
        openSettingsWindow: vi.fn(),
        restartAgent: vi.fn(async () => {}),
        showNotification: vi.fn(),
      });
      await createTray();

      const bufferIconResult = nativeImage.createFromBuffer.mock.results[0]?.value;
      expect(bufferIconResult.setTemplateImage).not.toHaveBeenCalled();
    });

    it('calls setTemplateImage on macOS', async () => {
      setPlatform('darwin');
      const electron = await import('electron');
      const nativeImage = electron.nativeImage as unknown as {
        createFromPath: ReturnType<typeof vi.fn>;
        createFromBuffer: ReturnType<typeof vi.fn>;
      };
      nativeImage.createFromPath.mockImplementation(() => {
        const img = nativeImageMocks.makeFakeImage();
        (img.isEmpty as ReturnType<typeof vi.fn>).mockReturnValue(true);
        return img;
      });

      const { createTray, initTray } = await import('../../src/main/tray');
      initTray({
        openChatWindow: vi.fn(),
        openSettingsWindow: vi.fn(),
        restartAgent: vi.fn(async () => {}),
        showNotification: vi.fn(),
      });
      await createTray();

      const bufferIconResult = nativeImage.createFromBuffer.mock.results[0]?.value;
      expect(bufferIconResult.setTemplateImage).toHaveBeenCalledWith(true);
    });
  });
});
