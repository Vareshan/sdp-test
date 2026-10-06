import { useEffect, useState } from 'react';
import { api, formatInt, formatPercent, withQuery } from '../api.js';

// AuthorsTab lists contributor identities with their metrics and provides the
// manual author merge: select two or more identities, choose the canonical one
// and apply - the backend folds the others into it everywhere.
export default function AuthorsTab({ repoId, refreshKey, qs, filter, setFilter, onChanged }) {
  const [rows, setRows] = useState(null);
  const [merges, setMerges] = useState([]);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [mergeOpen, setMergeOpen] = useState(false);
  const [targetKey, setTargetKey] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mergeError, setMergeError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(null);
    Promise.all([
      api.get(withQuery(`/api/repos/${repoId}/authors`, qs)),
      api.get(`/api/repos/${repoId}/merges`),
    ])
      .then(([a, m]) => {
        if (!alive) return;
        setRows(a);
        setMerges(m);
        setError(null);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [repoId, refreshKey, qs, reloadKey]);

  useEffect(() => {
    setSelected(new Set());
    setMergeOpen(false);
    setMergeError(null);
  }, [repoId, qs]);

  if (error) return <div className="error-text">{error}</div>;
  if (!rows) return <div className="loading">Loading contributors...</div>;

  const selectedRows = rows.filter((r) => selected.has(r.key));
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.key));

  function toggle(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.key)));
  }

  function openMerge() {
    setTargetKey(selectedRows[0]?.key ?? null);
    setMergeError(null);
    setMergeOpen(true);
  }

  async function applyMerge() {
    if (!targetKey || selectedRows.length < 2 || busy) return;
    setBusy(true);
    setMergeError(null);
    const sources = selectedRows.map((r) => r.key).filter((k) => k !== targetKey);
    try {
      for (const key of sources) {
        await api.post(`/api/repos/${repoId}/merges`, { source_key: key, target_key: targetKey });
      }
      // Keep any active author filter pointing at the canonical identity.
      setFilter((f) => ({
        ...f,
        authors: [...new Set(f.authors.map((k) => (sources.includes(k) ? targetKey : k)))],
      }));
      setSelected(new Set());
      setMergeOpen(false);
      setReloadKey((k) => k + 1);
      if (onChanged) onChanged();
    } catch (e) {
      setMergeError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="action-bar">
        <span>
          <b>{formatInt(selected.size)}</b> of {formatInt(rows.length)} identities selected
        </span>
        <button
          className="btn btn-sm btn-primary"
          disabled={selected.size < 2}
          onClick={openMerge}
          title="Fold two or more identities into one canonical contributor"
        >
          Merge selected identities
        </button>
        {selected.size > 0 && (
          <button className="btn btn-sm" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        )}
        {merges.length > 0 && (
          <span className="fchip">{formatInt(merges.length)} manual merges applied</span>
        )}
      </div>

      {mergeOpen && (
        <div className="merge-panel">
          <div className="panel-title">
            Merge {formatInt(selectedRows.length)} identities - choose the canonical identity to keep:
          </div>
          {selectedRows.map((a) => (
            <label key={a.key} className="radio-row">
              <input
                type="radio"
                name="merge-target"
                checked={targetKey === a.key}
                onChange={() => setTargetKey(a.key)}
              />
              <span className="picker-name">{a.name}</span>
              <span className="picker-meta">{a.key}</span>
              <span className="picker-meta">
                {formatInt(a.commit_count)} commits · {formatInt(a.churn)} churn ·{' '}
                {formatPercent(a.ownership, 1)} ownership
              </span>
            </label>
          ))}
          {mergeError && <div className="error-text">{mergeError}</div>}
          <div className="form-actions">
            <button className="btn" onClick={() => setMergeOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={applyMerge} disabled={busy || !targetKey}>
              {busy ? 'Merging...' : 'Merge identities'}
            </button>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="cb">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all" />
              </th>
              <th>Author</th>
              <th className="num">Commits</th>
              <th className="num">Modifications</th>
              <th className="num">Added</th>
              <th className="num">Removed</th>
              <th className="num">Churn</th>
              <th className="num">Ownership</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8}>No authors{qs ? ' match the current filter' : ''}.</td>
              </tr>
            )}
            {rows.map((a) => (
              <tr key={a.key}>
                <td className="cb">
                  <input
                    type="checkbox"
                    checked={selected.has(a.key)}
                    onChange={() => toggle(a.key)}
                    title="Select this identity for merging"
                  />
                </td>
                <td className="author-cell" title={`${a.key} (${a.email})`}>
                  {a.name}
                </td>
                <td className="num">{formatInt(a.commit_count)}</td>
                <td className="num">{formatInt(a.modifications)}</td>
                <td className="num">{formatInt(a.added)}</td>
                <td className="num">{formatInt(a.removed)}</td>
                <td className="num">{formatInt(a.churn)}</td>
                <td className="num">
                  {formatPercent(a.ownership, 1)}
                  <div className="bar">
                    <div style={{ width: `${Math.round(a.ownership * 100)}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {merges.length > 0 && (
        <div className="panel" style={{ marginTop: 14 }}>
          <div className="panel-title">Manual author merges applied ({formatInt(merges.length)})</div>
          {merges.map((m) => (
            <div key={m.source_key} className="merge-line">
              {m.source_key} → {m.target_key}
            </div>
          ))}
        </div>
      )}
      <div className="hint">
        Author identities respect the repository .mailmap where present. Identities can also be
        merged manually: tick two or more authors and fold them into one canonical contributor -
        their commits, churn and ownership are combined everywhere in the dashboard.
      </div>
    </>
  );
}
