// src/clients/vault-setup.ts
// Makes a client repo double as a proper Obsidian vault: writes a
// `.gitignore` (per-machine Obsidian workspace state + .DS_Store) and a
// minimal `.obsidian/{app,core-plugins,appearance}.json` — but only when
// each is absent. Idempotent by construction: re-running on a vault a human
// has already opened/customized in Obsidian never overwrites their config.

import fs from 'fs';
import path from 'path';
import { clientPaths } from './paths';

/**
 * `.gitignore` written for a client repo that doubles as an Obsidian vault.
 * Only the per-machine workspace files are ignored — themes/plugins/appearance
 * config (app.json, core-plugins.json, appearance.json, etc.) are meant to be
 * shared and versioned like everything else in the repo.
 */
export const VAULT_GITIGNORE_CONTENT = `.obsidian/workspace.json
.obsidian/workspace-mobile.json
.DS_Store
`;

/**
 * Minimal valid content for each scaffolded `.obsidian/*.json` file. Not
 * meant to be exhaustive — just enough that Obsidian opens the repo as a
 * normal vault with a sane default plugin set, rather than an unconfigured
 * folder.
 */
const DEFAULT_OBSIDIAN_FILES: Record<string, string> = {
  'app.json': '{}\n',
  'appearance.json': '{}\n',
  'core-plugins.json':
    JSON.stringify(
      [
        'file-explorer',
        'global-search',
        'switcher',
        'graph',
        'backlink',
        'outgoing-link',
        'tag-pane',
        'page-preview',
        'templates',
        'note-composer',
        'command-palette',
        'markdown-importer',
        'outline',
        'word-count',
        'file-recovery',
      ],
      null,
      2
    ) + '\n',
};

export interface EnsureVaultResult {
  /** True if .gitignore did not exist and was created. */
  gitignoreWritten: boolean;
  /** Which .obsidian/*.json files did not exist and were created (may be empty). */
  obsidianFilesWritten: string[];
}

/**
 * Ensure `<clientRoot>` has a `.gitignore` and a minimal `.obsidian/` config
 * so it opens as a working vault. Never touches a file that already exists —
 * safe to call on every client-repo setup/pull, not just once at creation.
 */
export function ensureObsidianVault(clientId: string): EnsureVaultResult {
  const rootDir = clientPaths(clientId).rootDir;
  const result: EnsureVaultResult = { gitignoreWritten: false, obsidianFilesWritten: [] };

  const gitignorePath = path.join(rootDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.mkdirSync(rootDir, { recursive: true });
    fs.writeFileSync(gitignorePath, VAULT_GITIGNORE_CONTENT, 'utf-8');
    result.gitignoreWritten = true;
  }

  const obsidianDir = path.join(rootDir, '.obsidian');
  for (const [filename, content] of Object.entries(DEFAULT_OBSIDIAN_FILES)) {
    const abs = path.join(obsidianDir, filename);
    if (!fs.existsSync(abs)) {
      fs.mkdirSync(obsidianDir, { recursive: true });
      fs.writeFileSync(abs, content, 'utf-8');
      result.obsidianFilesWritten.push(filename);
    }
  }

  return result;
}
