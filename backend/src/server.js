import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';

import { db, TMP_DIR } from './db.js';
import { enqueueIngest, recoverInterrupted, deleteRepoData, mergeAuthors } from './ingest.js';
import {
  getRepo,
  listRepos,
  summary,
  tree,
  objectMetrics,
  commitsPage,
  commitFiles,
  authorsList,
  listMerges,
} from './metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;

recoverInterrupted();

const app = express();
app.use(express.json());

const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 1024 * 1024 * 1024 },
});

function repoNameFromUrl(url) {
  const cleaned = url.replace(/\/+$/, '');
  const last = cleaned.split(/[/:]/).pop() || 'repository';
  return last.replace(/\.git$/i, '') || 'repository';
}

// ---- commit-set filters (see metrics.js for the semantics) ----
function parseTs(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function parseList(v, max) {
  return String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
}

// Parses from/to/authors/commits query params into a filter object (or null).
function parseFilter(query) {
  const from = parseTs(query.from);
  const to = parseTs(query.to);
  const authors = parseList(query.authors, 500);
  const commits = parseList(query.commits, 2000);
  if (from == null && to == null && !authors.length && !commits.length) return null;
  return {
    from,
    to,
    authors: authors.length ? authors : null,
    commits: commits.length ? commits : null,
  };
}

function insertRepo(name, sourceType, source) {
  const info = db
    .prepare('INSERT INTO repos (name, source_type, source, created_at) VALUES (?, ?, ?, ?)')
    .run(name, sourceType, source, Math.floor(Date.now() / 1000));
  return Number(info.lastInsertRowid);
}

// Loads the repo for :id routes and enforces that metrics only run on ready repos.
function guard(req, res, next) {
  const repo = getRepo(Number(req.params.id));
  if (!repo) return res.status(404).json({ error: 'Repository not found.' });
  if (repo.status !== 'ready') {
    return res.status(409).json({
      error: `Repository is not ready (status: ${repo.status}).`,
      status: repo.status,
      progress: repo.progress,
    });
  }
  req.repo = repo;
  next();
}

app.get('/api/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, db: true, uptime: process.uptime() });
  } catch (err) {
    res.status(500).json({ ok: false, db: false, error: err.message });
  }
});

app.get('/api/repos', (req, res) => {
  res.json(listRepos());
});

app.post('/api/repos/clone', (req, res, next) => {
  try {
    const url = String(req.body?.url || '').trim();
    if (!/^(https?:\/\/|git@|ssh:\/\/|git:\/\/)\S+/.test(url)) {
      return res.status(400).json({ error: 'Provide a valid clone URL (https://..., git@..., ssh:// or git://).' });
    }
    const id = insertRepo(repoNameFromUrl(url), 'clone', url);
    const ref = String(req.body?.ref || '').trim();
    enqueueIngest(id, ref ? { ref } : {});
    res.status(202).json({ id });
  } catch (err) {
    next(err);
  }
});

app.post('/api/repos/upload', upload.single('file'), (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No zip file uploaded (form field "file").' });
    if (!/\.zip$/i.test(req.file.originalname || '')) {
      fs.rmSync(req.file.path, { force: true });
      return res.status(400).json({ error: 'Only .zip files are accepted.' });
    }
    const name = (req.file.originalname || 'repository.zip').replace(/\.zip$/i, '') || 'repository';
    const id = insertRepo(name, 'zip', req.file.originalname);
    const ref = String(req.body?.ref || '').trim();
    enqueueIngest(id, { zipPath: req.file.path, ...(ref ? { ref } : {}) });
    res.status(202).json({ id });
  } catch (err) {
    next(err);
  }
});

app.get('/api/repos/:id', (req, res) => {
  const repo = getRepo(Number(req.params.id));
  if (!repo) return res.status(404).json({ error: 'Repository not found.' });
  const { git_subdir, ...rest } = repo;
  res.json(rest);
});

app.delete('/api/repos/:id', (req, res, next) => {
  try {
    const repo = getRepo(Number(req.params.id));
    if (!repo) return res.status(404).json({ error: 'Repository not found.' });
    if (repo.status !== 'ready' && repo.status !== 'error') {
      return res.status(409).json({ error: 'Cannot delete a repository while ingestion is in progress.' });
    }
    deleteRepoData(repo.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get('/api/repos/:id/summary', guard, (req, res) => {
  res.json(summary(req.repo.id, parseFilter(req.query)));
});

app.get('/api/repos/:id/tree', guard, (req, res) => {
  const dir = String(req.query.dir ?? '');
  res.json({ dir, children: tree(req.repo.id, dir, parseFilter(req.query)) });
});

app.get('/api/repos/:id/object', guard, (req, res) => {
  const objectPath = String(req.query.path ?? '');
  const type = req.query.type === 'dir' ? 'dir' : 'file';
  res.json({ path: objectPath, type, ...objectMetrics(req.repo.id, objectPath, type, parseFilter(req.query)) });
});

app.get('/api/repos/:id/commits', guard, (req, res) => {
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  // The list ignores the manual commit list so it stays the selection surface.
  res.json(commitsPage(req.repo.id, offset, limit, parseFilter(req.query)));
});

app.get('/api/repos/:id/commits/:hash/files', guard, (req, res) => {
  const result = commitFiles(req.repo.id, String(req.params.hash));
  if (!result) return res.status(404).json({ error: 'Commit not found in this repository.' });
  const { commit, files } = result;
  res.json({
    hash: commit.hash,
    author_name: commit.author_name,
    author_email: commit.author_email,
    committer_ts: commit.committer_ts,
    files,
  });
});

app.get('/api/repos/:id/authors', guard, (req, res) => {
  res.json(authorsList(req.repo.id, parseFilter(req.query)));
});

// ---- manual author merges ----
app.get('/api/repos/:id/merges', guard, (req, res) => {
  res.json(listMerges(req.repo.id));
});

app.post('/api/repos/:id/merges', guard, (req, res, next) => {
  try {
    const sourceKey = String(req.body?.source_key || '').trim();
    const targetKey = String(req.body?.target_key || '').trim();
    if (!sourceKey || !targetKey) {
      return res.status(400).json({ error: 'Provide both source_key and target_key.' });
    }
    mergeAuthors(req.repo.id, sourceKey, targetKey);
    res.json({ ok: true, authors: authorsList(req.repo.id), merges: listMerges(req.repo.id) });
  } catch (err) {
    if (/not found|identical|itself/.test(String(err?.message))) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// In production the built frontend is served from the same port.
const distDir = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(path.join(distDir, 'index.html'))) {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.json({ message: 'Frontend is not built. Run "npm run dev" (dev servers) or "npm run build" first.' });
  });
}

app.use((err, req, res, next) => {
  if (err?.name === 'MulterError') {
    return res.status(400).json({ error: `Upload failed: ${err.message}` });
  }
  console.error(err);
  res.status(500).json({ error: err?.message || 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`RAT backend listening on http://localhost:${PORT}`);
});
