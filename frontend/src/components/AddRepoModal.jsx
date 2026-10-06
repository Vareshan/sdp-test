import { useState } from 'react';
import { api } from '../api.js';

export default function AddRepoModal({ onClose, onCreated }) {
  const [mode, setMode] = useState('clone');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      let res;
      if (mode === 'clone') {
        res = await api.post('/api/repos/clone', { url: url.trim() });
      } else {
        if (!file) throw new Error('Choose a .zip file first.');
        const fd = new FormData();
        fd.append('file', file);
        res = await api.upload('/api/repos/upload', fd);
      }
      onCreated(res.id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add repository</h2>
        <div className="modal-tabs">
          <button
            className={`modal-tab${mode === 'clone' ? ' active' : ''}`}
            onClick={() => setMode('clone')}
            type="button"
          >
            Clone URL
          </button>
          <button
            className={`modal-tab${mode === 'zip' ? ' active' : ''}`}
            onClick={() => setMode('zip')}
            type="button"
          >
            Upload zip
          </button>
        </div>
        <form onSubmit={submit}>
          {mode === 'clone' ? (
            <div className="form-row">
              <input
                className="input"
                type="text"
                placeholder="https://github.com/owner/repo.git"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                autoFocus
              />
              <div className="hint">
                The repository is fully cloned (all history) and analysed on the server.
              </div>
            </div>
          ) : (
            <div className="form-row">
              <input
                className="input"
                type="file"
                accept=".zip,application/zip"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <div className="hint">
                Upload a zip of the repository that contains its .git directory.
              </div>
            </div>
          )}
          {error && <div className="error-text">{error}</div>}
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || (mode === 'clone' ? !url.trim() : !file)}
            >
              {busy ? 'Starting...' : 'Add repository'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
