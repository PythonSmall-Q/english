/* api-v2.js — 新版前端的聚合 API 客户端 */
(function () {
  function resolveBase() {
    const override = localStorage.getItem('API_BASE');
    const runtimeBase = override || window.WB_RUNTIME?.apiBase || '';
    if (runtimeBase) return runtimeBase.replace(/\/api\/v1\/?$/, '/api/v2').replace(/\/$/, '');
    const host = location.hostname;
    if (location.protocol === 'capacitor:' || (location.protocol === 'https:' && host === 'localhost' && !location.port)) {
      return 'https://fff-api.xmoj-script.uk/api/v2';
    }
    if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:8787/api/v2';
    if (host === 'fff.xmoj-script.uk') return 'https://fff-api.xmoj-script.uk/api/v2';
    return `${location.origin}/api/v2`;
  }

  const BASE = resolveBase();
  const BOOKMARK_KEYS = {
    'x-d1-bookmark': 'd1-bookmark',
    'x-trial-d1-bookmark': 'trial-d1-bookmark',
    'x-grad-d1-bookmark': 'grad-d1-bookmark',
  };

  function addBookmarks(headers) {
    Object.entries(BOOKMARK_KEYS).forEach(([header, key]) => {
      const value = sessionStorage.getItem(key);
      if (value) headers[header] = value;
    });
  }

  function saveBookmarks(response) {
    Object.entries(BOOKMARK_KEYS).forEach(([header, key]) => {
      const value = response.headers.get(header);
      if (value) sessionStorage.setItem(key, value);
    });
  }

  async function request(path, { method = 'GET', body, query, signal } = {}) {
    const url = new URL(BASE + path);
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    });
    const headers = { 'Content-Type': 'application/json' };
    const tenantId = window.App?.state?.tenant?.id;
    const viewAs = window.App?.state?.viewAs?.userId;
    if (tenantId) headers['X-Tenant-Id'] = tenantId;
    if (viewAs) headers['X-View-As'] = viewAs;
    addBookmarks(headers);
    const requestId = crypto.randomUUID();
    headers['X-Request-Id'] = requestId;
    const response = await fetch(url, {
      method,
      credentials: 'include',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    saveBookmarks(response);
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
      const error = payload?.error || {};
      throw { code: error.code || `HTTP_${response.status}`, message: error.message || '请求失败', requestId };
    }
    return { data: payload.data, meta: payload.meta || {}, requestId };
  }

  const v2 = {
    base: BASE,
    request,
    context: (query = {}, options = {}) => request('/context', { query, ...options }),
    commands: (commands, options = {}) => request('/commands', { method: 'POST', body: { commands }, ...options }),
  };

  window.apiV2 = v2;
})();
