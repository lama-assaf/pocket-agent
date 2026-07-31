// e2e/adhoc-docs-import-run.mjs
// Ad-hoc, one-off standalone runner (not part of the committed spec suite):
// invokes the real compiled docs-import pipeline (dist/clients/docs-import.js)
// against the REAL userData clients dirs, with the Electron app quit. No UI,
// no memory ingestion (ingestToMemory:false — no live Electron memory DB in a
// standalone script). Reports copied/skipped files per client.
import path from 'path';
import os from 'os';
import { setClientsRoot } from '../dist/clients/paths.js';
import { importDocsIntoClient, SecretScanError } from '../dist/clients/docs-import.js';

const REAL_USER_DATA = path.join(os.homedir(), 'Library/Application Support/pocket-agent');
setClientsRoot(path.join(REAL_USER_DATA, 'clients'));

const jobs = [
  {
    clientId: 'zilliqa',
    sourceDir: '/Users/zilliqa/Desktop/workhere/Zilliqa-comms',
    excludes: [],
  },
  {
    clientId: 'ltin',
    sourceDir: '/Users/zilliqa/Desktop/workhere/LTIN-comms',
    // Ops/deployment scaffolding for the self-hosted Obsidian LiveSync stack,
    // not brand/comms doc content — excluded to keep the brain repo focused
    // and to avoid the .env.example placeholder tripping the secret scan.
    // `plugins` = installed Obsidian community-plugin binaries (third-party
    // minified JS, not vault content) — one (calendar-bases/main.js) tripped
    // the secret scan on a false-positive "password" string in its bundle.
    excludes: ['livesync-stack', 'share-stack', 'plugins'],
  },
];

for (const job of jobs) {
  console.log(`\n=== importDocsIntoClient(${job.clientId}) ===`);
  console.log(`sourceDir: ${job.sourceDir}`);
  console.log(`extra excludes: ${JSON.stringify(job.excludes)}`);
  try {
    const result = await importDocsIntoClient({
      clientId: job.clientId,
      sourceDir: job.sourceDir,
      excludes: job.excludes,
      ingestToMemory: false,
    });
    console.log(`copiedFiles: ${result.copiedFiles.length}`);
    console.log(`skippedReservedPaths: ${result.skippedReservedPaths.length}`);
    if (result.skippedReservedPaths.length) {
      console.log(JSON.stringify(result.skippedReservedPaths, null, 2));
    }
    console.log(`ingestedFiles: ${result.ingestedFiles}`);
  } catch (err) {
    if (err instanceof SecretScanError) {
      console.error(`SECRET SCAN REFUSED for ${job.clientId}:`);
      for (const o of err.offending) console.error(`  ${o.path} (${o.rule})`);
      process.exitCode = 1;
    } else {
      console.error(`FAILED for ${job.clientId}: ${err.message}`);
      process.exitCode = 1;
    }
  }
}
