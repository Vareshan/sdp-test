import { spawn } from 'node:child_process';

// One streaming `git log` pass produces every number the metric engine needs:
//  - --no-merges: only non-merge commits (as defined by the specification)
//  - --use-mailmap: author identities are merged through the repository .mailmap
//  - -M50%: rename detection at the 50% similarity threshold (Git's own engine)
//  - --numstat: per-file added/removed line counts (binary files show as "-")
//  - -z: NUL-separated records so paths containing any character parse safely
//
// Verified byte layout with -z (od -c):
//   <RS><hash><SOH><author name><SOH><author email><SOH><committer ts> NUL LF
//   <added>\t<removed>\t<path> NUL                          (normal file)
//   <added>\t<removed>\t NUL<old path> NUL<new path> NUL    (rename; attribute to new path)
//   -\t-\t<path> NUL                                        (binary; never measured)
// where RS = 0x1e and SOH = 0x01.
const LOG_FORMAT = '%x1e%H%x01%aN%x01%aE%x01%ct';

export function gitLogArgs(ref = 'HEAD') {
  return [
    'log',
    ref,
    '--no-merges',
    '--use-mailmap',
    '-M50%',
    '--numstat',
    '-z',
    `--format=${LOG_FORMAT}`,
  ];
}

/**
 * Streams the parsed history of `repoDir` at `ref`.
 * Calls `onCommit({hash, name, email, ts, files, dirs})` once per commit, where:
 *   files: [{path, added, removed}]           (binary and zero-change rows skipped)
 *   dirs:  Map<dirPath, {added, removed}>     (each file change propagated to all
 *                                             ancestor directories, including the
 *                                             root which is the empty string path)
 * Calls `onProgress(commitsParsed, totalCommits)` while parsing (throttled).
 */
export function streamGitLog(repoDir, ref, { onCommit, onProgress, totalCommits } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', gitLogArgs(ref), { cwd: repoDir });

    let buf = Buffer.alloc(0);
    let stderr = '';
    let current = null;
    let commitCount = 0;
    let lastProgressAt = 0;

    let renameLeft = 0;
    let renamePaths = [];
    let renameCounts = null;

    const addFileEntry = (filePath, a, r) => {
      current.files.push({ path: filePath, added: a, removed: r });
      const parts = filePath.split('/');
      for (let i = 0; i < parts.length - 1; i++) {
        const dirPath = parts.slice(0, i + 1).join('/');
        let entry = current.dirs.get(dirPath);
        if (!entry) {
          entry = { added: 0, removed: 0 };
          current.dirs.set(dirPath, entry);
        }
        entry.added += a;
        entry.removed += r;
      }
      let root = current.dirs.get('');
      if (!root) {
        root = { added: 0, removed: 0 };
        current.dirs.set('', root);
      }
      root.added += a;
      root.removed += r;
    };

    const finishCommit = () => {
      if (!current) return;
      commitCount++;
      onCommit?.(current);
      current = null;
      if (onProgress && totalCommits) {
        const now = Date.now();
        if (now - lastProgressAt > 300) {
          lastProgressAt = now;
          onProgress(commitCount, totalCommits);
        }
      }
    };

    const processToken = (token) => {
      if (renameLeft > 0) {
        renamePaths.push(token);
        renameLeft--;
        if (renameLeft === 0) {
          const [a, r] = renameCounts;
          if (a !== 0 || r !== 0) addFileEntry(renamePaths[1], a, r);
          renamePaths = [];
          renameCounts = null;
        }
        return;
      }

      if (token.charCodeAt(0) === 0x1e) {
        finishCommit();
        const parts = token.slice(1).split('\x01');
        if (parts.length >= 4) {
          current = {
            hash: parts[0],
            name: parts[1],
            email: parts[2],
            ts: parseInt(parts[3], 10) || 0,
            files: [],
            dirs: new Map(),
          };
        } else {
          current = null;
        }
        return;
      }

      if (!current) return;

      // The first numstat entry of a commit is prefixed with a LF separator.
      const t = token.charCodeAt(0) === 0x0a ? token.slice(1) : token;
      if (!t) return;
      const t1 = t.indexOf('\t');
      if (t1 < 0) return;
      const t2 = t.indexOf('\t', t1 + 1);
      if (t2 < 0) return;

      const aStr = t.slice(0, t1);
      const rStr = t.slice(t1 + 1, t2);
      const rest = t.slice(t2 + 1);

      if (aStr === '-') return; // binary file: not measured

      const a = parseInt(aStr, 10);
      const r = parseInt(rStr, 10);
      if (!Number.isFinite(a) || !Number.isFinite(r)) return;

      if (rest === '') {
        // Rename entry: the next two NUL tokens are old path and new path.
        renameCounts = [a, r];
        renamePaths = [];
        renameLeft = 2;
        return;
      }

      if (a === 0 && r === 0) return; // no line change: nothing to measure
      addFileEntry(rest, a, r);
    };

    child.stdout.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      let idx;
      while ((idx = buf.indexOf(0)) !== -1) {
        const token = buf.subarray(0, idx).toString('utf8');
        buf = buf.subarray(idx + 1);
        processToken(token);
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 100000) stderr = stderr.slice(-100000);
    });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (buf.length) processToken(buf.toString('utf8'));
      finishCommit();
      if (code === 0) {
        resolve({ commits: commitCount });
      } else {
        const firstLine = stderr.trim().split('\n')[0] || 'unknown error';
        reject(new Error(`git log failed: ${firstLine}`));
      }
    });
  });
}
