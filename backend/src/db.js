import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// All runtime state (database + cloned/extracted repositories) lives under DATA_DIR.
// Override with RAT_DATA_DIR to relocate it; defaults to <repo-root>/data.
export const DATA_DIR = process.env.RAT_DATA_DIR
  ? path.resolve(process.env.RAT_DATA_DIR)
  : path.resolve(__dirname, '../../data');

export const REPOS_DIR = path.join(DATA_DIR, 'repos');
export const TMP_DIR = path.join(DATA_DIR, 'tmp');

fs.mkdirSync(REPOS_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'rat.db'));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source TEXT,
  git_subdir TEXT NOT NULL DEFAULT '',
  head TEXT,
  branch TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  progress REAL NOT NULL DEFAULT 0,
  error TEXT,
  commit_count INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS commits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_email TEXT NOT NULL,
  author_key TEXT NOT NULL,
  committer_ts INTEGER NOT NULL,
  UNIQUE (repo_id, hash)
);
CREATE INDEX IF NOT EXISTS idx_commits_repo_ts ON commits(repo_id, committer_ts);
CREATE INDEX IF NOT EXISTS idx_commits_repo_author ON commits(repo_id, author_key);

CREATE TABLE IF NOT EXISTS file_changes (
  repo_id INTEGER NOT NULL,
  commit_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  parent_dir TEXT NOT NULL,
  name TEXT NOT NULL,
  added INTEGER NOT NULL,
  removed INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fc_repo_commit ON file_changes(repo_id, commit_id);
CREATE INDEX IF NOT EXISTS idx_fc_repo_path ON file_changes(repo_id, path, commit_id);
CREATE INDEX IF NOT EXISTS idx_fc_repo_parent ON file_changes(repo_id, parent_dir);

CREATE TABLE IF NOT EXISTS dir_changes (
  repo_id INTEGER NOT NULL,
  commit_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  parent_dir TEXT,
  name TEXT NOT NULL,
  added INTEGER NOT NULL,
  removed INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dc_repo_commit ON dir_changes(repo_id, commit_id);
CREATE INDEX IF NOT EXISTS idx_dc_repo_path ON dir_changes(repo_id, path, commit_id);
CREATE INDEX IF NOT EXISTS idx_dc_repo_parent ON dir_changes(repo_id, parent_dir);

CREATE TABLE IF NOT EXISTS authors (
  repo_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  commit_count INTEGER NOT NULL,
  modifications INTEGER NOT NULL,
  added INTEGER NOT NULL,
  removed INTEGER NOT NULL,
  PRIMARY KEY (repo_id, key)
);
`);
