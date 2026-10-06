import { useEffect, useState } from 'react';
import { api, formatInt, withQuery } from '../api.js';

export default function FilesTab({ repoId, refreshKey, qs, onOpenObject }) {
  const [dir, setDir] = useState('');
  const [children, setChildren] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setDir('');
  }, [repoId, refreshKey]);

  useEffect(() => {
    let alive = true;
    setChildren(null);
    setError(null);
    api
      .get(withQuery(`/api/repos/${repoId}/tree?dir=${encodeURIComponent(dir)}`, qs))
      .then((d) => alive && setChildren(d.children))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [repoId, refreshKey, dir, qs]);

  const parts = dir ? dir.split('/') : [];

  function openCrumb(index) {
    setDir(parts.slice(0, index).join('/'));
  }

  function activate(child) {
    if (child.type === 'dir') {
      setDir(child.path);
    } else {
      onOpenObject({ path: child.path, type: 'file' });
    }
  }

  return (
    <>
      <div className="crumbs">
        <button className="crumb" onClick={() => setDir('')}>
          root
        </button>
        {parts.map((p, i) => (
          <span key={i}>
            <span className="crumb-sep">/</span>
            <button className="crumb" onClick={() => openCrumb(i + 1)}>
              {p}
            </button>
          </span>
        ))}
      </div>
      {error && <div className="error-text">{error}</div>}
      {!children && !error && <div className="loading">Loading tree...</div>}
      {children && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Churn</th>
                <th className="num">Added</th>
                <th className="num">Removed</th>
                <th className="num">Growth</th>
                <th className="num">Modifications</th>
              </tr>
            </thead>
            <tbody>
              {children.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    Nothing changed inside this directory (or it is empty).
                  </td>
                </tr>
              )}
              {children.map((c) => (
                <tr key={`${c.type}:${c.path}`} className="clickable" onClick={() => activate(c)}>
                  <td>
                    <span className={`type-tag ${c.type}`}>{c.type}</span>
                    {c.name}
                  </td>
                  <td className="num">{formatInt(c.churn)}</td>
                  <td className="num">{formatInt(c.added)}</td>
                  <td className="num">{formatInt(c.removed)}</td>
                  <td className="num">{formatInt(c.growth)}</td>
                  <td className="num">{formatInt(c.modifications)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="hint">
        Directories navigate on click; files open a detail panel with per-commit metrics and author
        ownership. Numbers are computed over {qs ? 'the filtered commit set' : 'the whole history'}.
      </div>
    </>
  );
}
