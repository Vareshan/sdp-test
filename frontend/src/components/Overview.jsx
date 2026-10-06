import { useEffect, useState } from 'react';
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
import { api, formatInt, formatPercent } from '../api.js';

function compact(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return n;
}

function shortPath(p) {
  return p.length > 30 ? `…${p.slice(-29)}` : p;
}

export default function Overview({ repoId, refreshKey }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api
      .get(`/api/repos/${repoId}/summary`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [repoId, refreshKey]);

  if (error) return <div className="error-text">{error}</div>;
  if (!data) return <div className="loading">Loading metrics...</div>;

  const s = data.stats;

  return (
    <>
      <div className="cards">
        <div className="card">
          <div className="card-label">Commits</div>
          <div className="card-value">{formatInt(s.commits)}</div>
        </div>
        <div className="card">
          <div className="card-label">Contributors</div>
          <div className="card-value">{formatInt(s.authors)}</div>
        </div>
        <div className="card">
          <div className="card-label">Files</div>
          <div className="card-value">{formatInt(s.files)}</div>
        </div>
        <div className="card">
          <div className="card-label">Directories</div>
          <div className="card-value">{formatInt(s.directories)}</div>
        </div>
        <div className="card">
          <div className="card-label">Added lines</div>
          <div className="card-value">{formatInt(s.added)}</div>
        </div>
        <div className="card">
          <div className="card-label">Removed lines</div>
          <div className="card-value">{formatInt(s.removed)}</div>
        </div>
        <div className="card">
          <div className="card-label">Growth</div>
          <div className="card-value">{formatInt(s.growth)}</div>
        </div>
        <div className="card">
          <div className="card-label">Churn</div>
          <div className="card-value">{formatInt(s.churn)}</div>
        </div>
      </div>
      <div className="chips">
        <span className="chip">Repository modifications: {formatInt(s.modifications)}</span>
        <span className="chip">Modification frequency: {formatPercent(s.modificationFrequency, 2)}</span>
        <span className="chip">Churn rate: {s.churnRate.toFixed(1)} lines/commit</span>
      </div>

      <div className="chart-row">
        <div className="panel">
          <div className="panel-title">Lines changed per week (whole repository)</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.timeseries} barGap={0}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={40} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={compact} width={45} />
              <Tooltip formatter={(v) => formatInt(v)} />
              <Legend />
              <Bar dataKey="added" name="Added" fill="#4f6df5" />
              <Bar dataKey="removed" name="Removed" fill="#e0567a" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="panel">
          <div className="panel-title">Top files by churn (whole history)</div>
          {data.topFiles.length === 0 ? (
            <div className="hint">No line changes recorded.</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(200, data.topFiles.length * 27 + 30)}>
              <BarChart data={data.topFiles} layout="vertical" margin={{ left: 8, right: 18 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="path"
                  width={215}
                  tick={{ fontSize: 11 }}
                  tickFormatter={shortPath}
                />
                <Tooltip formatter={(v, name) => [formatInt(v), name === 'churn' ? 'Churn' : name]} />
                <Bar dataKey="churn" name="Churn" fill="#7c5cf0" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </>
  );
}
