import { db } from './db.js';

// Metric definitions follow the COMS011A specification:
//   growth = added - removed, churn = added + removed
//   modifications = number of commits where the object's churn > 0
//   modification frequency = modifications / |H|, churn rate = churn / |H|
// Directory metrics are the recursive sums over the directory subtree; rows are
// precomputed per (commit, directory) during ingestion. Repository metrics are
// the root directory metrics (root path is the empty string '').

function withDerived(added, removed, modifications, commitCount) {
  const growth = added - removed;
  const churn = added + removed;
  return {
    added,
    removed,
    growth,
    churn,
    modifications,
    modificationFrequency: commitCount > 0 ? modifications / commitCount : 0,
    churnRate: commitCount > 0 ? churn / commitCount : 0,
  };
}

export function getRepo(repoId) {
  return db.prepare('SELECT * FROM repos WHERE id = ?').get(repoId);
}

export function listRepos() {
  return db
    .prepare(
      'SELECT id, name, source_type, source, head, branch, status, progress, error, commit_count, created_at FROM repos ORDER BY id DESC'
    )
    .all();
}

export function summary(repoId) {
  const commitCount = db.prepare('SELECT COUNT(*) AS n FROM commits WHERE repo_id = ?').get(repoId).n;
  const root = db
    .prepare(
      'SELECT COALESCE(SUM(added), 0) AS added, COALESCE(SUM(removed), 0) AS removed, COUNT(DISTINCT commit_id) AS modifications FROM dir_changes WHERE repo_id = ? AND path = ?'
    )
    .get(repoId, '');

  const authorCount = db.prepare('SELECT COUNT(*) AS n FROM authors WHERE repo_id = ?').get(repoId).n;
  const fileCount = db.prepare('SELECT COUNT(DISTINCT path) AS n FROM file_changes WHERE repo_id = ?').get(repoId).n;
  const dirCount = db
    .prepare('SELECT COUNT(*) AS n FROM (SELECT 1 AS x FROM dir_changes WHERE repo_id = ? AND path <> ? GROUP BY path)')
    .get(repoId, '').n;

  const timeseries = db
    .prepare(
      `SELECT CAST(c.committer_ts / 604800 AS INTEGER) AS wk,
              COUNT(*) AS commits,
              COALESCE(SUM(f.a), 0) AS added,
              COALESCE(SUM(f.r), 0) AS removed
       FROM commits c
       LEFT JOIN (
         SELECT commit_id, SUM(added) AS a, SUM(removed) AS r
         FROM file_changes WHERE repo_id = ? GROUP BY commit_id
       ) f ON f.commit_id = c.id
       WHERE c.repo_id = ?
       GROUP BY wk ORDER BY wk`
    )
    .all(repoId, repoId)
    .map((row) => ({
      week: row.wk * 604800,
      label: new Date(row.wk * 604800 * 1000).toISOString().slice(0, 10),
      commits: row.commits,
      added: row.added,
      removed: row.removed,
    }));

  const topFiles = db
    .prepare(
      `SELECT path, SUM(added) AS added, SUM(removed) AS removed, COUNT(DISTINCT commit_id) AS modifications
       FROM file_changes WHERE repo_id = ?
       GROUP BY path
       ORDER BY SUM(added) + SUM(removed) DESC
       LIMIT 10`
    )
    .all(repoId)
    .map((r) => ({ ...r, churn: r.added + r.removed }));

  return {
    stats: {
      commits: commitCount,
      authors: authorCount,
      files: fileCount,
      directories: dirCount,
      ...withDerived(root.added, root.removed, root.modifications, commitCount),
    },
    timeseries,
    topFiles,
  };
}

export function tree(repoId, dirPath) {
  const rows = db
    .prepare(
      `SELECT * FROM (
         SELECT path, name, 'dir' AS type, SUM(added) AS added, SUM(removed) AS removed,
                COUNT(DISTINCT commit_id) AS modifications
         FROM dir_changes WHERE repo_id = ? AND parent_dir = ? GROUP BY path
         UNION ALL
         SELECT path, name, 'file' AS type, SUM(added) AS added, SUM(removed) AS removed,
                COUNT(DISTINCT commit_id) AS modifications
         FROM file_changes WHERE repo_id = ? AND parent_dir = ? GROUP BY path
       )
       ORDER BY (added + removed) DESC, name`
    )
    .all(repoId, dirPath, repoId, dirPath);
  return rows.map((r) => ({ ...r, growth: r.added - r.removed, churn: r.added + r.removed }));
}

