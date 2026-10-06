import { useCallback, useEffect, useState } from 'react';
import { api, formatDate, formatInt } from '../api.js';

const PAGE_SIZE = 50;

export default function CommitsTab({ repoId }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [filesByHash, setFilesByHash] = useState({});

  const load = useCallback(
    async (offset) => {
      setLoading(true);
      setError(null);
      try {
        const d = await api.get(`/api/repos/${repoId}/commits?offset=${offset}&limit=${PAGE_SIZE}`);
        setRows((prev) => (offset === 0 ? d.commits : [...prev, ...d.commits]));
        setTotal(d.total);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [repoId]
  );

  useEffect(() => {
    setRows([]);
    setTotal(0);
    setExpanded(null);
    setFilesByHash({});
    load(0);
  }, [repoId, load]);

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

  return (
    <>
      {error && <div className="error-text">{error}</div>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
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
              />
            ))}
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={6}>No commits.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="form-actions" style={{ justifyContent: 'space-between' }}>
        <div className="hint">
          Showing {formatInt(rows.length)} of {formatInt(total)} non-merge commits (newest first).
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

function CommitRow({ commit, expanded, files, onToggle }) {
  return (
    <>
      <tr className="clickable" onClick={onToggle}>
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
          <td colSpan={6} style={{ background: '#fafbfe' }}>
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
