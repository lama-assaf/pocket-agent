#!/usr/bin/env node
// Standalone real-ABI check, run as a fresh child process by
// check-native-node.cjs — see that file's doc comment for why this must
// never run twice in the SAME process as a restore/rebuild step.
const { canOpenBetterSqlite } = require('./native-check-lib.cjs');
const result = canOpenBetterSqlite();
if (result.ok) {
  process.exit(0);
} else {
  console.error(result.message);
  process.exit(1);
}
