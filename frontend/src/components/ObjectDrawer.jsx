import { useEffect, useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, formatInt, formatPercent } from '../api.js';

export default function ObjectDrawer({ repoId, object, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api
      .get(`/api/repos/${repoId}/object?path=${encodeURIComponent(object.path)}&type=${object.type}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [repoId, object.path, object.type]);

  return (
    <aside className="drawer">
      <div className="drawer-header">
        <div>
          <div className="drawer-title">{object.path}</div>
          <span className={`type-tag ${object.type}`}>{object.type}</span>
        </div>
        <button className="drawer-close" onClick={onClose} title="Close">
          ×
        </button>
      </div>

      {error && <div className="error-text">{error}</div>}
      {!data && !error && <div className="loading">Loading metrics...</div>}

      {data && (
        <>
          <div className="stat-grid">
            <div className="stat">
              <div className="stat-label">Added lines</div>
              <div className="stat-value">{formatInt(data.stats.added)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Removed lines</div>
              <div className="stat-value">{formatInt(data.stats.removed)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Growth</div>
              <div className="stat-value">{formatInt(data.stats.growth)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Churn</div>
              <div className="stat-value">{formatInt(data.stats.churn)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Modifications</div>
              <div className="stat-value">{formatInt(data.stats.modifications)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Mod. frequency</div>
              <div className="stat-value">{formatPercent(data.stats.modificationFrequency, 2)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Churn rate</div>
              <div className="stat-value">{data.stats.churnRate.toFixed(1)}</div>
            </div>
          </div>

          <div className="panel-title">
            Line changes per commit (last {data.series.length} commits)
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data.series} barGap={0}>
              <XAxis
                dataKey="hash"
                tick={{ fontSize: 10 }}
                tickFormatter={(h) => h.slice(0, 6)}
                minTickGap={26}
              />
              <YAxis tick={{ fontSize: 10 }} width={42} />
              <Tooltip formatter={(v) => formatInt(v)} labelFormatter={(h) => `commit ${h}`} />
              <Bar dataKey="added" name="Added" fill="#4f6df5" />
              <Bar dataKey="removed" name="Removed" fill="#e0567a" />
            </BarChart>
          </ResponsiveContainer>

          <div className="panel-title">Author ownership (churn share)</div>
          {data.authors.length === 0 ? (
            <div className="hint">No measurable changes.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Author</th>
                  <th className="num">Mods</th>
                  <th className="num">Churn</th>
                  <th className="num">Ownership</th>
                </tr>
              </thead>
              <tbody>
                {data.authors.map((a) => (
                  <tr key={a.key}>
                    <td className="author-cell" title={a.key}>
                      {a.key}
                    </td>
                    <td className="num">{formatInt(a.modifications)}</td>
                    <td className="num">{formatInt(a.churn)}</td>
                    <td className="num">
                      {formatPercent(a.ownership, 0)}
                      <div className="bar">
                        <div style={{ width: `${Math.round(a.ownership * 100)}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </aside>
  );
}
