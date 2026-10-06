import { useEffect, useMemo, useRef, useState } from 'react';
import { api, formatInt, withQuery } from '../api.js';

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

// FilterBar defines the commit set H that every metric view is computed over.
// Dimensions: a committer-date window (from inclusive, until inclusive in the
// UI -> exclusive `to` in the API) and a set of authors. The manual commit
// list is applied from the Commits tab and shown here as a chip.
export default function FilterBar({ repoId, filter, setFilter, qs, refreshKey }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [authors, setAuthors] = useState(null);
  const [counts, setCounts] = useState(null);
  const wrapRef = useRef(null);

  // Full (unfiltered) author roster for the picker - always the merged list.
  useEffect(() => {
    let alive = true;
    setAuthors(null);
    setSearch('');
    api
      .get(`/api/repos/${repoId}/authors`)
      .then((d) => alive && setAuthors(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [repoId, refreshKey]);

  // Commit-set size indicator: "N of M commits".
  useEffect(() => {
    let alive = true;
    api
      .get(withQuery(`/api/repos/${repoId}/summary`, qs))
      .then((d) => alive && setCounts({ commits: d.stats.commits, total: d.totalCommits }))
      .catch(() => alive && setCounts(null));
    return () => {
      alive = false;
    };
  }, [repoId, qs]);

  useEffect(() => {
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const today = startOfDayFromDateValue(dateValueFromTs(Math.floor(Date.now() / 1000)));
  const presets = [
    { id: 'all', label: 'Whole history', from: null, to: null },
    { id: '7d', label: 'Last 7 days', from: today - 6 * DAY, to: today + DAY },
    { id: '30d', label: 'Last 30 days', from: today - 29 * DAY, to: today + DAY },
    { id: '1y', label: 'Last year', from: today - 364 * DAY, to: today + DAY },
  ];

  function setRange(from, to) {
    setFilter((f) => ({ ...f, from, to }));
  }

  function toggleAuthor(key) {
    setFilter((f) => ({
      ...f,
      authors: f.authors.includes(key) ? f.authors.filter((k) => k !== key) : [...f.authors, key],
    }));
  }

  function clearAll() {
    setFilter({ from: null, to: null, authors: [], commits: [] });
  }

  const filteredAuthors = useMemo(() => {
    if (!authors) return [];
    const s = search.trim().toLowerCase();
    if (!s) return authors;
    return authors.filter(
      (a) => a.name.toLowerCase().includes(s) || a.email.toLowerCase().includes(s)
    );
  }, [authors, search]);

  const activeCount = (filter.from || filter.to ? 1 : 0) + filter.authors.length + filter.commits.length;
  const fromVal = dateValueFromTs(filter.from);
  const toVal = filter.to ? dateValueFromTs(filter.to - 1) : '';

  return (
    <div className="filter-bar" ref={wrapRef}>
      <span className="filter-title">Filter commit set</span>

      {presets.map((p) => {
        const active = p.from === filter.from && p.to === filter.to;
        return (
          <button
            key={p.id}
            className={`preset${active ? ' active' : ''}`}
            onClick={() => setRange(p.from, p.to)}
            type="button"
          >
            {p.label}
          </button>
        );
      })}

      <span className="filter-label">From</span>
      <input
        type="date"
        className="input date-input"
        value={fromVal}
        onChange={(e) => setRange(e.target.value ? startOfDayFromDateValue(e.target.value) : null, filter.to)}
      />
      <span className="filter-label">Until</span>
      <input
        type="date"
        className="input date-input"
        value={toVal}
        onChange={(e) => setRange(filter.from, e.target.value ? startOfDayFromDateValue(e.target.value) + DAY : null)}
      />

      <div className="author-wrap">
        <button
          className={`btn btn-sm${filter.authors.length ? ' btn-on' : ''}`}
          onClick={() => setOpen((o) => !o)}
          type="button"
        >
          Authors: {filter.authors.length ? `${filter.authors.length} selected` : 'all'}
        </button>
        {open && (
          <div className="author-picker">
            <input
              className="input"
              type="text"
              placeholder="Search authors..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="picker-list">
              {authors === null && <div className="hint">Loading authors...</div>}
              {authors !== null && filteredAuthors.length === 0 && (
                <div className="hint">No authors match.</div>
              )}
              {filteredAuthors.map((a) => (
                <label key={a.key} className="picker-row" title={a.key}>
                  <input
                    type="checkbox"
                    checked={filter.authors.includes(a.key)}
                    onChange={() => toggleAuthor(a.key)}
                  />
                  <span className="picker-name">{a.name}</span>
                  <span className="picker-meta">
                    {formatInt(a.commit_count)} commits · {formatInt(a.churn)} churn
                  </span>
                </label>
              ))}
            </div>
            {filter.authors.length > 0 && (
              <button
                className="btn btn-sm"
                type="button"
                onClick={() => setFilter((f) => ({ ...f, authors: [] }))}
              >
                Clear author selection
              </button>
            )}
          </div>
        )}
      </div>

      {filter.commits.length > 0 && (
        <span className="fchip">
          {formatInt(filter.commits.length)} commits selected (Commits tab)
          <button
            className="fchip-x"
            title="Clear commit selection"
            onClick={() => setFilter((f) => ({ ...f, commits: [] }))}
          >
            ×
          </button>
        </span>
      )}

      {activeCount > 0 && (
        <button className="btn btn-sm" type="button" onClick={clearAll}>
          Clear all
        </button>
      )}

      <span className="filter-set">
        Commit set: {counts ? `${formatInt(counts.commits)} of ${formatInt(counts.total)}` : '…'} commits
      </span>
    </div>
  );
}
