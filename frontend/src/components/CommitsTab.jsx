import { useCallback, useEffect, useState } from 'react';
import { api, formatDate, formatInt, withQuery } from '../api.js';

const PAGE_SIZE = 50;

// CommitsTab is both a browser and the manual commit-selection surface: ticked
// commits form a custom commit set that is applied to every metric view. The
// list itself honours the time/author filters but always ignores the manual
// commit list, so already-applied selections stay visible and adjustable.
export default function CommitsTab({ repoId, qs, filter, setFilter }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalAll, setTotalAll] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [filesByHash, setFilesByHash] = useState({});
  const [selected, setSelected] = useState(() => new Set(filter.commits));

  const appliedKey = filter.commits.join(',');

  // Keep the local selection in sync when the commit set is changed elsewhere
  // (e.g. cleared from the FilterBar chip).
  useEffect(() => {
    setSelected(new Set(appliedKey ? appliedKey.split(',') : []));
  }, [appliedKey]);

  const load = useCallback(
    async (offset) => {
      setLoading(true);
      setError(null);
      try {
        const d = await api.get(
          withQuery(`/api/repos/${repoId}/commits?offset=${offset}&limit=${PAGE_SIZE}`, qs)
        );
        setRows((prev) => (offset === 0 ? d.commits : [...prev, ...d.commits]));
        setTotal(d.total);
        setTotalAll(d.totalAll ?? d.total);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [repoId, qs]
  );

  useEffect(() => {
    setRows([]);
    setTotal(0);
    setExpanded(null);
    setFilesByHash({});
    load(0);
  }, [repoId, qs, load]);

  async function toggle(hash) {
    if (expanded === hash) {
      setExpanded(null);
      return;
    }
    setExpanded(hash);
    if (!filesByHash[hash]) {
      try {
        const d = await api.get(`/api/repos/${repoId}/commits/${hash}/files`);
        setFilesByHash((prev) => ({ ...prev, [hash]: d.files }));
      } catch (e) {
        setFilesByHash((prev) => ({ ...prev, [hash]: [] }));
      }
    }
  }

  function toggleSelect(hash) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  }

  const allLoadedSelected = rows.length > 0 && rows.every((r) => selected.has(r.hash));

  function toggleAllLoaded() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allLoadedSelected) for (const r of rows) next.delete(r.hash);
      else for (const r of rows) next.add(r.hash);
      return next;
    });
  }

  function applySelection() {
    const list = [...selected];
    setFilter((f) => ({ ...f, commits: list }));
  }

  function clearSelection() {
    setSelected(new Set());
    setFilter((f) => ({ ...f, commits: [] }));
  }

  const applied = new Set(filter.commits);

  return (
    <>
      {error && <div className="error-text">{error}</div>}
      <div className="action-bar">
        <span>
          <b>{formatInt(selected.size)}</b> selected
        </span>
        <button
          className="btn btn-sm btn-primary"
          disabled={selected.size === 0}
          onClick={applySelection}
          title="Restrict every metric view to the ticked commits"
        >
          Use selection as commit set
        </button>
        <button
          className="btn btn-sm"
          disabled={selected.size === 0 && filter.commits.length === 0}
          onClick={clearSelection}
        >
          Clear selection
        </button>
        {filter.commits.length > 0 && (
          <span className="fchip">Commit set applied: {formatInt(filter.commits.length)} commits</span>
        )}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="cb">
                <input
                  type="checkbox"
                  checked={allLoadedSelected}
                  onChange={toggleAllLoaded}
                  title="Select all loaded commits"
                />
              </th>
              <th>Commit</th>
              <th>Author</th>
              <th>Date</th>
              <th className="num">Files</th>
              <th className="num">Added</th>
              <th className="num">Removed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <CommitRow
                key={c.hash}
                commit={c}
                expanded={expanded === c.hash}
                files={filesByHash[c.hash]}
                onToggle={() => toggle(c.hash)}
                selected={selected.has(c.hash)}
                applied={applied.has(c.hash)}
                onSelect={() => toggleSelect(c.hash)}
              />
            ))}
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={7}>No commits{qs ? ' match the current filter' : ''}.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="form-actions" style={{ justifyContent: 'space-between' }}>
        <div className="hint">
          {total !== totalAll
            ? `Showing ${formatInt(rows.length)} of ${formatInt(total)} commits matching the filter (repository has ${formatInt(totalAll)}).`
            : `Showing ${formatInt(rows.length)} of ${formatInt(total)} non-merge commits (newest first).`}
        </div>
        {rows.length < total && (
          <button className="btn" onClick={() => load(rows.length)} disabled={loading}>
            {loading ? 'Loading...' : 'Load more'}
          </button>
        )}
      </div>
    </>
  );
}

function CommitRow({ commit, expanded, files, onToggle, selected, applied, onSelect }) {
  return (
    <>
      <tr className={`clickable${applied ? ' in-set' : ''}`} onClick={onToggle}>
        <td className="cb" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onSelect}
            title="Include this commit in the custom commit set"
          />
        </td>
        <td className="head-hash">{commit.hash.slice(0, 10)}</td>
        <td className="author-cell" title={commit.author_email}>
          {commit.author_name}
        </td>
        <td>{formatDate(commit.committer_ts)}</td>
        <td className="num">{formatInt(commit.files)}</td>
        <td className="num">{formatInt(commit.added)}</td>
        <td className="num">{formatInt(commit.removed)}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} style={{ background: '#fafbfe' }}>
            {!files && <div className="hint">Loading changed files...</div>}
            {files && files.length === 0 && (
              <div className="hint">No measured line changes (binary-only or empty commit).</div>
            )}
            {files && files.length > 0 && (
              <table className="table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th className="num">Added</th>
                    <th className="num">Removed</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => (
                    <tr key={f.path}>
                      <td>{f.path}</td>
                      <td className="num">{formatInt(f.added)}</td>
                      <td className="num">{formatInt(f.removed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
