async function handle(res) {
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data && data.error) message = data.error;
    } catch {
      // keep the default message
    }
    throw new Error(message);
  }
  return res.json();
}

export const api = {
  get: (url) => fetch(url).then(handle),
  post: (url, body) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(handle),
  upload: (url, formData) => fetch(url, { method: 'POST', body: formData }).then(handle),
  del: (url) => fetch(url, { method: 'DELETE' }).then(handle),
};

export function formatInt(n) {
  return (n ?? 0).toLocaleString('en-US');
}

export function formatPercent(x, digits = 0) {
  return `${((x ?? 0) * 100).toFixed(digits)}%`;
}

export function formatDate(ts) {
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
