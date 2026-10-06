import { db } from './db.js';

// Metric definitions follow the COMS011A specification:
//   growth = added - removed, churn = added + removed
//   modifications = number of commits where the object's churn > 0
//   modification frequency = modifications / |H|, churn rate = churn / |H|
// Directory metrics are the recursive sums over the directory subtree; rows are
// precomputed per (commit, directory) during ingestion. Repository metrics are
// the root directory metrics (root path is the empty string '').
//
// A commit-set filter restricts every metric to a subset H of the repository's
// commits. Three dimensions can be combined (AND semantics):
//   from / to          committer timestamp window: from inclusive, to exclusive
//   authors[]          committer identities (author_key values)
//   commits[]          an explicit list of commit hashes (manual selection)
// When no dimension is active the fast unfiltered paths below are used.

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

// Normalises an incoming filter object; returns null when nothing is active.
function activeFilter(filter) {
  if (!filter) return null;
  const from = Number.isFinite(filter.from) ? filter.from : null;
  const to = Number.isFinite(filter.to) ? filter.to : null;
  const authors = Array.isArray(filter.authors) && filter.authors.length ? filter.authors : null;
  const commits = Array.isArray(filter.commits) && filter.commits.length ? filter.commits : null;
  if (from == null && to == null && !authors && !commits) return null;
  return { from, to, authors, commits };
}

// Builds SQL conditions (and bind params) that restrict rows of the `commits`
// table (aliased `c`) to the filtered commit set H.
function commitConds(filter) {
  const conds = [];
  const params = [];
  if (filter.from != null) {
    conds.push('c.committer_ts >= ?');
    params.push(filter.from);
  }
  if (filter.to != null) {
    conds.push('c.committer_ts < ?');
    params.push(filter.to);
  }
  if (filter.authors) {
    conds.push(`c.author_key IN (${filter.authors.map(() => '?').join(',')})`);
    params.push(...filter.authors);
  }
  if (filter.commits) {
    conds.push(`c.hash IN (${filter.commits.map(() => '?').join(',')})`);
    params.push(...filter.commits);
  }
  return { conds, params };
}

