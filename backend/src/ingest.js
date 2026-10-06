import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import AdmZip from 'adm-zip';

import { db, REPOS_DIR } from './db.js';
import { streamGitLog } from './gitparse.js';

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0' };

export function repoDirFor(repoId) {
  return path.join(REPOS_DIR, String(repoId));
}

export function gitDirFor(repo) {
  return path.join(repoDirFor(repo.id), repo.git_subdir || '');
}

const updStatus = db.prepare('UPDATE repos SET status = ?, progress = ?, error = ? WHERE id = ?');
const updMeta = db.prepare('UPDATE repos SET head = ?, branch = ? WHERE id = ?');
const updSubdir = db.prepare('UPDATE repos SET git_subdir = ? WHERE id = ?');
const updDone = db.prepare("UPDATE repos SET status = 'ready', progress = 1, error = NULL, commit_count = ? WHERE id = ?");

const insCommit = db.prepare(
  'INSERT INTO commits (repo_id, hash, author_name, author_email, author_key, committer_ts) VALUES (?, ?, ?, ?, ?, ?)'
);
const insFile = db.prepare(
  'INSERT INTO file_changes (repo_id, commit_id, path, parent_dir, name, added, removed) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const insDir = db.prepare(
  'INSERT INTO dir_changes (repo_id, commit_id, path, parent_dir, name, added, removed) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const insAuthor = db.prepare(
  'INSERT OR REPLACE INTO authors (repo_id, key, name, email, commit_count, modifications, added, removed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);

const flushBatch = db.transaction((repoId, batch) => {
  for (const c of batch) {
    const authorKey = `${c.name} <${c.email}>`;
    const info = insCommit.run(repoId, c.hash, c.name, c.email, authorKey, c.ts);
    const commitId = info.lastInsertRowid;
    for (const f of c.files) {
      const slash = f.path.lastIndexOf('/');
      const parent = slash === -1 ? '' : f.path.slice(0, slash);
      const name = slash === -1 ? f.path : f.path.slice(slash + 1);
      insFile.run(repoId, commitId, f.path, parent, name, f.added, f.removed);
    }
    for (const [dirPath, v] of c.dirs) {
      const slash = dirPath.lastIndexOf('/');
      const parent = dirPath === '' ? null : slash === -1 ? '' : dirPath.slice(0, slash);
      const name = dirPath === '' ? '' : slash === -1 ? dirPath : dirPath.slice(slash + 1);
      insDir.run(repoId, commitId, dirPath, parent, name, v.added, v.removed);
    }
  }
});

function setStatus(repoId, status, progress, error = null) {
  updStatus.run(status, progress, error, repoId);
}

function findGitRoot(dir) {
  if (fs.existsSync(path.join(dir, '.git'))) {
    if (fs.statSync(path.join(dir, '.git')).isDirectory()) return '';
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = path.join(dir, entry.name);
    const dotGit = path.join(child, '.git');
    if (fs.existsSync(dotGit) && fs.statSync(dotGit).isDirectory()) return entry.name;
  }
  return null;
}

function git(repoGitDir, args) {
  return spawnSync('git', args, { cwd: repoGitDir, env: GIT_ENV, encoding: 'utf8' });
}

function cloneRemote(url, destDir, repoId) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['clone', '--progress', '--', url, destDir], { env: GIT_ENV });
    let stderr = '';
    let lastWrite = 0;
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 100000) stderr = stderr.slice(-100000);
      const m = stderr.match(/(?:Receiving objects|Resolving deltas):\s+(\d+)%/g);
      if (m) {
        const last = m[m.length - 1].match(/(\d+)%/);
        const now = Date.now();
        if (last && now - lastWrite > 250) {
          lastWrite = now;
          const pct = Math.min(100, parseInt(last[1], 10));
          setStatus(repoId, 'cloning', 0.03 + 0.19 * (pct / 100));
        }
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      const fatal = stderr.split('\n').find((l) => /fatal:|error:/i.test(l)) || stderr.trim().split('\n')[0];
      reject(new Error(`git clone failed: ${(fatal || 'unknown error').trim()}`));
    });
  });
}

