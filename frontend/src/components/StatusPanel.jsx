const PHASES = {
  queued: 'Queued...',
  cloning: 'Cloning repository...',
  extracting: 'Extracting zip archive...',
  parsing: 'Analysing commit history...',
  indexing: 'Finalising metrics...',
};

export default function StatusPanel({ meta }) {
  if (!meta) return <div className="loading">Loading...</div>;

  if (meta.status === 'error') {
    return (
      <div className="status-panel">
        <div className="status-phase">Ingestion failed</div>
        <div className="error-text">{meta.error || 'Unknown error.'}</div>
        <div className="hint">Delete this repository (the x in the sidebar) and add it again to retry.</div>
      </div>
    );
  }

  const pct = Math.round((meta.progress || 0) * 100);
  return (
    <div className="status-panel">
      <div className="status-phase">{PHASES[meta.status] || meta.status}</div>
      <div className="progress">
        <div className="progress-bar" style={{ width: `${pct}%` }} />
      </div>
      <div className="hint">
        {pct}% - metrics appear automatically when ingestion completes.
      </div>
    </div>
  );
}
