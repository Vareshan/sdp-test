// Rebuilds the better-sqlite3 native binding from source when no prebuilt
// binary matches the local Node.js build (e.g. distro-patched
// NODE_MODULE_VERSION) or when the original install scripts could not run.
//
// Usage: npm run rebuild:native
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function loads() {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.exec('CREATE TABLE probe (x)');
    db.close();
    return true;
  } catch {
    return false;
  }
}

if (loads()) {
  console.log('better-sqlite3 native binding OK (nothing to do)');
  process.exit(0);
}

// Prefer local Node headers when present (standard Linux locations),
// otherwise let node-gyp fetch headers matching this Node version.
let nodedir = null;
for (const dir of ['/usr', '/usr/local']) {
  const header = path.join(dir, 'include', 'node', 'node_version.h');
  if (existsSync(header)) {
    const m = readFileSync(header, 'utf8').match(/define NODE_MODULE_VERSION (\d+)/);
    console.log(`Using local Node headers: ${header} (NODE_MODULE_VERSION ${m ? m[1] : '?'})`);
    nodedir = dir;
    break;
  }
}

const pkgDir = path.dirname(require.resolve('better-sqlite3/package.json'));
const args = ['--yes', 'node-gyp@10.3.1', 'rebuild', '--release'];
if (nodedir) args.push(`--nodedir=${nodedir}`);

console.log('Rebuilding better-sqlite3 from source (this can take a few minutes)...');
const result = spawnSync('npx', args, { cwd: pkgDir, stdio: 'inherit' });

if (result.status !== 0 || !loads()) {
  console.error('Rebuild failed. Ensure make, a C++ compiler and Python 3 are installed.');
  process.exit(1);
}
console.log('better-sqlite3 rebuilt OK');