async function runIngest(repoId, opts) {
  const repo = db.prepare('SELECT * FROM repos WHERE id = ?').get(repoId);
  if (!repo) return;
  const destDir = repoDirFor(repoId);
  fs.mkdirSync(destDir, { recursive: true });

  try {
    if (repo.source_type === 'clone') {
      setStatus(repoId, 'cloning', 0.03);
      await cloneRemote(repo.source, destDir, repoId);
      updSubdir.run('', repoId);
      setStatus(repoId, 'parsing', 0.23);
    } else {
      setStatus(repoId, 'extracting', 0.03);
      const zip = new AdmZip(opts.zipPath);
      zip.extractAllTo(destDir, true);
      const sub = findGitRoot(destDir);
      if (sub === null) {
        throw new Error('Zip does not contain a .git directory (a zip of a Git repository is required).');
      }
      updSubdir.run(sub, repoId);
      setStatus(repoId, 'parsing', 0.23);
    }
  } finally {
    if (opts.zipPath) fs.rmSync(opts.zipPath, { force: true });
  }

  const gitDir = path.join(destDir, db.prepare('SELECT git_subdir FROM repos WHERE id = ?').get(repoId).git_subdir || '');

  // The revision to analyse: HEAD by default, or an explicit branch/tag/hash
  // supplied by the user (e.g. the commit from the sample metrics).
  const wanted = String(opts.ref || '').trim();
  let rev = 'HEAD';
  if (wanted) {
    if (wanted.startsWith('-')) {
      throw new Error('Invalid reference: provide a branch name, tag or commit hash.');
    }
    const refRes = git(gitDir, ['rev-parse', '--verify', `${wanted}^{commit}`]);
    if (refRes.status !== 0) {
      throw new Error(`Reference "${wanted}" was not found in this repository.`);
    }
    rev = refRes.stdout.trim();
  }

  const headRes = git(gitDir, ['rev-parse', '--verify', rev]);
  if (headRes.status !== 0) {
    throw new Error('Not a usable Git repository: no HEAD commit found.');
  }
  const head = headRes.stdout.trim();

  const branchRes = git(gitDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = branchRes.status === 0 ? branchRes.stdout.trim() : null;

  const countRes = git(gitDir, ['rev-list', '--count', '--no-merges', rev]);
  if (countRes.status !== 0) {
    throw new Error('Failed to count commits in the repository.');
  }
  const total = parseInt(countRes.stdout.trim(), 10) || 0;

  updMeta.run(head, branch, repoId);

  const authors = new Map();
  let batch = [];
  let parsed = 0;

  await streamGitLog(gitDir, rev, {
    totalCommits: total,
    onProgress: (done, tot) => {
      setStatus(repoId, 'parsing', 0.25 + 0.7 * (done / Math.max(1, tot)));
    },
    onCommit: (c) => {
      parsed++;
      let fileAdded = 0;
      let fileRemoved = 0;
      for (const f of c.files) {
        fileAdded += f.added;
        fileRemoved += f.removed;
      }
      const key = `${c.name} <${c.email}>`;
      let a = authors.get(key);
      if (!a) {
        a = { key, name: c.name, email: c.email, commit_count: 0, modifications: 0, added: 0, removed: 0 };
        authors.set(key, a);
      }
      a.commit_count++;
      if (fileAdded + fileRemoved > 0) a.modifications++;
      a.added += fileAdded;
      a.removed += fileRemoved;

      batch.push(c);
      if (batch.length >= 1000) {
        const current = batch;
        batch = [];
        flushBatch(repoId, current);
      }
    },
  });

  if (batch.length) flushBatch(repoId, batch);

  setStatus(repoId, 'indexing', 0.97);
  const writeAuthors = db.transaction((rows) => {
    for (const a of rows) {
      insAuthor.run(repoId, a.key, a.name, a.email, a.commit_count, a.modifications, a.added, a.removed);
    }
  });
  writeAuthors([...authors.values()]);

  updDone.run(parsed, repoId);
}

const queue = [];
const jobOpts = new Map();
let running = false;

export function enqueueIngest(repoId, opts = {}) {
  jobOpts.set(repoId, opts);
  queue.push(repoId);
  pump();
}

function pump() {
  if (running) return;
  const id = queue.shift();
  if (id === undefined) return;
  running = true;
  const opts = jobOpts.get(id) || {};
  jobOpts.delete(id);
  runIngest(id, opts)
    .catch((err) => {
      const message = String(err?.message || err).slice(0, 400);
      try {
        setStatus(id, 'error', 0, message);
      } catch {
        // nothing further to do
      }
    })
    .finally(() => {
      running = false;
      setImmediate(pump);
    });
}

export function recoverInterrupted() {
  db.prepare(
    "UPDATE repos SET status = 'error', error = 'Interrupted by a server restart - please delete and add the repository again.' WHERE status IN ('queued', 'cloning', 'extracting', 'parsing', 'indexing')"
  ).run();
}

export function deleteRepoData(repoId) {
  const dir = repoDirFor(repoId);
  fs.rmSync(dir, { recursive: true, force: true });
  db.transaction(() => {
    db.prepare('DELETE FROM file_changes WHERE repo_id = ?').run(repoId);
    db.prepare('DELETE FROM dir_changes WHERE repo_id = ?').run(repoId);
    db.prepare('DELETE FROM author_merges WHERE repo_id = ?').run(repoId);
    db.prepare('DELETE FROM authors WHERE repo_id = ?').run(repoId);
    db.prepare('DELETE FROM commits WHERE repo_id = ?').run(repoId);
    db.prepare('DELETE FROM repos WHERE id = ?').run(repoId);
  })();
}

// ---------- manual author merges ----------

function parseIdentity(key) {
  const m = key.match(/^(.*?)\s*<([^>]*)>$/);
  return m ? { name: m[1], email: m[2] } : { name: key, email: '' };
}

// Follows merge chains so merges always store the final target identity.
function resolveTarget(repoId, key) {
  const get = db.prepare('SELECT target_key FROM author_merges WHERE repo_id = ? AND source_key = ?');
  let cur = key;
  for (let i = 0; i < 50; i++) {
    const row = get.get(repoId, cur);
    if (!row) return cur;
    cur = row.target_key;
  }
  return cur;
}

// Rewrites commit authorship to the merged identities and rebuilds the
// precomputed authors table from the commits + per-commit churn (root rows).
function rebuildIdentities(repoId) {
  const merges = db.prepare('SELECT source_key, target_key FROM author_merges WHERE repo_id = ?').all(repoId);
  if (!merges.length) return;

  const updCommits = db.prepare(
    'UPDATE commits SET author_key = ?, author_name = ?, author_email = ? WHERE repo_id = ? AND author_key = ?'
  );
  for (const m of merges) {
    if (m.source_key === m.target_key) continue;
    const id = parseIdentity(m.target_key);
    updCommits.run(m.target_key, id.name, id.email, repoId, m.source_key);
  }

  const rows = db
    .prepare(
      `SELECT c.author_key AS key, c.author_name AS name, c.author_email AS email,
              COUNT(*) AS commit_count,
              COALESCE(SUM(CASE WHEN t.churn > 0 THEN 1 ELSE 0 END), 0) AS modifications,
              COALESCE(SUM(t.added), 0) AS added, COALESCE(SUM(t.removed), 0) AS removed
       FROM commits c
       LEFT JOIN (
         SELECT commit_id, added, removed, added + removed AS churn
         FROM dir_changes WHERE repo_id = ? AND path = ''
       ) t ON t.commit_id = c.id
       WHERE c.repo_id = ?
       GROUP BY c.author_key`
    )
    .all(repoId, repoId);

  db.prepare('DELETE FROM authors WHERE repo_id = ?').run(repoId);
  const ins = db.prepare(
    'INSERT INTO authors (repo_id, key, name, email, commit_count, modifications, added, removed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const r of rows) ins.run(repoId, r.key, r.name, r.email, r.commit_count, r.modifications, r.added, r.removed);
}

// Folds one author identity (source_key) into another (target_key).
export function mergeAuthors(repoId, sourceKey, targetKey) {
  const exists = db.prepare('SELECT 1 AS x FROM authors WHERE repo_id = ? AND key = ?');
  if (!exists.get(repoId, sourceKey)) throw new Error('Source author not found in this repository.');
  if (!exists.get(repoId, targetKey)) throw new Error('Target author not found in this repository.');
  if (sourceKey === targetKey) throw new Error('Source and target authors are identical.');

  const target = resolveTarget(repoId, targetKey);
  if (target === sourceKey) throw new Error('Cannot merge an author into itself.');

  db.transaction(() => {
    // Any merges that pointed at the source now point at the new target.
    db.prepare('UPDATE author_merges SET target_key = ? WHERE repo_id = ? AND target_key = ?').run(
      target,
      repoId,
      sourceKey
    );
    db.prepare('INSERT OR REPLACE INTO author_merges (repo_id, source_key, target_key) VALUES (?, ?, ?)').run(
      repoId,
      sourceKey,
      target
    );
    rebuildIdentities(repoId);
  })();
}
