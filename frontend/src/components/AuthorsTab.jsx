import { useEffect, useState } from 'react';
import { api, formatInt, formatPercent } from '../api.js';

export default function AuthorsTab({ repoId, refreshKey }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(null);
    api
      .get(`/api/repos/${repoId}/authors`)
      .then((d) => alive && setRows(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [repoId, refreshKey]);

  if (error) return <div className="error-text">{error}</div>;
  if (!rows) return <div className="loading">Loading contributors...</div>;

  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
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
                <td colSpan={7}>No authors.</td>
              </tr>
            )}
            {rows.map((a) => (
              <tr key={a.key}>
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
      <div className="hint">
        Author identities respect the repository .mailmap where present. Ownership is the author's
        share of total churn on the repository root.
      </div>
    </>
  );
}
