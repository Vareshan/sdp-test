# Repo Analysis Tool (RAT)

A web dashboard for analysing one or more Git repositories. Repositories are
ingested either by **cloning a URL** or by **uploading a zip archive that
contains the `.git` directory**, and the app then reports line-based metrics
for files, directories, repository roots, commit sets and authors.

## Requirements

- Node.js >= 18 and npm
- `git` on the PATH (used for cloning and for reading repository history)
- No other system packages: zip archives are parsed in-process

## Quick start (development)

```bash
npm install
npm run dev
```

- Frontend (Vite dev server with hot reload): http://localhost:5173
- Backend API: http://localhost:3001 — the frontend proxies `/api` to it

The two servers can also be run in separate terminals with
`npm run dev:backend` and `npm run dev:frontend`.

## Production build (single port)

```bash
npm install
npm run build     # builds the frontend into frontend/dist
npm start         # serves API + built frontend on http://localhost:3001
```

Set `PORT` to change the port, e.g. `PORT=8080 npm start`.

## Scripts

| Script                  | Description                                            |
| ----------------------- | ------------------------------------------------------ |
| `npm run dev`           | Backend (:3001) + Vite dev server (:5173) together     |
| `npm run dev:backend`   | Backend only, with `node --watch` hot reload           |
| `npm run dev:frontend`  | Vite dev server only                                   |
| `npm run build`         | Production build of the frontend                       |
| `npm start`             | Serve API + built frontend from one port               |
| `npm run rebuild:native`| Rebuild the better-sqlite3 native module if needed     |

## Using it

1. Click **+ Add repository** and either paste a clone URL (e.g.
   `https://github.com/DaveGamble/cJSON.git`) or upload a zip that contains a
   `.git` folder (at the archive root or one level below it). Optionally set a
   **reference commit** (branch, tag or hash) to analyse the history up to that
   revision — useful for reproducing metrics quoted at a specific commit.
2. Ingestion runs in the background. The sidebar shows progress
   (queued → cloning/extracting → parsing → ready) or an error message.
3. Explore the tabs: **Overview** (repository metrics + weekly line history +
   top files), **Files** (browse the directory tree; click a file for its
   detail panel with per-commit history and author ownership), **Commits**
   (newest first, expandable to the files it changed) and **Authors**
   (per-author metrics and ownership share).

### Commit-set filtering

The filter bar above the tabs restricts every metric to a subset H of commits.
Three dimensions can be combined (AND):

- **Time** — presets (last 7/30 days, last year) or a custom From/Until range
  on committer dates; the indicator shows "Commit set: N of M commits".
- **Authors** — pick one or more identities from the searchable dropdown.
- **Manual selection** — tick commits in the **Commits** tab and press
  *Use selection as commit set*. The applied set shows as a chip in the filter
  bar and clearable there.

All views (Overview, Files, commit detail, Authors) recompute against the
filtered set; modification frequency and churn rate use the filtered |H|.

### Manual author merges

If a repository has no `.mailmap` (or misses entries), open the **Authors** tab,
tick two or more identities, click *Merge selected identities* and choose the
canonical identity to keep. Commit authorship and per-author metrics are folded
into the target identity everywhere in the dashboard; applied merges are listed
on the tab.

State (SQLite database + cloned repositories) is stored under `./data` and
persists across restarts.

## Metrics

Metric correctness is delegated to Git's own diff engine. History is read with:

```
git log <ref> --no-merges --use-mailmap -M50% --numstat -z
```

so that merge commits are excluded, renames are detected at the 50 % threshold
and attributed to the new path, binary files contribute no line counts, and
`.mailmap` identities are applied. Without an explicit reference, `<ref>` is
the repository's HEAD.

For every file, directory and repository root:

- **Added / Removed** (`l+`, `l−`): total added/removed lines over the commit set
- **Growth** `δ = l+ − l−`; **Churn** `λ = l+ + l−`
- **Modifications** `n`: number of commits with `λ > 0`
- **Modification frequency** `η = n / |H|` and **churn rate** `ρ = λ / |H|`,
  where `H` is the set of all non-merge commits

For every author: commits, modifications, added/removed/churn and
**ownership** `ω = λ_author / λ_total` (share of the repository's total churn).

## Configuration

- `PORT` — backend port (default `3001`)
- `RAT_DATA_DIR` — data directory for the SQLite database and cloned
  repositories (default `./data`, git-ignored)

## Troubleshooting

**better-sqlite3 fails to install or load.** Prebuilt binaries cover standard
Node.js releases. If your Node.js build reports a non-standard
`NODE_MODULE_VERSION` (some Linux distribution builds), run:

```bash
npm install --ignore-scripts
npm run rebuild:native
```

The fallback compiles better-sqlite3 from source against your local Node
headers (requires `make`, a C++ compiler and Python 3).
