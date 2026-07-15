// api.js — バックエンドとの通信 & クライアント状態
export const state = {
  token: localStorage.getItem('crm_token') || null,
  me: null,          // { user, entities, phases, phaseGuards, lossReasons, contractTypes, masters, users, scope }
};

async function req(method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `エラー (${res.status})`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (u) => req('GET', u),
  post: (u, b) => req('POST', u, b),
  put: (u, b) => req('PUT', u, b),
  del: (u) => req('DELETE', u),
};

export async function login(email, password) {
  const data = await req('POST', '/api/login', { email, password });
  state.token = data.token;
  localStorage.setItem('crm_token', data.token);
  return data;
}

export function logout() {
  state.token = null; state.me = null;
  localStorage.removeItem('crm_token');
}

export async function bootstrap() {
  state.me = await api.get('/api/me');
  return state.me;
}

// ---- ルックアップ用ヘルパー ----
export function phaseByKey(key) { return (state.me.phases || []).find((p) => p.key === key); }
export function userName(id) { const u = (state.me.users || []).find((x) => x.id === id); return u ? u.name : '—'; }
export function entityName(id) { const e = (state.me.entities || []).find((x) => x.id === id); return e ? e.name : '—'; }
export function contractTypeLabel(id) { const c = (state.me.contractTypes || []).find((x) => x.id === id); return c ? c.label : '—'; }
export function lossReasonLabel(id) { const r = (state.me.lossReasons || []).find((x) => x.id === id); return r ? r.label : '—'; }
export function isAdmin() { return state.me && state.me.user.role === 'admin'; }
export function master(key) { return (state.me.masters && state.me.masters[key]) || []; }

// 複数IDを順次削除（base 例: '/api/accounts'）。{ok, fail} を返す。
export async function bulkDelete(base, ids) {
  let ok = 0, fail = 0;
  for (const id of ids) {
    try { await api.del(`${base}/${id}`); ok += 1; } catch (e) { fail += 1; }
  }
  return { ok, fail };
}
