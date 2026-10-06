import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import Sidebar from './components/Sidebar.jsx';
import AddRepoModal from './components/AddRepoModal.jsx';
import StatusPanel from './components/StatusPanel.jsx';
import FilterBar from './components/FilterBar.jsx';
import Overview from './components/Overview.jsx';
import FilesTab from './components/FilesTab.jsx';
import CommitsTab from './components/CommitsTab.jsx';
import AuthorsTab from './components/AuthorsTab.jsx';
import ObjectDrawer from './components/ObjectDrawer.jsx';
import CompareView from './components/CompareView.jsx';

const TABS = [
  ['overview', 'Overview'],
  ['files', 'Files'],
  ['commits', 'Commits'],
  ['authors', 'Authors'],
];

const EMPTY_FILTER = { from: null, to: null, authors: [], commits: [] };

export default function App() {
  const [repos, setRepos] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [meta, setMeta] = useState(null);
  const [tab, setTab] = useState('overview');
  const [refreshKey, setRefreshKey] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [object, setObject] = useState(null);
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [mode, setMode] = useState('analysis');

  const selectedIdRef = useRef(null);
  selectedIdRef.current = selectedId;
  const readyRef = useRef(new Map());

  // Poll the repository list (progress updates while ingestion runs).
  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const list = await api.get('/api/repos');
        if (!alive) return;
        setRepos(list);
        for (const r of list) {
          const was = readyRef.current.get(r.id);
          if (was === false && r.status === 'ready') setRefreshKey((k) => k + 1);
          readyRef.current.set(r.id, r.status === 'ready');
        }
        if (selectedIdRef.current == null && list.length) setSelectedId(list[0].id);
      } catch {
        // backend may still be starting up
      }
    }
    tick();
    const iv = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  // Poll the selected repository's ingestion status.
  useEffect(() => {
    if (selectedId == null) {
      setMeta(null);
      return;
    }
    let alive = true;
    async function fetchMeta() {
      try {
        const m = await api.get(`/api/repos/${selectedId}`);
        if (!alive) return;
        setMeta((prev) =>
          prev &&
          prev.id === m.id &&
          prev.status === m.status &&
          prev.progress === m.progress &&
          prev.error === m.error &&
          prev.commit_count === m.commit_count
            ? prev
            : m
        );
      } catch {
        // ignore transient errors while polling
      }
    }
    fetchMeta();
    const iv = setInterval(fetchMeta, 1200);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [selectedId]);

  // Detach the object drawer and reset the commit-set filter when switching repositories.
  useEffect(() => {
    setObject(null);
    setFilter(EMPTY_FILTER);
  }, [selectedId]);

  // Filter -> query string shared by every metrics fetch.
  const filterQS = useMemo(() => {
    const p = new URLSearchParams();
    if (filter.from) p.set('from', String(filter.from));
    if (filter.to) p.set('to', String(filter.to));
    if (filter.authors.length) p.set('authors', filter.authors.join(','));
    if (filter.commits.length) p.set('commits', filter.commits.join(','));
    return p.toString();
  }, [filter]);

  const selectedRepo = repos.find((r) => r.id === selectedId) || null;
  const ready = meta?.status === 'ready';

  async function handleDelete(id) {
    if (!window.confirm('Delete this repository and all of its analysed data?')) return;
    try {
      await api.del(`/api/repos/${id}`);
      readyRef.current.delete(id);
      setRepos((prev) => prev.filter((r) => r.id !== id));
      if (selectedIdRef.current === id) setSelectedId(null);
    } catch (err) {
      window.alert(err.message);
    }
  }

  return (
    <div className="app">
      <Sidebar
        repos={repos}
        selectedId={selectedId}
        onSelect={(id) => {
          setMode('analysis');
          setSelectedId(id);
        }}
        onAdd={() => setShowAdd(true)}
        onDelete={handleDelete}
        onCompare={() => setMode(mode === 'compare' ? 'analysis' : 'compare')}
        compareActive={mode === 'compare'}
      />
      <main className="main">
        {mode === 'compare' ? (
          <CompareView repos={repos} refreshKey={refreshKey} />
        ) : !selectedRepo ? (
          <div className="empty">
            Add a repository to begin: clone a remote URL or upload a zip file containing .git.
          </div>
        ) : (
          <>
            <header className="main-header">
              <h1 className="main-title">{selectedRepo.name}</h1>
              {ready && meta.head && (
                <span className="head-hash">
                  commit {meta.head.slice(0, 10)}
                  {meta.branch && meta.branch !== 'HEAD' ? ` (${meta.branch})` : ''}
                </span>
              )}
            </header>
            {!ready ? (
              <StatusPanel meta={meta} />
            ) : (
              <>
                <FilterBar
                  repoId={selectedId}
                  filter={filter}
                  setFilter={setFilter}
                  qs={filterQS}
                  refreshKey={refreshKey}
                />
                <nav className="tabs">
                  {TABS.map(([id, label]) => (
                    <button
                      key={id}
                      className={`tab${tab === id ? ' active' : ''}`}
                      onClick={() => setTab(id)}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
                <div className="content">
                  {tab === 'overview' && (
                    <Overview repoId={selectedId} refreshKey={refreshKey} qs={filterQS} />
                  )}
                  {tab === 'files' && (
                    <FilesTab repoId={selectedId} refreshKey={refreshKey} qs={filterQS} onOpenObject={setObject} />
                  )}
                  {tab === 'commits' && (
                    <CommitsTab repoId={selectedId} qs={filterQS} filter={filter} setFilter={setFilter} />
                  )}
                  {tab === 'authors' && (
                    <AuthorsTab
                      repoId={selectedId}
                      refreshKey={refreshKey}
                      qs={filterQS}
                      filter={filter}
                      setFilter={setFilter}
                      onChanged={() => setRefreshKey((k) => k + 1)}
                    />
                  )}
                </div>
              </>
            )}
          </>
        )}
      </main>
      {object && ready && mode === 'analysis' && (
        <ObjectDrawer repoId={selectedId} object={object} qs={filterQS} onClose={() => setObject(null)} />
      )}
      {showAdd && (
        <AddRepoModal
          onClose={() => setShowAdd(false)}
          onCreated={(id) => {
            setShowAdd(false);
            setMode('analysis');
            setSelectedId(id);
            setTab('overview');
            setObject(null);
          }}
        />
      )}
    </div>
  );
}
