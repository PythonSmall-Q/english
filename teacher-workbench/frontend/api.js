/**
 * api.js — 统一 API Client（§65）
 *
 * 约定：
 * - 页面禁止直接 fetch('/api/...')，一律走本文件的 api.* 命名空间
 * - baseURL：localStorage.API_BASE 覆盖 > 本地开发 localhost:8787 > 同源 /api/v1
 * - 统一 credentials:'include'（Session 走 HttpOnly Cookie）、Content-Type: application/json
 * - 自动携带 X-Tenant-Id 头（当前租户，来自 App.state.tenant）
 * - 响应解包：成功返回 data；失败统一 throw { code, message }
 */

(function () {
  /**
   * 推导 API baseURL。
   * @returns {string}
   */
  function resolveBase() {
    const override = localStorage.getItem('API_BASE');
    if (override) return override.replace(/\/$/, '');
    const host = location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      // 本地开发：wrangler dev 默认端口 8787
      return 'http://localhost:8787/api/v1';
    }
    return location.origin + '/api/v1';
  }

  const BASE = resolveBase();

  /**
   * 统一请求。query 为对象时拼到 URL 上。
   * @throws {{code:string,message:string}} 业务错误或网络错误
   */
  async function request(path, { method = 'GET', body, query } = {}) {
    let url = BASE + path;
    if (query) {
      const qs = new URLSearchParams(
        Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')
      ).toString();
      if (qs) url += '?' + qs;
    }
    const headers = { 'Content-Type': 'application/json' };
    const tenantId = window.App?.state?.tenant?.id;
    if (tenantId) headers['X-Tenant-Id'] = tenantId;

    let res;
    try {
      res = await fetch(url, {
        method,
        credentials: 'include',
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw { code: 'NETWORK_ERROR', message: '网络异常，请检查后端服务是否启动' };
    }

    let payload = null;
    try {
      payload = await res.json();
    } catch (e) {
      throw { code: 'INTERNAL_ERROR', message: `服务响应异常（HTTP ${res.status}）` };
    }
    if (payload && payload.success) return payload.data;
    const err = payload?.error || {};
    throw { code: err.code || 'INTERNAL_ERROR', message: err.message || '请求失败' };
  }

  // —— Auth（§53）——
  const auth = {
    register: (body) => request('/auth/register', { method: 'POST', body }),
    login: (body) => request('/auth/login', { method: 'POST', body }),
    logout: () => request('/auth/logout', { method: 'POST' }),
    me: () => request('/auth/me'),
  };

  // —— Tenants（§53/§73/§74/§75）——
  const tenants = {
    list: () => request('/tenants'),
    get: (id) => request(`/tenants/${id}`),
    create: (body) => request('/tenants', { method: 'POST', body }),
    // 成员列表随租户详情返回（GET /tenants/:id → data.members）
    members: async (id) => (await request(`/tenants/${id}`)).members || [],
    invite: (id, body) => request(`/tenants/${id}/members`, { method: 'POST', body }),
    accept: (token) => request('/tenants/invitations/accept', { method: 'POST', body: { token } }),
    removeMember: (id, userId) => request(`/tenants/${id}/members/${userId}`, { method: 'DELETE' }),
  };

  // —— Classes（§54）——
  const classes = {
    list: (query) => request('/classes', { query }),
    create: (body) => request('/classes', { method: 'POST', body }),
    get: (id) => request(`/classes/${id}`),
    update: (id, body) => request(`/classes/${id}`, { method: 'PUT', body }),
    remove: (id) => request(`/classes/${id}`, { method: 'DELETE' }),
  };

  // —— Students（§55）——
  const students = {
    list: (query) => request('/students', { query }),
    create: (body) => request('/students', { method: 'POST', body }),
    get: (id) => request(`/students/${id}`),
    update: (id, body) => request(`/students/${id}`, { method: 'PUT', body }),
    remove: (id) => request(`/students/${id}`, { method: 'DELETE' }),
    search: (q, query) => request('/students/search', { query: { q, ...query } }),
  };

  // —— Lessons 备课中心（§56）——
  const lessons = {
    list: (query) => request('/lessons', { query }),
    create: (body) => request('/lessons', { method: 'POST', body }),
    update: (id, body) => request(`/lessons/${id}`, { method: 'PUT', body }),
    remove: (id) => request(`/lessons/${id}`, { method: 'DELETE' }),
  };

  // —— Schedules 教学课表（§60）——
  const schedules = {
    list: (query) => request('/schedules', { query }),
    create: (body) => request('/schedules', { method: 'POST', body }),
    update: (id, body) => request(`/schedules/${id}`, { method: 'PUT', body }),
    remove: (id) => request(`/schedules/${id}`, { method: 'DELETE' }),
  };

  // —— Assignments 作业统计（§57）——
  const assignments = {
    list: (query) => request('/assignments', { query }),
    create: (body) => request('/assignments', { method: 'POST', body }),
    update: (id, body) => request(`/assignments/${id}`, { method: 'PUT', body }),
    remove: (id) => request(`/assignments/${id}`, { method: 'DELETE' }),
    bulkSubmissions: (id, rows) => request(`/assignments/${id}/submissions/bulk`, { method: 'POST', body: { rows } }),
    submissions: (id) => request(`/assignments/${id}/submissions`),
  };

  // —— Dictations 默写管理（§58）——
  const dictations = {
    list: (query) => request('/dictations', { query }),
    create: (body) => request('/dictations', { method: 'POST', body }),
    get: (id) => request(`/dictations/${id}`),
    update: (id, body) => request(`/dictations/${id}`, { method: 'PUT', body }),
    remove: (id) => request(`/dictations/${id}`, { method: 'DELETE' }),
    bulkResults: (id, rows) => request(`/dictations/${id}/results/bulk`, { method: 'POST', body: { rows } }),
    retest: (id, body) => request(`/dictations/${id}/retest`, { method: 'POST', body }),
  };

  // —— Exams 考试成绩（§59）——
  const exams = {
    list: (query) => request('/exams', { query }),
    create: (body) => request('/exams', { method: 'POST', body }),
    get: (id) => request(`/exams/${id}`),
    update: (id, body) => request(`/exams/${id}`, { method: 'PUT', body }),
    remove: (id) => request(`/exams/${id}`, { method: 'DELETE' }),
    import: (id, body) => request(`/exams/${id}/import`, { method: 'POST', body }),
    analysis: (id) => request(`/exams/${id}/analysis`),
    studentReport: (id, studentId) => request(`/exams/${id}/students/${studentId}`),
  };

  // —— Dashboard（§40）——
  const dashboard = {
    get: () => request('/dashboard'),
  };

  // —— AI 教学助手（§42）——
  const ai = {
    generate: (body) => request('/ai/generate', { method: 'POST', body }),
    history: (query) => request('/ai/history', { query }),
  };

  // —— Files（§45，R2 未上线时后端返回 R2_DEVELOPING 501）——
  const files = {
    create: (body) => request('/files', { method: 'POST', body }),
    get: (id) => request(`/files/${id}`),
    remove: (id) => request(`/files/${id}`, { method: 'DELETE' }),
  };

  // —— 数据导入（§47/§48/§49）——
  const imp = {
    students: (body) => request('/import/students', { method: 'POST', body }),
    schedules: (body) => request('/import/schedules', { method: 'POST', body }),
    // TODO: 后端恢复备份端点待集成（§51），联调时确认实际路径
    restore: (body) => request('/import/restore', { method: 'POST', body }),
  };

  // —— 数据导出（§50/§51）——
  const exp = {
    backup: () => request('/export/backup'),
    students: () => request('/export/students'),
  };

  // —— 平台管理（§72/§73，仅 platform_admin）——
  const admin = {
    tenants: () => request('/admin/tenants'),
    users: () => request('/admin/users'),
    status: () => request('/admin/status'),
    setStatus: (id, status) => request(`/admin/tenants/${id}/status`, { method: 'PUT', body: { status } }),
    setQuota: (id, quotas) => request(`/admin/tenants/${id}/quota`, { method: 'PUT', body: quotas }),
  };

  window.api = { auth, tenants, classes, students, lessons, schedules, assignments, dictations, exams, dashboard, ai, files, import: imp, export: exp, admin };
})();