export function objectMetrics(repoId, objectPath, type) {
  const table = type === 'dir' ? 'dir_changes' : 'file_changes';
  const commitCount = db.prepare('SELECT COUNT(*) AS n FROM commits WHERE repo_id = ?').get(repoId).n;

  const agg = db
    .prepare(
      `SELECT COALESCE(SUM(added), 0) AS added, COALESCE(SUM(removed), 0) AS removed,
              COUNT(DISTINCT commit_id) AS modifications
       FROM ${table} WHERE repo_id = ? AND path = ?`
    )
    .get(repoId, objectPath);

  const series = db
    .prepare(
      `SELECT c.hash AS hash, c.committer_ts AS ts, c.author_name AS author, SUM(t.added) AS added, SUM(t.removed) AS removed
       FROM ${table} t JOIN commits c ON c.id = t.commit_id
       WHERE t.repo_id = ? AND t.path = ?
       GROUP BY t.commit_id
       ORDER BY c.committer_ts DESC
       LIMIT 30`
    )
    .all(repoId, objectPath)
    .reverse();

  const authorRows = db
    .prepare(
      `SELECT c.author_key AS key, COUNT(DISTINCT t.commit_id) AS modifications,
              SUM(t.added) AS added, SUM(t.removed) AS removed
       FROM ${table} t JOIN commits c ON c.id = t.commit_id
       WHERE t.repo_id = ? AND t.path = ?
       GROUP BY c.author_key
       ORDER BY SUM(t.added) + SUM(t.removed) DESC`
    )
    .all(repoId, objectPath);

  const authors = authorRows.map((r) => ({
    ...r,
    churn: r.added + r.removed,
    ownership: agg.added + agg.removed > 0 ? (r.added + r.removed) / (agg.added + agg.removed) : 0,
  }));

  return {
    stats: withDerived(agg.added, agg.removed, agg.modifications, commitCount),
    series,
    authors,
  };
}

export function commitsPage(repoId, offset, limit) {
  const total = db.prepare('SELECT COUNT(*) AS n FROM commits WHERE repo_id = ?').get(repoId).n;
  const commits = db
    .prepare(
      `SELECT id, hash, author_name, author_email, committer_ts
       FROM commits WHERE repo_id = ?
       ORDER BY committer_ts DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(repoId, limit, offset);

  if (commits.length) {
    const ids = commits.map((c) => c.id);
    const marks = ids.map(() => '?').join(',');
    const stats = db
      .prepare(
        `SELECT commit_id, SUM(added) AS added, SUM(removed) AS removed, COUNT(*) AS files
         FROM file_changes WHERE repo_id = ? AND commit_id IN (${marks})
         GROUP BY commit_id`
      )
      .all(repoId, ...ids);
    const byId = new Map(stats.map((s) => [s.commit_id, s]));
    for (const c of commits) {
      const s = byId.get(c.id);
      c.added = s ? s.added : 0;
      c.removed = s ? s.removed : 0;
      c.files = s ? s.files : 0;
      delete c.id;
    }
  }

  return { commits, total, offset, limit };
}

export function commitFiles(repoId, hash) {
  const commit = db.prepare('SELECT * FROM commits WHERE repo_id = ? AND hash = ?').get(repoId, hash);
  if (!commit) return null;
  const files = db
    .prepare(
      `SELECT path, added, removed FROM file_changes
       WHERE repo_id = ? AND commit_id = ?
       ORDER BY (added + removed) DESC`
    )
    .all(repoId, commit.id);
  return { commit, files };
}

export function authorsList(repoId) {
  const rows = db
    .prepare(
      `SELECT key, name, email, commit_count, modifications, added, removed
       FROM authors WHERE repo_id = ?
       ORDER BY (added + removed) DESC`
    )
    .all(repoId);
  const totalChurn = rows.reduce((sum, r) => sum + r.added + r.removed, 0);
  return rows.map((r) => ({
    ...r,
    churn: r.added + r.removed,
    ownership: totalChurn > 0 ? (r.added + r.removed) / totalChurn : 0,
  }));
}
