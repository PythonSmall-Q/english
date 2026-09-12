/**
 * api.js — 统一 API Client（§65）
 *
 * 约定：
 * - 页面禁止直接 fetch('/api/...')，一律走本文件的 api.* 命名空间
 * - baseURL：localStorage.API_BASE 覆盖 > 本地开发 localhost:8787 > 生产域名配对（fff.xmoj-script.uk → fff-api.xmoj-script.uk）> 同源 /api/v1
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
    // 生产：前端 fff.xmoj-script.uk ↔ API fff-api.xmoj-script.uk（跨域 + Cookie 需后端 CORS 白名单）
    if (host === 'fff.xmoj-script.uk') {
      return 'https://fff-api.xmoj-script.uk/api/v1';
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
    updateMe: (body) => request('/auth/me', { method: 'PUT', body }),
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
    /** 移除成员（软删除：数据保留，可重新添加恢复）；owner/admin 可用，admin 不能移除 owner */
    removeMember: (id, userId) => request(`/tenants/${id}/members/${userId}`, { method: 'DELETE' }),
    /** 租户管理员直接添加账户（邮箱已注册直接加入，未注册现场开户） */
    addAccount: (id, body) => request(`/tenants/${id}/accounts`, { method: 'POST', body }),
    /** 成员配额明细：active+removed 成员、各人用量与按用户配额、租户总用量 */
    quotaDetail: (id) => request(`/tenants/${id}/quota-detail`),
    /** 设置/清除成员按用户配额（quota 为 ≥0 整数或 null=不限） */
    updateMemberQuota: (id, userId, resource, quota) =>
      request(`/tenants/${id}/members/${userId}/quota`, { method: 'PUT', body: { resource, quota } }),
    /** 硬删除已移除成员在本空间的内容；resources 可选，默认全部 */
    purgeMember: (id, userId, resources) =>
      request(`/tenants/${id}/members/${userId}/purge`, { method: 'POST', body: resources ? { resources } : {} }),
    /** 当前成员自己的配额/用量/权限（任何成员可用；permissions 对 owner/admin 恒 true） */
    myQuota: (id) => request(`/tenants/${id}/my-quota`),
    /** 设置成员功能权限（owner/admin；perm ∈ create_classes/create_students/create_exams） */
    updateMemberPermission: (id, userId, perm, allowed) =>
      request(`/tenants/${id}/members/${userId}/permissions`, { method: 'PUT', body: { perm, allowed } }),
  };

  // —— GradeGroups 年级组（年级组长 = 本年级子管理员）——
  const gradeGroups = {
    list: () => request('/grade-groups'),
    create: (body) => request('/grade-groups', { method: 'POST', body }),
    update: (id, body) => request(`/grade-groups/${id}`, { method: 'PUT', body }),
    remove: (id) => request(`/grade-groups/${id}`, { method: 'DELETE' }),
  };

  // —— Classes（§54）——
  const classes = {
    list: (query) => request('/classes', { query }),
    create: (body) => request('/classes', { method: 'POST', body }),
    get: (id) => request(`/classes/${id}`),
    update: (id, body) => request(`/classes/${id}`, { method: 'PUT', body }),
    remove: (id) => request(`/classes/${id}`, { method: 'DELETE' }),
    // 班级任课老师（canAssignTeachers：owner/admin、本班年级组长、本班班主任）
    addTeacher: (id, body) => request(`/classes/${id}/teachers`, { method: 'POST', body }),
    removeTeacher: (id, userId) => request(`/classes/${id}/teachers/${userId}`, { method: 'DELETE' }),
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
    // §30 契约：body 直接透传 { submitted: [studentId...], missing: [studentId...] }
    bulkSubmissions: (id, body) => request(`/assignments/${id}/submissions/bulk`, { method: 'POST', body }),
    submissions: (id) => request(`/assignments/${id}/submissions`),
  };

  // —— Dictations 默写管理（§58）——
  const dictations = {
    list: (query) => request('/dictations', { query }),
    create: (body) => request('/dictations', { method: 'POST', body }),
    get: (id) => request(`/dictations/${id}`),
    update: (id, body) => request(`/dictations/${id}`, { method: 'PUT', body }),
    remove: (id) => request(`/dictations/${id}`, { method: 'DELETE' }),
    // §58 契约：body 直接透传 { passed: [studentId...], failed: [studentId...] }
    bulkResults: (id, body) => request(`/dictations/${id}/results/bulk`, { method: 'POST', body }),
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
    /** 用户 AI 配置（密钥仅返回掩码） */
    getSettings: () => request('/ai/settings'),
    /** 保存/清除 AI 配置；body: { baseUrl?, apiKey?, model?, clear? } */
    updateSettings: (body) => request('/ai/settings', { method: 'PUT', body }),
  };

  // —— Files（§45/§46：二进制上传 → R2，元数据落 D1）——
  const files = {
    /** 上传文件（File/Blob），文件名取 file.name；返回 {id,name,url,size,mimeType} */
    async upload(file) {
      const headers = { 'X-File-Name': encodeURIComponent(file.name || 'file') };
      const tenantId = window.App?.state?.tenant?.id;
      if (tenantId) headers['X-Tenant-Id'] = tenantId;
      let res;
      try {
        res = await fetch(BASE + '/files', {
          method: 'POST',
          credentials: 'include',
          headers,
          body: file,
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
      throw { code: err.code || 'INTERNAL_ERROR', message: err.message || '上传失败' };
    },
    list: () => request('/files'),
    get: (id) => request(`/files/${id}`),
    remove: (id) => request(`/files/${id}`, { method: 'DELETE' }),
  };

  // —— 数据导入（§47/§48/§49）——
  const imp = {
    students: (body) => request('/import/students', { method: 'POST', body }),
    schedules: (body) => request('/import/schedules', { method: 'POST', body }),
    // 恢复备份（§51）：body 为 GET /export/backup 的 JSON 结构
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
    // 后端为 POST /admin/tenants/:id/status（body: { status: 'active'|'disabled' }）
    setStatus: (id, status) => request(`/admin/tenants/${id}/status`, { method: 'POST', body: { status } }),
    setQuota: (id, quotas) => request(`/admin/tenants/${id}/quota`, { method: 'PUT', body: quotas }),
    /** 设置/取消用户平台管理员（PATCH /admin/users/:userId，body {platformRole}） */
    updateUserPlatformRole: (userId, platformRole) => request(`/admin/users/${userId}`, { method: 'PATCH', body: { platformRole } }),
    /** 平台设置（如新建账户是否自动创建个人空间） */
    getSettings: () => request('/admin/settings'),
    updateSettings: (body) => request('/admin/settings', { method: 'PUT', body }),
  };

  window.api = { auth, tenants, gradeGroups, classes, students, lessons, schedules, assignments, dictations, exams, dashboard, ai, files, import: imp, export: exp, admin };
})();