// SQL for `commit_id IN (subquery selecting ids of H)`; params start with the
// repo id so a call site appends them after its own leading repo id.
function commitIdSubquery(filter, repoId) {
  const { conds, params } = commitConds(filter);
  return {
    sql: `(SELECT c.id FROM commits c WHERE c.repo_id = ? AND ${conds.join(' AND ')})`,
    params: [repoId, ...params],
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

export function summary(repoId, filter = null) {
  const active = activeFilter(filter);
  const totalCommits = db.prepare('SELECT COUNT(*) AS n FROM commits WHERE repo_id = ?').get(repoId).n;

  let commitCount;
  let root;
  let authorCount;
  let fileCount;
  let dirCount;

  if (!active) {
    commitCount = totalCommits;
    root = db
      .prepare(
        'SELECT COALESCE(SUM(added), 0) AS added, COALESCE(SUM(removed), 0) AS removed, COUNT(DISTINCT commit_id) AS modifications FROM dir_changes WHERE repo_id = ? AND path = ?'
      )
      .get(repoId, '');
    authorCount = db.prepare('SELECT COUNT(*) AS n FROM authors WHERE repo_id = ?').get(repoId).n;
    fileCount = db.prepare('SELECT COUNT(DISTINCT path) AS n FROM file_changes WHERE repo_id = ?').get(repoId).n;
    dirCount = db
      .prepare('SELECT COUNT(*) AS n FROM (SELECT 1 AS x FROM dir_changes WHERE repo_id = ? AND path <> ? GROUP BY path)')
      .get(repoId, '').n;
  } else {
    const { conds, params } = commitConds(active);
    const where = `c.repo_id = ? AND ${conds.join(' AND ')}`;
    commitCount = db.prepare(`SELECT COUNT(*) AS n FROM commits c WHERE ${where}`).get(repoId, ...params).n;

    const sub = commitIdSubquery(active, repoId);
    root = db
      .prepare(
        `SELECT COALESCE(SUM(added), 0) AS added, COALESCE(SUM(removed), 0) AS removed, COUNT(DISTINCT commit_id) AS modifications
         FROM dir_changes WHERE repo_id = ? AND path = ? AND commit_id IN ${sub.sql}`
      )
      .get(repoId, '', ...sub.params);
    authorCount = db
      .prepare(`SELECT COUNT(DISTINCT c.author_key) AS n FROM commits c WHERE ${where}`)
      .get(repoId, ...params).n;
    fileCount = db
      .prepare(`SELECT COUNT(DISTINCT path) AS n FROM file_changes WHERE repo_id = ? AND commit_id IN ${sub.sql}`)
      .get(repoId, ...sub.params).n;
    dirCount = db
      .prepare(
        `SELECT COUNT(*) AS n FROM (SELECT 1 AS x FROM dir_changes WHERE repo_id = ? AND path <> ? AND commit_id IN ${sub.sql} GROUP BY path)`
      )
      .get(repoId, '', ...sub.params).n;
  }

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
       WHERE c.repo_id = ?${active ? ` AND ${commitConds(active).conds.join(' AND ')}` : ''}
       GROUP BY wk ORDER BY wk`
    )
    .all(repoId, repoId, ...(active ? commitConds(active).params : []))
    .map((row) => ({
      week: row.wk * 604800,
      label: new Date(row.wk * 604800 * 1000).toISOString().slice(0, 10),
      commits: row.commits,
      added: row.added,
      removed: row.removed,
    }));

  const topFilesSql = active
    ? `SELECT path, SUM(added) AS added, SUM(removed) AS removed, COUNT(DISTINCT commit_id) AS modifications
       FROM file_changes WHERE repo_id = ? AND commit_id IN ${commitIdSubquery(active, repoId).sql}
       GROUP BY path
       ORDER BY SUM(added) + SUM(removed) DESC
       LIMIT 10`
    : `SELECT path, SUM(added) AS added, SUM(removed) AS removed, COUNT(DISTINCT commit_id) AS modifications
       FROM file_changes WHERE repo_id = ?
       GROUP BY path
       ORDER BY SUM(added) + SUM(removed) DESC
       LIMIT 10`;
  const topFiles = db
    .prepare(topFilesSql)
    .all(repoId, ...(active ? commitIdSubquery(active, repoId).params : []))
    .map((r) => ({ ...r, churn: r.added + r.removed }));

  return {
    stats: {
      commits: commitCount,
      authors: authorCount,
      files: fileCount,
      directories: dirCount,
      ...withDerived(root.added, root.removed, root.modifications, commitCount),
    },
    totalCommits,
    filtered: Boolean(active),
    timeseries,
    topFiles,
  };
}

export function tree(repoId, dirPath, filter = null) {
  const active = activeFilter(filter);
  const sub = active ? commitIdSubquery(active, repoId) : null;
  const subParams = sub ? sub.params : [];
  const extra = sub ? ` AND commit_id IN ${sub.sql}` : '';

  const rows = db
    .prepare(
      `SELECT * FROM (
         SELECT path, name, 'dir' AS type, SUM(added) AS added, SUM(removed) AS removed,
                COUNT(DISTINCT commit_id) AS modifications
         FROM dir_changes WHERE repo_id = ? AND parent_dir = ?${extra} GROUP BY path
         UNION ALL
         SELECT path, name, 'file' AS type, SUM(added) AS added, SUM(removed) AS removed,
                COUNT(DISTINCT commit_id) AS modifications
         FROM file_changes WHERE repo_id = ? AND parent_dir = ?${extra} GROUP BY path
       )
       ORDER BY (added + removed) DESC, name`
    )
    .all(repoId, dirPath, ...subParams, repoId, dirPath, ...subParams);
  return rows.map((r) => ({ ...r, growth: r.added - r.removed, churn: r.added + r.removed }));
}

export function objectMetrics(repoId, objectPath, type, filter = null) {
  const table = type === 'dir' ? 'dir_changes' : 'file_changes';
  const active = activeFilter(filter);

  let commitCount;
  let sub = null;
  if (active) {
    const { conds, params } = commitConds(active);
    commitCount = db
      .prepare(`SELECT COUNT(*) AS n FROM commits c WHERE c.repo_id = ? AND ${conds.join(' AND ')}`)
      .get(repoId, ...params).n;
    sub = commitIdSubquery(active, repoId);
  } else {
    commitCount = db.prepare('SELECT COUNT(*) AS n FROM commits WHERE repo_id = ?').get(repoId).n;
  }
  const subParams = sub ? sub.params : [];
  const aggExtra = sub ? ` AND commit_id IN ${sub.sql}` : '';
  const joinExtra = sub ? ` AND t.commit_id IN ${sub.sql}` : '';

  const agg = db
    .prepare(
      `SELECT COALESCE(SUM(added), 0) AS added, COALESCE(SUM(removed), 0) AS removed,
              COUNT(DISTINCT commit_id) AS modifications
       FROM ${table} WHERE repo_id = ? AND path = ?${aggExtra}`
    )
    .get(repoId, objectPath, ...subParams);

  const series = db
    .prepare(
      `SELECT c.hash AS hash, c.committer_ts AS ts, c.author_name AS author, SUM(t.added) AS added, SUM(t.removed) AS removed
       FROM ${table} t JOIN commits c ON c.id = t.commit_id
       WHERE t.repo_id = ? AND t.path = ?${joinExtra}
       GROUP BY t.commit_id
       ORDER BY c.committer_ts DESC
       LIMIT 30`
    )
    .all(repoId, objectPath, ...subParams)
    .reverse();

  const authorRows = db
    .prepare(
      `SELECT c.author_key AS key, COUNT(DISTINCT t.commit_id) AS modifications,
              SUM(t.added) AS added, SUM(t.removed) AS removed
       FROM ${table} t JOIN commits c ON c.id = t.commit_id
       WHERE t.repo_id = ? AND t.path = ?${joinExtra}
       GROUP BY c.author_key
       ORDER BY SUM(t.added) + SUM(t.removed) DESC`
    )
    .all(repoId, objectPath, ...subParams);

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

// The commits list honours the time and author dimensions but deliberately
// ignores the manual `commits` list: it stays the selection surface so a user
// can always adjust which commits are in the set.
export function commitsPage(repoId, offset, limit, filter = null) {
  const active = activeFilter(filter ? { ...filter, commits: null } : null);
  let where = 'repo_id = ?';
  let params = [];
  if (active) {
    const conds = [];
    if (active.from != null) {
      conds.push('committer_ts >= ?');
      params.push(active.from);
    }
    if (active.to != null) {
      conds.push('committer_ts < ?');
      params.push(active.to);
    }
    if (active.authors) {
      conds.push(`author_key IN (${active.authors.map(() => '?').join(',')})`);
      params.push(...active.authors);
    }
    where = `repo_id = ? AND ${conds.join(' AND ')}`;
  }

  const total = db.prepare(`SELECT COUNT(*) AS n FROM commits c WHERE ${where}`).get(repoId, ...params).n;
  const totalAll = db.prepare('SELECT COUNT(*) AS n FROM commits WHERE repo_id = ?').get(repoId).n;
  const commits = db
    .prepare(
      `SELECT id, hash, author_name, author_email, committer_ts
       FROM commits c WHERE ${where}
       ORDER BY committer_ts DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(repoId, ...params, limit, offset);

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

  return { commits, total, totalAll, offset, limit };
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

export function authorsList(repoId, filter = null) {
  const active = activeFilter(filter);

  let rows;
  if (!active) {
    // Fast path: precomputed per-author aggregates written during ingestion.
    rows = db
      .prepare(
        `SELECT key, name, email, commit_count, modifications, added, removed
         FROM authors WHERE repo_id = ?
         ORDER BY (added + removed) DESC`
      )
      .all(repoId);
  } else {
    // Filtered path: recomputed from commits + per-commit churn (root rows).
    const { conds, params } = commitConds(active);
    rows = db
      .prepare(
        `SELECT c.author_key AS key, MAX(c.author_name) AS name, MAX(c.author_email) AS email,
                COUNT(*) AS commit_count,
                COALESCE(SUM(CASE WHEN t.churn > 0 THEN 1 ELSE 0 END), 0) AS modifications,
                COALESCE(SUM(t.added), 0) AS added, COALESCE(SUM(t.removed), 0) AS removed
         FROM commits c
         LEFT JOIN (
           SELECT commit_id, added, removed, added + removed AS churn
           FROM dir_changes WHERE repo_id = ? AND path = ''
         ) t ON t.commit_id = c.id
         WHERE c.repo_id = ? AND ${conds.join(' AND ')}
         GROUP BY c.author_key
         ORDER BY COALESCE(SUM(t.added), 0) + COALESCE(SUM(t.removed), 0) DESC`
      )
      .all(repoId, repoId, ...params);
  }

  const totalChurn = rows.reduce((sum, r) => sum + r.added + r.removed, 0);
  return rows.map((r) => ({
    ...r,
    churn: r.added + r.removed,
    ownership: totalChurn > 0 ? (r.added + r.removed) / totalChurn : 0,
  }));
}

// Manual author merges applied to this repository (source identity folded into
// the target identity).
export function listMerges(repoId) {
  return db
    .prepare('SELECT source_key, target_key FROM author_merges WHERE repo_id = ? ORDER BY source_key')
    .all(repoId);
}
