const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

/**
 * electron-builder afterPack hook to reduce app size
 * Removes unused platform binaries and locale files
 * Supports macOS and Windows builds
 */
exports.default = async function(context) {
  const appOutDir = context.appOutDir;
  const arch = context.arch === 1 ? 'x64' : 'arm64'; // 1 = x64, 3 = arm64
  const platform = process.platform;
  const appName = context.packager.appInfo.productFilename;

  console.log(`[afterPack] Cleaning up for ${platform}-${arch}...`);

  // Determine resource paths based on platform
  let resourcesPath, appPath, executablePath;

  if (platform === 'darwin') {
    resourcesPath = path.join(appOutDir, 'Pocket Agent.app', 'Contents', 'Resources');
    appPath = path.join(resourcesPath, 'app');
    executablePath = path.join(appOutDir, `${appName}.app`, 'Contents', 'MacOS', appName);
  } else {
    // Windows / Linux: flat structure
    resourcesPath = path.join(appOutDir, 'resources');
    appPath = path.join(resourcesPath, 'app');
    executablePath = path.join(appOutDir, `${appName}.exe`);
  }

  // 1. Remove unused ripgrep platform binaries (~41MB savings)
  const ripgrepPath = path.join(appPath, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'vendor', 'ripgrep');
  if (fs.existsSync(ripgrepPath)) {
    const platformMap = {
      darwin: `${arch}-darwin`,
      win32: `${arch}-win32`,
      linux: `${arch}-linux`,
    };
    const keepPlatform = platformMap[platform] || `${arch}-${platform}`;
    const entries = fs.readdirSync(ripgrepPath);

    for (const entry of entries) {
      const entryPath = path.join(ripgrepPath, entry);
      const stat = fs.statSync(entryPath);

      if (stat.isDirectory() && entry !== keepPlatform) {
        console.log(`[afterPack] Removing ripgrep/${entry}`);
        fs.rmSync(entryPath, { recursive: true, force: true });
      }
    }
  }

  // 2. Remove unused locale files (keep only en) - macOS only (.lproj)
  if (platform === 'darwin' && fs.existsSync(resourcesPath)) {
    const localeFiles = fs.readdirSync(resourcesPath).filter(f => f.endsWith('.lproj') && f !== 'en.lproj');
    for (const locale of localeFiles) {
      const localePath = path.join(resourcesPath, locale);
      console.log(`[afterPack] Removing locale ${locale}`);
      fs.rmSync(localePath, { recursive: true, force: true });
    }
  }

  // 3. Remove unnecessary files from node_modules
  const nodeModulesPath = path.join(appPath, 'node_modules');
  if (fs.existsSync(nodeModulesPath)) {
    cleanDirectory(nodeModulesPath, ['.md', '.markdown']);
  }

  // 4. Verify better-sqlite3 was actually rebuilt for Electron's ABI, not
  // whatever plain-Node ABI happened to be on disk when electron-builder ran
  // (see CLAUDE.md's native-module note). If this addon can't dlopen, both
  // SettingsManager.initialize() and `new MemoryManager()` throw at launch —
  // silently, since a packaged app has no visible console — which shows up
  // to a user as "default clients never appeared" and "GitHub won't
  // connect/pull" (both are backed by the same DB), with nothing printed
  // anywhere they can see. Fail the BUILD instead of shipping that.
  verifyNativeModules({ platform, arch, appPath, executablePath });

  console.log('[afterPack] Cleanup complete');
};

/**
 * Actually dlopens the packaged better-sqlite3 addon using the packaged
 * Electron binary itself (via ELECTRON_RUN_AS_NODE), so this validates the
 * exact bits about to ship, under the exact runtime that will load them —
 * not the current CLI's Node version, which proves nothing either way.
 * require()-ing a `.node` file always dlopens synchronously (no lazy-load
 * to route around, unlike requiring the better-sqlite3 package itself), so a
 * clean require is enough proof; no need to open an actual database.
 *
 * Deliberately tolerant of exec failures that AREN'T an ABI mismatch (wrong
 * architecture for this host to execute at all, missing binary, etc.) —
 * those aren't this check's job and cross-arch packaging can legitimately
 * hit them. Only a recognizable ABI-mismatch message fails the build.
 */
function verifyNativeModules({ platform, arch, appPath, executablePath }) {
  if (platform !== 'darwin' && platform !== 'win32') return;

  const nativeModule = path.join(
    appPath,
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node'
  );
  if (!fs.existsSync(nativeModule) || !fs.existsSync(executablePath)) {
    console.log(`[afterPack] Skipping native-module check for ${platform}-${arch} (binary not found)`);
    return;
  }

  const testScript = path.join(os.tmpdir(), `afterpack-native-check-${process.pid}-${Date.now()}.cjs`);
  fs.writeFileSync(
    testScript,
    "try { require(process.argv[2]); process.exit(0); } catch (e) { console.error(e && e.message); process.exit(1); }\n"
  );

  try {
    execFileSync(executablePath, [testScript, nativeModule], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20000,
    });
    console.log(`[afterPack] better-sqlite3 OK for Electron (${platform}-${arch})`);
  } catch (error) {
    const detail = ((error && (error.stderr || error.message)) || '').toString().trim();
    const isAbiMismatch =
      detail.includes('NODE_MODULE_VERSION') ||
      detail.includes('was compiled against') ||
      detail.includes('Module did not self-register');

    if (isAbiMismatch) {
      throw new Error(
        `[afterPack] better-sqlite3 for ${platform}-${arch} was NOT rebuilt for Electron — ` +
          `Settings and Memory (client seeding, GitHub token storage, sync) will silently fail on launch. ` +
          `This means electron-builder's native-module rebuild step was skipped or failed for this arch. ` +
          `Fix: delete node_modules/better-sqlite3/build, run \`npm run rebuild:native\`, and rebuild.\n` +
          `Detail: ${detail}`
      );
    }
    console.warn(
      `[afterPack] Native-module check for ${platform}-${arch} was inconclusive (not necessarily a problem, e.g. this host can't execute that arch's binary):`,
      detail
    );
  } finally {
    try {
      fs.unlinkSync(testScript);
    } catch {
      // best-effort cleanup
    }
  }
}

function cleanDirectory(dir, extensions) {
  if (!fs.existsSync(dir)) return;

  let removed = 0;
  const walk = (currentPath) => {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        // Remove test/docs directories
        if (['test', 'tests', '__tests__', 'docs', 'example', 'examples', '.github'].includes(entry.name)) {
          fs.rmSync(fullPath, { recursive: true, force: true });
          removed++;
          continue;
        }
        walk(fullPath);
      } else if (entry.isFile()) {
        // Remove markdown files (except LICENSE)
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext) && !entry.name.toLowerCase().includes('license')) {
          fs.unlinkSync(fullPath);
          removed++;
        }
      }
    }
  };

  walk(dir);
  if (removed > 0) {
    console.log(`[afterPack] Removed ${removed} unnecessary files/directories`);
  }
}
