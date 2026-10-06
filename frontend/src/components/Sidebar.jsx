import { formatInt } from '../api.js';

function statusInfo(r) {
  if (r.status === 'ready') return { cls: 'ok', text: `${formatInt(r.commit_count)} commits` };
  if (r.status === 'error') return { cls: 'bad', text: 'error - click for details' };
  return { cls: 'busy', text: `${r.status} ${Math.round((r.progress || 0) * 100)}%` };
}

export default function Sidebar({ repos, selectedId, onSelect, onAdd, onDelete, onCompare, compareActive }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand">RAT</div>
        <div className="brand-sub">Repository Analysis Tool</div>
      </div>
      <button className="btn btn-primary add-btn" onClick={onAdd}>
        + Add repository
      </button>
      <button
        className={`btn compare-btn${compareActive ? ' active' : ''}`}
        onClick={onCompare}
        title="Line up repository metrics side by side"
      >
        Compare repositories
      </button>
      <div className="repo-list">
        {repos.length === 0 && <div className="sidebar-empty">No repositories yet.</div>}
        {repos.map((r) => {
          const info = statusInfo(r);
          return (
            <div
              key={r.id}
              className={`repo-item${selectedId === r.id ? ' selected' : ''}`}
              onClick={() => onSelect(r.id)}
              title={r.status === 'error' ? r.error : r.source}
            >
              <div className="repo-item-main">
                <div className="repo-name">{r.name}</div>
                <div className={`repo-sub ${info.cls}`}>
                  <span className="dot" />
                  <span>{info.text}</span>
                </div>
              </div>
              {(r.status === 'ready' || r.status === 'error') && (
                <button
                  className="repo-delete"
                  title="Delete repository"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(r.id);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="sidebar-foot">Local Git metrics dashboard</div>
    </aside>
  );
}
