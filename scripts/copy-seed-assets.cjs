/**
 * Post-build script: copies bundled seed assets (marketplace pack seeds +
 * default client seeds) into dist/, mirroring their src/ location.
 *
 * Packaged builds get these via electron-builder's `extraResources` (see
 * package.json's `build.extraResources`) — they land at
 * <resources>/seed-plugins and <resources>/seed-clients respectively, so
 * this script doesn't matter for a packaged app.
 *
 * But *unpackaged* runs (dev/start — plain `electron .` against dist/, no
 * process.resourcesPath override) fall back to a path relative to the
 * compiled file's own directory (see src/marketplace/paths.ts's getSeedRoot()
 * and src/clients/seed-loader.ts's getClientSeedRoot()): `dist/marketplace/seed`
 * and `dist/clients/seeds`. tsc only emits .ts -> .js and never copies
 * non-.ts assets (the seed dirs are pure .md/.json/.json), so without this
 * step those dev-mode fallback paths would be empty and the app would
 * silently seed nothing on an unpackaged run.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const copies = [
  { from: path.join(root, 'src', 'marketplace', 'seed'), to: path.join(root, 'dist', 'marketplace', 'seed') },
  { from: path.join(root, 'src', 'clients', 'seeds'), to: path.join(root, 'dist', 'clients', 'seeds') },
];

for (const { from, to } of copies) {
  if (!fs.existsSync(from)) continue;
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
  console.log(`[copy-seed-assets] ${path.relative(root, from)} -> ${path.relative(root, to)}`);
}
