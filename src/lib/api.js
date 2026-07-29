// ─── Server API helpers ───────────────────────────────────────────────────────
async function handle(res) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || err?.errors?.[0]?.detail || `Error ${res.status}`);
  }
  return res.json();
}

export const api = {
  get: (path) => fetch(path).then(handle),
  post: (path, body) => fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body != null ? JSON.stringify(body) : undefined,
  }).then(handle),
  patch: (path, body) => fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(handle),
  del: (path) => fetch(path, { method: "DELETE" }).then(handle),
  upload: (path, formData) => fetch(path, { method: "POST", body: formData }).then(handle),
};

export async function checkProxy() {
  try {
    const res = await fetch("/health", { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch { return false; }
}
