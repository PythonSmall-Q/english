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
  const BOOKMARK_KEYS = {
    'x-d1-bookmark': 'd1-bookmark',
    'x-trial-d1-bookmark': 'trial-d1-bookmark',
    'x-grad-d1-bookmark': 'grad-d1-bookmark',
  };

  function addD1Bookmarks(headers) {
    for (const [header, storageKey] of Object.entries(BOOKMARK_KEYS)) {
      const bookmark = sessionStorage.getItem(storageKey);
      if (bookmark) headers[header] = bookmark;
    }
  }

  function saveD1Bookmarks(response) {
    for (const [header, storageKey] of Object.entries(BOOKMARK_KEYS)) {
      const bookmark = response.headers.get(header);
      if (bookmark) sessionStorage.setItem(storageKey, bookmark);
    }
  }

  /**
   * 统一请求。query 为对象时拼到 URL 上。
   * 学年归档（§63）：GET 6 个列表端点未显式传 academic_year 时自动带当前选中学年；
   * 历史学年模式下拦截这些命名空间的写请求（前端先行拒绝，后端 403 兜底）。
   * 教案（/lessons）已解除学年绑定：全学年可见可写，不带学年参数、不拦截写请求。
   * @throws {{code:string,message:string}} 业务错误或网络错误
   */
  // 纳入学年归档过滤/写保护的命名空间（列表 GET 自动带参；非 GET 历史模式拦截）
  const ACADEMIC_LIST_PREFIXES = ['/classes', '/students', '/schedules', '/assignments', '/dictations', '/exams'];
  const ACADEMIC_WRITE_PREFIXES = ['/classes', '/students', '/schedules', '/assignments', '/dictations', '/exams', '/import'];

  async function request(path, { method = 'GET', body, query } = {}) {
    const isAcademicListGet =
      method === 'GET' && ACADEMIC_LIST_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
    // 历史学年只读：拦截教学数据的写请求（settings/quota/admin/ai/files 不受影响）
    if (
      method !== 'GET' &&
      window.App?.state?.academicYear &&
      window.App.state.academicYear !== window.App.state.currentAcademicYear &&
      ACADEMIC_WRITE_PREFIXES.some((p) => path === p || path.startsWith(p + '/'))
    ) {
      window.App?.toast?.('历史学年数据仅可查看');
      return Promise.reject({ code: 'FORBIDDEN', message: '历史学年数据仅可查看' });
    }
    let url = BASE + path;
    const q = { ...(query || {}) };
    // 列表 GET 未显式指定学年时，自动带当前选中学年
    if (isAcademicListGet && (q.academic_year === undefined || q.academic_year === null || q.academic_year === '')) {
      const y = window.App?.state?.academicYear;
      if (y) q.academic_year = y;
    }
    if (Object.keys(q).length) {
      const qs = new URLSearchParams(
        Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== '')
      ).toString();
      if (qs) url += '?' + qs;
    }
    const headers = { 'Content-Type': 'application/json' };
    // 平台管理员「以成员身份查看」：透传 X-View-As（后端校验权限）
    const viewAs = window.App?.state?.viewAs;
    if (viewAs && viewAs.userId) headers['X-View-As'] = viewAs.userId;
    const tenantId = window.App?.state?.tenant?.id;
    if (tenantId) headers['X-Tenant-Id'] = tenantId;
    addD1Bookmarks(headers);

    let res;
    try {
      res = await fetch(url, {
        method,
        credentials: 'include',
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      saveD1Bookmarks(res);
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

  async function requestStream(path, body, onDelta, onStatus) {
    const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
    const tenantId = window.App?.state?.tenant?.id;
    if (tenantId) headers['X-Tenant-Id'] = tenantId;
    addD1Bookmarks(headers);
    const res = await fetch(BASE + path, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) });
    saveD1Bookmarks(res);
    if (!res.ok || !res.body) {
      let payload = null;
      try { payload = await res.json(); } catch { /* non-json error */ }
      throw { code: payload?.error?.code || 'INTERNAL_ERROR', message: payload?.error?.message || `流式请求失败（HTTP ${res.status}）` };
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    let doneData = null;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      buffer += part.value;
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const event of events) {
        const line = event.split('\n').find((item) => item.startsWith('data:'));
        if (!line) continue;
        const data = JSON.parse(line.slice(5).trim());
        if (data.error) throw { code: data.code || 'INTERNAL_ERROR', message: data.error };
        if (data.status && onStatus) onStatus(data.message || data.status);
        if (data.delta) onDelta(data.delta);
        if (data.done) doneData = data;
      }
    }
    return doneData || {};
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
    /** 学年归档：当前学年 + 本空间出现过的学年列表（降序） */
    academicYears: (id) => request(`/tenants/${id}/academic-years`),
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
    /** 空间品牌定制（本空间 owner）：body 同 admin 端点 */
    setBranding: (id, body) => request(`/tenants/${id}/branding`, { method: 'PUT', body }),
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
    /** 设置备课组长（owner/admin 或本组组长；重复设置幂等返回现有） */
    addPrepLeader: (id, userId) => request(`/grade-groups/${id}/prep-leaders`, { method: 'POST', body: { userId } }),
    /** 移除备课组长（owner/admin 或本组组长） */
    removePrepLeader: (id, userId) => request(`/grade-groups/${id}/prep-leaders/${userId}`, { method: 'DELETE' }),
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
    /** 该生当前学年全部考试成绩（viewer 起）：总分 + 班内名次 + 各题型小分 */
    examScores: (studentId) => request(`/students/${studentId}/exam-scores`),
    /** 个性化汇总分析（任何成员）：考试成绩(班均/名次) + 作业提交 + 默写重默 */
    overview: (studentId) => request(`/students/${studentId}/overview`),
  };

  // —— Lessons 备课中心（§56）——
  const lessons = {
    list: (query) => request('/lessons', { query }),
    /** 单份教案完整字段（含 content 正文与 class_name） */
    get: (id) => request(`/lessons/${id}`),
    create: (body) => request('/lessons', { method: 'POST', body }),
    update: (id, body) => request(`/lessons/${id}`, { method: 'PUT', body }),
    remove: (id) => request(`/lessons/${id}`, { method: 'DELETE' }),
    /** 复制教案到当前用户名下（新 id、标题加「（副本）」、status=pending、当前学年），复制附件关联 */
    duplicate: (id) => request(`/lessons/${id}/duplicate`, { method: 'POST', body: {} }),
    /** 关联附件：file_id 须为本租户 files 表已有文件；重复关联返回 400 */
    addFile: (id, fileId) => request(`/lessons/${id}/files`, { method: 'POST', body: { file_id: fileId } }),
    /** 移除附件关联（不删文件本体） */
    removeFile: (id, fileId) => request(`/lessons/${id}/files/${fileId}`, { method: 'DELETE' }),
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
    /** 填写/清除年级均分（可管理该考试者）；avgs: {班级名: number|null}，null/空串=清空该项 */
    setGradeAvgs: (id, avgs) => request(`/exams/${id}/grade-avgs`, { method: 'PUT', body: { avgs } }),
    /** 成绩分析；传 classId 时 overview/分数段/题型/班内排名仅统计该班（各班均分对比始终为全校） */
    analysis: (id, classId) => request(`/exams/${id}/analysis`, { query: classId ? { class_id: classId } : {} }),
    /** 单独登记/修改某生总分（班主任/任课老师可登记本班，年段考可登记本班学生） */
    setScore: (examId, studentId, score) =>
      request(`/exams/${examId}/students/${studentId}`, { method: 'PUT', body: { score } }),
    studentReport: (id, studentId) => request(`/exams/${id}/students/${studentId}`),
    /** 「📥 导出成绩」：该学年学生 × 历次考试总分矩阵（任何成员可读） */
    exportTotals: (query) => request('/exams/export-totals', { query }),
  };

  // —— 回收站：删除的教案/学生/作业/默写/考试保留 30 天，可恢复 ——
  const recycle = {
    /** 回收站列表（任何成员可读）：{ list: [{id,item_type,item_id,title,deleted_by_name,deleted_at}] } */
    list: () => request('/recycle'),
    /** 恢复某条回收条目：成功 {restored:true,tables:{表名:行数}}；409=原条目已存在 */
    restore: (id) => request(`/recycle/${id}/restore`, { method: 'POST', body: {} }),
  };

  // —— 待办中心（个人 / 年级组 / 学科组；scope=grade|subject 仅组长可发布，403 由后端文案拦截）——
  const todos = {
    /** 列表：{ list: [{id,scope,groupId,groupName,title,dueDate,status,creatorName,createdAt}] } */
    list: () => request('/todos'),
    create: (body) => request('/todos', { method: 'POST', body }),
    update: (id, body) => request(`/todos/${id}`, { method: 'PUT', body }),
    remove: (id) => request(`/todos/${id}`, { method: 'DELETE' }),
  };

  // —— Dashboard（§40）——
  const dashboard = {
    get: () => request('/dashboard'),
  };

  // —— AI 教学助手（§42）——
  const ai = {
    generate: (body) => request('/ai/generate', { method: 'POST', body }),
    generateStream: (body, onDelta, onStatus) => requestStream('/ai/generate-stream', body, onDelta, onStatus),
    context: (body) => request('/ai/context', { method: 'POST', body }),
    history: (query) => request('/ai/history', { query }),
    /** 用户 AI 配置（密钥仅返回掩码） */
    getSettings: () => request('/ai/settings'),
    /** 保存/清除 AI 配置；body: { mode?, baseUrl?, apiKey?, model?, cfModel?, clear? }（mode ∈ own|platform|cloudflare） */
    updateSettings: (body) => request('/ai/settings', { method: 'PUT', body }),
  };

  // —— Files（§45/§46：二进制上传 → R2，元数据落 D1）——
  const files = {
    /** 上传文件（File/Blob），文件名取 file.name；返回 {id,name,url,size,mimeType} */
    /**
     * 上传文件到 R2。用 XMLHttpRequest 以获得上传进度。
     * @param {File} file 文件
     * @param {(percent: number) => void} [onProgress] 0-100 进度回调
     */
    upload(file, onProgress) {
      const headers = { 'X-File-Name': encodeURIComponent(file.name || 'file') };
    // 上传同样遵循「以成员身份查看」
    const viewAsUp = window.App?.state?.viewAs;
    if (viewAsUp && viewAsUp.userId) headers['X-View-As'] = viewAsUp.userId;
      const tenantId = window.App?.state?.tenant?.id;
      if (tenantId) headers['X-Tenant-Id'] = tenantId;
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', BASE + '/files');
        xhr.withCredentials = true;
        for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
        if (typeof onProgress === 'function') {
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
          };
        }
        xhr.onload = () => {
          let payload = null;
          try {
            payload = JSON.parse(xhr.responseText);
          } catch (e) {
            reject({ code: 'INTERNAL_ERROR', message: `服务响应异常（HTTP ${xhr.status}）` });
            return;
          }
          if (payload && payload.success) resolve(payload.data);
          else reject({ code: payload?.error?.code || 'INTERNAL_ERROR', message: payload?.error?.message || '上传失败' });
        };
        xhr.onerror = () => reject({ code: 'NETWORK_ERROR', message: '网络异常，请检查后端服务是否启动' });
        xhr.send(file);
      });
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
    /** 班级统计（viewer 起）：作业上交 / 默写（含全年段）/ 考试成绩平铺数据，供生成 .xlsx */
    classStats: (classId, academicYear) =>
      request('/export/class-stats', { query: { class_id: classId, academic_year: academicYear } }),
  };

  // —— 学年归档（§63：上一学年 默写/作业/考试 压缩归档；9/15 起提醒导出备份）——
  const archive = {
    /** 归档状态：{ previousYear, compressAt, hasArchivable, remindWindow } */
    status: () => request('/archive/status'),
    /** 下载压缩归档容器（owner/admin）；module ∈ dictations|assignments|exams，academic_year 为目标学年 */
    download: (module, academicYear) =>
      request('/archive/download', { query: { module, academic_year: academicYear } }),
  };

  // —— 毕业归档（毕业班级整体打包入 GRAD_DB；owner/admin 仅可查看元数据列表与下载）——
  const graduated = {
    /** 元数据列表：{ list: [{id, class_name, graduation_year, academic_year, student_count, archived_at}] } */
    list: () => request('/graduated'),
    /** 下载某条毕业归档 envelope（gzip+base64 容器，与学年归档同格式） */
    download: (id) => request(`/graduated/${id}/download`),
  };

  // —— 3 天试用（plan='trial'，一生一次，到期物理删除）——
  const trials = {
    /** 创建试用空间；成功返回 { tenant }；已试用过返回 409 */
    start: () => request('/trials/start', { method: 'POST', body: {} }),
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
    /** 跨租户数据迁入（§迁移指南）：body { target_tenant_id? | new_tenant_name?, backup } */
    migrate: (body) => request('/admin/migrate', { method: 'POST', body }),
    /** 平台 AI 接口配置（GET 密钥仅掩码；PUT body {baseUrl?, apiKey?, model?}，apiKey 空=清除） */
    getAiSettings: () => request('/admin/ai-settings'),
    updateAiSettings: (body) => request('/admin/ai-settings', { method: 'PUT', body }),
    /** Cloudflare AI：GET {available, enabled, models}；PUT {enabled} 切换启用，返回同 GET 形状 */
    getCfAi: () => request('/admin/cf-ai'),
    updateCfAi: (body) => request('/admin/cf-ai', { method: 'PUT', body }),
    /** 设置空间 AI 额度（credits ≥ 0）→ {id, ai_credits} */
    /** 手动增加 AI 额度（加赠池，累计）：body { credits > 0 } */
    setAiCredits: (id, credits) => request(`/admin/tenants/${id}/ai-credits`, { method: 'PUT', body: { credits } }),
    /** 设置 AI 月度限额（每月补足到 限额+加赠；null 关闭）：body { monthly } */
    setAiMonthly: (id, monthly) => request(`/admin/tenants/${id}/ai-monthly`, { method: 'PUT', body: { monthly } }),
    /** 品牌：平台管理员读（非成员空间也可读）/写 */
    getBranding: (id) => request(`/admin/tenants/${id}/branding`),
    /** 调整空间套餐：body { plan: 'free'|'pro'|'school'|'custom' }（预设档同时覆盖配额） */
    setPlan: (id, plan) => request(`/admin/tenants/${id}/plan`, { method: 'PUT', body: { plan } }),
    /** 商议版品牌定制：body {logoUrl?, motto?, faviconUrl?, loaderUrl?, loaderAnim?}；空对象=清除 */
    setBranding: (id, body) => request(`/admin/tenants/${id}/branding`, { method: 'PUT', body }),
    /** 平台管理员物理删除任意空间（不可恢复，含全部数据与文件） */
    deleteTenant: (id) => request(`/admin/tenants/${id}`, { method: 'DELETE' }),
  };

  /** 品牌图床：上传自动推送到私有 GitHub 仓库，经 Worker 代理下发 */
  const brandImg = {
    getConfig: () => request('/brand-images/config'),
    updateConfig: (body) => request('/brand-images/config', { method: 'PUT', body }),
    /** 上传图片：{filename, contentBase64} → {path, url} */
    upload: (body) => request('/brand-images', { method: 'POST', body }),
  };

  window.api = { auth, tenants, gradeGroups, classes, students, lessons, schedules, assignments, dictations, exams, recycle, todos, dashboard, ai, files, import: imp, export: exp, archive, graduated, trials, admin, brandImg };
})();
