import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, formatInt } from '../api.js';

const DAY = 86400;

function startOfDayFromDateValue(v) {
  const [y, m, d] = v.split('-').map(Number);
  return Math.floor(new Date(y, m - 1, d).getTime() / 1000);
}

function dateValueFromTs(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function compact(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return n;
}

// Cross-repository comparison: the same commit-set window is applied to every
// selected repository so their repository metrics can be lined up directly.
export default function CompareView({ repos, refreshKey }) {
  const [sel, setSel] = useState(null);
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const readyIds = useMemo(
    () => repos.filter((r) => r.status === 'ready').map((r) => r.id),
    [repos]
  );
  const readyKey = readyIds.join(',');

  // Default the selection to the first few ready repos; drop repos that were
  // deleted or are no longer ready.
  useEffect(() => {
    setSel((prev) => {
      if (prev === null) return readyIds.slice(0, 6);
      const pruned = prev.filter((id) => readyIds.includes(id));
      return pruned.length === prev.length ? prev : pruned;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyKey]);

  useEffect(() => {
    if (!sel || sel.length === 0) {
      setData(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    const p = new URLSearchParams();
    p.set('ids', sel.join(','));
    if (from) p.set('from', String(from));
    if (to) p.set('to', String(to));
    api
      .get(`/api/compare?${p.toString()}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [sel, from, to, refreshKey]);

  function toggle(id) {
    setSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const rows = useMemo(
    () => (data ? [...data.repos].sort((a, b) => b.stats.churn - a.stats.churn) : []),
    [data]
  );

  return (
    <>
      <header className="main-header">
        <h1 className="main-title">Compare repositories</h1>
        <span className="head-hash">repository (root) metrics side by side</span>
      </header>

      <div className="panel">
        <div className="panel-title">Repositories in comparison</div>
        {readyIds.length === 0 ? (
          <div className="hint">Analyse at least one repository first.</div>
        ) : (
          <div className="compare-picker">
            {repos
              .filter((r) => r.status === 'ready')
              .map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`chip-toggle${sel && sel.includes(r.id) ? ' on' : ''}`}
                  onClick={() => toggle(r.id)}
                  title={`${r.source} — ${formatInt(r.commit_count)} commits`}
                >
                  {r.name} · {formatInt(r.commit_count)}
                </button>
              ))}
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setSel(readyIds.slice(0, 25))}
            >
              Select all
            </button>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-title">Commit-set window (applied to every repository)</div>
        <div className="compare-controls">
          <button
            type="button"
            className={`preset${!from && !to ? ' active' : ''}`}
            onClick={() => {
              setFrom(null);
              setTo(null);
            }}
          >
            Whole history
          </button>
          <span className="filter-label">From</span>
          <input
            type="date"
            className="input date-input"
            value={dateValueFromTs(from)}
            onChange={(e) => setFrom(e.target.value ? startOfDayFromDateValue(e.target.value) : null)}
          />
          <span className="filter-label">Until</span>
          <input
            type="date"
            className="input date-input"
            value={to ? dateValueFromTs(to - 1) : ''}
            onChange={(e) => setTo(e.target.value ? startOfDayFromDateValue(e.target.value) + DAY : null)}
          />
          {data?.filtered && (
            <span className="hint">Showing only commits inside the window.</span>
          )}
        </div>
      </div>

      {error && <div className="error-text">{error}</div>}
      {!error && sel && sel.length === 0 && (
        <div className="hint">Select one or more repositories above to compare them.</div>
      )}
      {!error && loading && !data && <div className="loading">Loading comparison...</div>}

      {rows.length > 0 && (
        <>
          <div className="table-wrap" style={{ marginBottom: 14 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Repository</th>
                  <th className="num">Commits</th>
                  <th className="num">Authors</th>
                  <th className="num">Added</th>
                  <th className="num">Removed</th>
                  <th className="num">Growth</th>
                  <th className="num">Churn</th>
                  <th className="num">Modifications</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.name}</strong>
                      <div className="cell-sub">
                        {r.head ? `commit ${r.head.slice(0, 10)}` : ''}
                        {r.branch && r.branch !== 'HEAD' ? ` (${r.branch})` : ''}
                      </div>
                    </td>
                    <td className="num">
                      {formatInt(r.stats.commits)}
                      {data?.filtered && r.stats.commits !== r.totalCommits && (
                        <div className="cell-sub">of {formatInt(r.totalCommits)}</div>
                      )}
                    </td>
                    <td className="num">{formatInt(r.stats.authors)}</td>
                    <td className="num">{formatInt(r.stats.added)}</td>
                    <td className="num">{formatInt(r.stats.removed)}</td>
                    <td className="num">{formatInt(r.stats.growth)}</td>
                    <td className="num">{formatInt(r.stats.churn)}</td>
                    <td className="num">{formatInt(r.stats.modifications)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <div className="panel-title">Line changes by repository (sorted by churn)</div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={rows.map((r) => ({ name: r.name, ...r.stats }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={compact} width={52} />
                <Tooltip formatter={(v) => formatInt(v)} />
                <Legend />
                <Bar dataKey="added" name="Added" fill="#4f6df5" />
                <Bar dataKey="removed" name="Removed" fill="#e0567a" />
                <Bar dataKey="churn" name="Churn" fill="#7c5cf0" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </>
  );
}
