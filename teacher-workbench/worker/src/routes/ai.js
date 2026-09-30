/**
 * routes/ai.js — AI 教学助手（§41/§42/§43）
 *
 * 约定：
 * - 快捷指令 type：practice 生成练习题 / lesson_plan 写教案 / essay_feedback 批改作文
 *   / analysis 学情解读 / translate 中英互译
 * - 流程（§42）：身份/租户/角色校验 → 构造 system prompt
 *   → 按用户服务方式 mode 路由：own=自配 Provider（不计配额）/ platform=平台接口或
 *     环境变量 AI_API_KEY（计配额）/ cloudflare=Workers AI（按 credit 扣租户额度）→ 写 ai_generations
 * - cloudflare 模式：前置校验平台开关与 [ai] binding → env.AI.run(cfModel, {messages})
 *   → usage 估算 credits → 原子扣减 tenants.ai_credits → 返回 credits/creditsLeft
 * - 浏览器不直连 AI Provider，全部经 Worker 代理
 * - 用户配置端点：GET/PUT /ai/settings（仅本人；密钥只写不读全量，GET 返回掩码）
 */

import { Hono } from 'hono';
import { ApiError, newId, now } from '../db.js';
import { requireAuth, requireTenant, requireRole } from '../middleware.js';
import { CF_MODELS, getCfModel, parseCfAiSetting, estimateCredits, ensureMonthlyReplenish } from '../cfai.js';

const app = new Hono();

// AI 功能暂时下线：保留实现与数据结构，统一拒绝调用，避免隐藏入口仍消耗配额或访问 Provider。
app.use('*', async (c) => c.json({ success: false, error: { code: 'AI_DISABLED', message: 'AI 功能暂时不可用' } }, 503));

const AI_TYPES = ['practice', 'lesson_plan', 'essay_feedback', 'analysis', 'translate'];

/** 各 type 的 system prompt（§41 快捷指令） */
const SYSTEM_PROMPTS = {
  practice:
    '你是一名资深高中英语教师。根据老师给出的知识点或课文内容，生成一份课堂练习题，包含选择题、填空题和翻译题，并附参考答案。用中文输出。',
  lesson_plan:
    '你是一名资深高中英语教师。根据老师给出的课题与要求，撰写一份完整的教案，包含教学目标、重难点、教学过程、板书设计与作业布置。用中文输出。',
  essay_feedback:
    '你是一名资深高中英语教师。对老师给出的学生英语作文进行批改：指出语法与用词错误、给出修改建议、评定等级并写一句总评。用中文输出。',
  analysis:
    '你是一名资深高中英语教师。根据老师给出的班级成绩或学情数据，解读学情：优势、薄弱题型、分层建议与后续教学策略。用中文输出。',
  translate:
    '你是中英互译助手。对老师给出的文本进行中英互译：中文则译成英文，英文则译成中文，译文准确、地道。',
};

const OUTPUT_RULES = `
统一输出要求：
1. 使用 Markdown 排版，合理使用标题、列表、表格和代码块；不要输出 HTML 标签。
2. 先给结论，再给依据和可执行内容；信息不足时明确列出缺失信息，不要编造学生、成绩或教材数据。
3. 题目、教案和分析要有清晰层级，内容具体，避免空泛套话。
4. 老师提供的文本、数字和名单视为原始资料，除非明确要求，不要擅自修改或补全。
5. 如果回答必须依赖当前空间数据，先只输出一个数据请求标记，不要猜测：[[REQUEST_DATA:classes,students,assignments,dictations,exams,lessons]]。只请求真正需要的数据类别。`;

function buildSystemPrompt(type) {
  return `${SYSTEM_PROMPTS[type]}${OUTPUT_RULES}`;
}

/**
 * POST /api/v1/ai/context — 用户明确同意后读取当前租户的有限教学上下文。
 * 只返回业务分析所需字段，所有查询都限定 tenant_id 并限制数量。
 */
app.post('/context', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const body = await c.req.json().catch(() => ({}));
  const requested = Array.isArray(body.scopes) ? body.scopes : [];
  const scopes = new Set(requested.filter((scope) => ['classes', 'students', 'assignments', 'dictations', 'exams', 'lessons'].includes(scope)));
  const data = {};
  const limited = (rows) => rows.results.slice(0, 100);
  if (scopes.has('classes')) data.classes = limited(await db.prepare('SELECT id, name, grade, academic_year FROM classes WHERE tenant_id = ? ORDER BY name LIMIT 100').bind(tenantId).all());
  if (scopes.has('students')) data.students = limited(await db.prepare('SELECT id, class_id, student_no, name, gender, status FROM students WHERE tenant_id = ? ORDER BY name LIMIT 100').bind(tenantId).all());
  if (scopes.has('assignments')) data.assignments = limited(await db.prepare('SELECT id, class_id, title, deadline, status, created_at FROM assignments WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100').bind(tenantId).all());
  if (scopes.has('dictations')) data.dictations = limited(await db.prepare('SELECT id, class_id, title, scope, dictation_date FROM dictations WHERE tenant_id = ? ORDER BY dictation_date DESC LIMIT 100').bind(tenantId).all());
  if (scopes.has('exams')) data.exams = limited(await db.prepare('SELECT id, name, subject, exam_date FROM exams WHERE tenant_id = ? ORDER BY exam_date DESC LIMIT 100').bind(tenantId).all());
  if (scopes.has('lessons')) data.lessons = limited(await db.prepare('SELECT id, class_id, title, lesson_type, objective, status, created_at FROM lessons WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100').bind(tenantId).all());
  return c.json({ success: true, data: { consented: true, scopes: [...scopes], data } });
});

const AI_TIMEOUT_MS = 30000;

function streamDelta(payload) {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return '';
  const value = payload.response ?? payload.output_text ?? payload.text ?? payload.choices?.[0]?.delta?.content;
  return typeof value === 'string' ? value : '';
}

/** 将基础端点或完整聊天端点统一为 OpenAI 兼容的基础端点。 */
function normalizeAiBaseUrl(value) {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/, '');
}

/** 兼容 Workers AI 与 OpenAI 兼容模型的文本响应结构。 */
function extractAiText(payload) {
  if (typeof payload === 'string') return payload.trim();
  if (!payload || typeof payload !== 'object') return '';
  const content = payload.response ?? payload.output_text ?? payload.text;
  if (typeof content === 'string' && content.trim()) return content.trim();
  const choice = payload.choices?.[0];
  const choiceContent = choice?.message?.content ?? choice?.text;
  if (typeof choiceContent === 'string') return choiceContent.trim();
  if (Array.isArray(choiceContent)) {
    return choiceContent
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .join('')
      .trim();
  }
  return '';
}

/** 读取用户自配 AI Provider（无则返回 null；含 mode/cf_model） */
async function getUserAiSettings(db, userId) {
  return db
    .prepare('SELECT user_id, base_url, api_key, model, mode, cf_model FROM user_ai_settings WHERE user_id = ?')
    .bind(userId)
    .first();
}

/**
 * POST /api/v1/ai/generate-stream — Cloudflare AI token 流。
 * 只负责 cloudflare 模式；其它模式由 /generate 回退，流结束后统一落库与扣费。
 */
app.post('/generate-stream', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const mainDb = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const body = await c.req.json().catch(() => ({}));
  const type = String(body.type || '');
  const prompt = String(body.prompt || '').trim();
  const sendError = (message, code = 'INTERNAL_ERROR') =>
    c.json({ success: false, error: { code, message } }, 400);
  if (!AI_TYPES.includes(type)) return sendError(`type 必须是 ${AI_TYPES.join('|')}`, 'VALIDATION_ERROR');
  if (!prompt) return sendError('prompt 不能为空', 'VALIDATION_ERROR');
  if (c.get('tenant').plan === 'trial' || db === c.env.TRIAL_DB) return sendError('试用空间不支持 AI 助手', 'FORBIDDEN');

  const settings = await getUserAiSettings(mainDb, user.id);
  if ((settings?.mode || 'own') !== 'cloudflare') return sendError('当前服务方式不支持流式输出', 'STREAM_UNSUPPORTED');
  const cfSetting = await getCfAiSetting(mainDb);
  const model = settings?.cf_model;
  if (!cfSetting.enabled || !c.env.AI) return sendError('Cloudflare AI 未启用或未绑定', 'PRECONDITION_FAILED');
  if (!getCfModel(model)) return sendError('请先选择 Cloudflare AI 模型', 'VALIDATION_ERROR');
  await ensureMonthlyReplenish(db, tenantId);
  const balanceRow = await db.prepare('SELECT ai_credits, ai_credits_bonus FROM tenants WHERE id = ?').bind(tenantId).first();
  if (!balanceRow || !(balanceRow.ai_credits > 0)) return sendError('AI 额度不足，请联系平台管理员', 'QUOTA_EXCEEDED');
  const userCreditQuota = await resolveUserCreditQuota(c, user.id);
  if (userCreditQuota.remaining !== null && userCreditQuota.remaining <= 0) {
    return sendError('已达到你的 AI credit 配额', 'QUOTA_EXCEEDED');
  }

  let upstream;
  try {
    upstream = await c.env.AI.run(model, {
      messages: [{ role: 'system', content: buildSystemPrompt(type) }, { role: 'user', content: prompt }],
      stream: true,
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
  } catch (err) {
    return sendError(`Cloudflare AI 调用失败：${String(err?.message || err)}`);
  }
  const source = upstream instanceof ReadableStream ? upstream : upstream?.body;
  if (!source) return sendError('Cloudflare AI 未返回流', 'INTERNAL_ERROR');

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const stream = new ReadableStream({
    async start(controller) {
      const reader = source.getReader();
      let buffer = '';
      let result = '';
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: 'connected', message: '模型已连接，正在生成内容' })}\n\n`));
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          buffer += decoder.decode(part.value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const raw = line.trim().replace(/^data:\s*/, '');
            if (!raw || raw === '[DONE]') continue;
            let parsed = raw;
            try { parsed = JSON.parse(raw); } catch { /* plain text chunk */ }
            const delta = streamDelta(parsed);
            if (!delta) continue;
            result += delta;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
          }
        }
        if (buffer.trim()) {
          let parsed = buffer.trim();
          try { parsed = JSON.parse(parsed); } catch { /* plain text chunk */ }
          const delta = streamDelta(parsed);
          if (delta) { result += delta; controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`)); }
        }
        if (!result.trim()) throw new Error('AI 服务未返回有效内容');
        const credits = estimateCredits(model, null);
        if (userCreditQuota.remaining !== null && userCreditQuota.remaining < credits) {
          throw new Error('已达到你的 AI credit 配额');
        }
        const basePart = Math.max(0, balanceRow.ai_credits - (balanceRow.ai_credits_bonus || 0));
        const bonusTake = Math.min(balanceRow.ai_credits_bonus || 0, Math.max(0, credits - basePart));
        const upd = await db.prepare(`UPDATE tenants SET ai_credits = ai_credits - ?, ai_credits_bonus = ai_credits_bonus - ? WHERE id = ? AND ai_credits >= ? AND ai_credits_bonus >= ?`)
          .bind(credits, bonusTake, tenantId, 0.001, bonusTake).run();
        if (upd.meta?.changes !== 1) throw new Error('AI 额度不足，请联系平台管理员');
        const row = await db.prepare('SELECT ai_credits FROM tenants WHERE id = ?').bind(tenantId).first();
        const id = newId();
        await db.prepare(`INSERT INTO ai_generations (id, tenant_id, user_id, type, prompt, result, billed, credits, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`).bind(id, tenantId, user.id, type, prompt, result, credits, now()).run();
        const userCreditsLeft = (await resolveUserCreditQuota(c, user.id)).remaining;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, result, id, credits, creditsLeft: row?.ai_credits ?? null, userCreditsLeft })}\n\n`));
        controller.close();
      } catch (err) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: String(err?.message || err) })}\n\n`));
        controller.close();
      } finally { reader.releaseLock(); }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } });
});

/**
 * 读取平台级 AI 接口配置（platform_settings.ai_provider，JSON {baseUrl, apiKey, model}）
 * 未配置返回 null
 */
async function getPlatformAiConfig(mainDb) {
  const row = await mainDb.prepare("SELECT value FROM platform_settings WHERE key = 'ai_provider'").first();
  if (!row || !row.value) return null;
  try {
    const cfg = JSON.parse(row.value);
    return cfg && (cfg.apiKey || cfg.enabled === false) ? cfg : null;
  } catch {
    return null;
  }
}

/** 读取平台级 Cloudflare AI 开关（platform_settings.cf_ai，JSON {enabled}） */
async function getCfAiSetting(mainDb) {
  const row = await mainDb.prepare("SELECT value FROM platform_settings WHERE key = 'cf_ai'").first();
  return parseCfAiSetting(row?.value);
}

/** 密钥掩码：只暴露末 4 位 */
function maskKey(key) {
  const k = String(key || '');
  return k ? `****${k.slice(-4)}` : '';
}

/**
 * GET /ai/settings 的 tenantCredits 用：按 X-Tenant-Id 头在 主库→试用库 定位租户
 * 惰性触发月度补足后返回 { credits, monthly, bonus }（无头/未命中返回 null）。
 */
async function resolveTenantCredits(c) {
  const tenantId = c.req.header('X-Tenant-Id');
  if (!tenantId) return null;
  let row = await c.env.DB.prepare('SELECT ai_credits FROM tenants WHERE id = ?').bind(tenantId).first();
  let db = c.env.DB;
  if (!row && c.env.TRIAL_DB) {
    db = c.env.TRIAL_DB;
    row = await db.prepare('SELECT ai_credits FROM tenants WHERE id = ?').bind(tenantId).first();
  }
  if (!row) return null;
  // 展示前惰性触发月度补足（与生成路径同口径，用户月初打开设置即看到补后额度）
  await ensureMonthlyReplenish(db, tenantId);
  const fresh = await db
    .prepare('SELECT ai_credits, ai_credits_monthly, ai_credits_bonus FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!fresh) return null;
  return { credits: fresh.ai_credits, monthly: fresh.ai_credits_monthly, bonus: fresh.ai_credits_bonus };
}

/** 当前用户的 Cloudflare AI 月度 credit 配额与已用额度。 */
async function resolveUserCreditQuota(c, userId) {
  let db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId') || c.req.header('X-Tenant-Id');
  if (!tenantId || !userId) return { quota: null, used: 0, remaining: null };
  if (!c.get('tenantDb')) {
    const mainTenant = await c.env.DB.prepare('SELECT id FROM tenants WHERE id = ?').bind(tenantId).first();
    if (!mainTenant && c.env.TRIAL_DB) db = c.env.TRIAL_DB;
  }
  const monthPrefix = new Date().toISOString().slice(0, 7);
  const [quotaRow, usageRow, tenantBalanceRow] = await db.batch([
    db.prepare("SELECT quota FROM user_quotas WHERE tenant_id = ? AND user_id = ? AND resource = 'ai_credits'").bind(tenantId, userId),
    db.prepare('SELECT COALESCE(SUM(credits), 0) AS used FROM ai_generations WHERE tenant_id = ? AND user_id = ? AND substr(created_at, 1, 7) = ? AND credits IS NOT NULL').bind(tenantId, userId, monthPrefix),
    db.prepare('SELECT ai_credits, ai_credits_monthly, ai_credits_bonus FROM tenants WHERE id = ?').bind(tenantId),
  ]);
  const quota = quotaRow.results?.[0]?.quota ?? null;
  const used = Number(usageRow.results?.[0]?.used || 0);
  const tenantBalance = tenantBalanceRow.results?.[0] || {};
  // ai_credits 是实际可用余额，包含跨周期结转的负债；不能用当月 usage 重新推算覆盖它。
  const tenantRemaining = Number(tenantBalance.ai_credits ?? 0);
  const quotaRemaining = quota === null ? null : Math.max(0, quota - used);
  return {
    quota,
    used,
    tenantRemaining,
    remaining: quotaRemaining === null ? tenantRemaining : Math.min(quotaRemaining, tenantRemaining),
  };
}

/** 无 AI_API_KEY 时的内置 mock 回复（按 type 模板，含 prompt 关键词，保证可演示） */
function mockGenerate(type, prompt) {
  const key = String(prompt || '').trim();
  switch (type) {
    case 'practice':
      return (
        `【练习题 · Mock】已根据「${key}」生成练习：\n\n` +
        `一、选择题\n1. He suggested that we ___ the meeting to Friday. (A. put off  B. put on  C. put up)\n` +
        `二、填空题\n1. She is looking forward to ___ (hear) from her pen pal.\n` +
        `三、翻译题\n1. 只有通过不断练习，我们才能提高英语口语。\n\n参考答案：一、1.A  二、1.hearing  三、1. Only by practicing constantly can we improve our spoken English.\n` +
        `（当前为本地模拟生成，配置平台或个人的 AI 接口后将调用真实模型）`
      );
    case 'lesson_plan':
      return (
        `【教案 · Mock】课题：${key}\n\n一、教学目标\n1. 知识目标：掌握本课核心词汇与句型。\n2. 能力目标：提升阅读理解与口头表达能力。\n` +
        `二、教学重难点\n重点：核心词汇运用；难点：长难句理解。\n三、教学过程\n1. 导入（5 分钟）2. 新授（20 分钟）3. 操练（15 分钟）4. 总结与作业（5 分钟）\n` +
        `四、作业布置\n完成课后练习并背诵重点段落。\n（当前为本地模拟生成，配置平台或个人的 AI 接口后将调用真实模型）`
      );
    case 'essay_feedback':
      return (
        `【作文批改 · Mock】\n\n原文要点：${key}\n\n一、主要问题\n1. 时态不一致：叙事部分应统一使用过去时。\n2. 中式表达：注意主谓一致与冠词使用。\n` +
        `二、修改建议\n建议多用连接词（however / therefore / in addition）增强连贯性。\n三、评定等级：B（良好）\n总评：结构完整、内容充实，注意语法细节即可更上一层楼。\n` +
        `（当前为本地模拟生成，配置平台或个人的 AI 接口后将调用真实模型）`
      );
    case 'analysis':
      return (
        `【学情解读 · Mock】\n\n数据：${key}\n\n一、整体情况\n班级均分稳定，及格率良好。\n二、优势题型\n阅读与听力整体表现较好。\n` +
        `三、薄弱题型\n完形填空与书面表达失分集中，需专项训练。\n四、教学建议\n1. 对薄弱学生分层布置基础巩固任务；2. 每周安排一次限时完形训练。\n` +
        `（当前为本地模拟生成，配置平台或个人的 AI 接口后将调用真实模型）`
      );
    case 'translate':
      return (
        `【中英互译 · Mock】\n\n原文：${key}\n\n译文：这是一条本地模拟的翻译结果。配置平台或个人的 AI 接口后将调用真实模型提供准确译文。\n` +
        `参考：Knowledge is power. 知识就是力量。`
      );
    default:
      return `【Mock】已收到请求：${key}`;
  }
}

/**
 * POST /api/v1/ai/generate — 快捷指令生成（§41/§42/§43）
 * body: { type, prompt }
 * 成功：{ id, type, result, mock, cf, credits, creditsLeft }
 *   （cf=true 为 Cloudflare AI 生成；并写入 ai_generations 供历史与配额统计）
 */
app.post('/generate', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  // 租户级（配额、生成记录）走试用库/主库 tenantDb；用户级 AI Provider 配置 user_ai_settings 只在主库
  const db = c.get('tenantDb') || c.env.DB;
  const mainDb = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');

  // 试用空间（TRIAL_DB）一律不支持 AI 助手：写死拒绝，不走到任何 Provider / 扣费逻辑
  if (c.get('tenant').plan === 'trial' || db === c.env.TRIAL_DB) {
    throw new ApiError('FORBIDDEN', '试用空间不支持 AI 助手，开通正式版本后可使用', 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const type = String(body.type || '');
  const prompt = String(body.prompt || '').trim();
  if (!AI_TYPES.includes(type)) {
    throw new ApiError('VALIDATION_ERROR', `type 必须是 ${AI_TYPES.join('|')}`);
  }
  if (!prompt) throw new ApiError('VALIDATION_ERROR', 'prompt 不能为空');

  // 服务方式（§42 扩展）：own=自配接口（不计配额）/ cloudflare=Workers AI（按 credit 扣租户额度）/
  //   platform=平台接口或环境变量或 mock（计配额）；旧数据无 mode 列 → 默认 'own'，按 api_key 有无兼容回退原逻辑
  const userSettings = await getUserAiSettings(mainDb, user.id);
  const mode = userSettings?.mode === 'own' && userSettings?.api_key
    ? 'own'
    : userSettings?.mode === 'platform'
      ? 'platform'
      : userSettings?.mode === 'cloudflare' || !userSettings?.api_key
        ? 'cloudflare'
        : 'own';
  let result;
  let mock = false;
  let cf = false;
  let credits = null;
  let creditsLeft = null;

  if (mode === 'cloudflare') {
    // 前置校验：平台开关 → [ai] binding → 模型须在目录内
    const cfSetting = await getCfAiSetting(mainDb);
    if (!cfSetting.enabled) {
      throw new ApiError('PRECONDITION_FAILED', '平台未开启 Cloudflare AI', 403);
    }
    if (!c.env.AI) {
      throw new ApiError('PRECONDITION_FAILED', 'Cloudflare AI 未绑定（wrangler.toml [ai]）', 403);
    }
    const cfModel = userSettings?.cf_model;
    if (!getCfModel(cfModel)) {
      throw new ApiError('VALIDATION_ERROR', '请先在设置页选择 Cloudflare AI 模型');
    }

    // 预检：新月先惰性补足（限额 + 加赠池），额度已耗尽则拒绝，避免白白消耗一次 Cloudflare 调用
    await ensureMonthlyReplenish(db, tenantId);
    const balanceRow = await db
      .prepare('SELECT ai_credits, ai_credits_bonus FROM tenants WHERE id = ?')
      .bind(tenantId)
      .first();
    if (!balanceRow || !(balanceRow.ai_credits > 0)) {
      throw new ApiError('QUOTA_EXCEEDED', 'AI 额度不足，请联系平台管理员充值', 403);
    }
    const userCreditQuota = await resolveUserCreditQuota(c, user.id);
    if (userCreditQuota.remaining !== null && userCreditQuota.remaining <= 0) {
      throw new ApiError('QUOTA_EXCEEDED', '已达到你的 AI credit 配额', 403);
    }

    let usage = null;
    try {
      const resp = await c.env.AI.run(cfModel, {
        messages: [
          { role: 'system', content: buildSystemPrompt(type) },
          { role: 'user', content: prompt },
        ],
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
      result = extractAiText(resp);
      usage = resp && typeof resp === 'object' ? resp.usage || resp.response?.usage : null;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      const timedOut =
        err?.name === 'TimeoutError' || /aborted|timeout/i.test(String(err?.message || ''));
      throw new ApiError(
        'INTERNAL_ERROR',
        timedOut ? 'Cloudflare AI 请求超时，请稍后重试' : `Cloudflare AI 调用失败：${String(err?.message || err)}`
      );
    }
    if (!result) throw new ApiError('INTERNAL_ERROR', 'AI 服务未返回有效内容');

    // 计费：按 usage 估算 credits 并原子扣减租户额度（试用库 tenants 同样有 ai_credits 列）
    // 扣减顺序：基础池先用、加赠池后用——基础池下月补足到限额，加赠池只减不补
    credits = estimateCredits(cfModel, usage);
    if (userCreditQuota.remaining !== null && userCreditQuota.remaining < credits) {
      throw new ApiError('QUOTA_EXCEEDED', '本次 AI 请求所需 credit 超出你的剩余额度', 403);
    }
    const balance = balanceRow.ai_credits;
    const bonus = balanceRow.ai_credits_bonus || 0;
    const basePart = Math.max(0, balance - bonus); // 基础池剩余
    const bonusTake = Math.min(bonus, Math.max(0, credits - basePart)); // 加赠池不足时，差额形成下周期负余额
    const upd = await db
      .prepare(
        `UPDATE tenants
            SET ai_credits = ai_credits - ?,
                ai_credits_bonus = ai_credits_bonus - ?
          WHERE id = ? AND ai_credits >= ? AND ai_credits_bonus >= ?`
      )
        .bind(credits, bonusTake, tenantId, 0.001, bonusTake)
      .run();
    if (upd.meta?.changes !== 1) {
      throw new ApiError('QUOTA_EXCEEDED', 'AI 额度不足，请联系平台管理员充值');
    }
    const tenantRow = await db.prepare('SELECT ai_credits FROM tenants WHERE id = ?').bind(tenantId).first();
    creditsLeft = tenantRow ? tenantRow.ai_credits : null;
    cf = true;
  } else {
    // 仅 own 使用用户自配接口；platform 使用平台配置；默认 Cloudflare 已在上方处理。
    const platformCfg = await getPlatformAiConfig(mainDb);
    if (mode === 'platform' && platformCfg?.enabled === false) {
      throw new ApiError('PRECONDITION_FAILED', '平台 AI 接口已关闭，请选择 Cloudflare AI 或自定义接口', 403);
    }
    const apiKey = mode === 'own' ? userSettings?.api_key || '' : platformCfg?.apiKey || c.env.AI_API_KEY || '';
    // billed=1：走平台侧（平台接口/环境变量/mock）；billed=0：用户自配接口
    const billed = userSettings?.api_key ? 0 : 1;

    if (apiKey) {
      // 真实 Provider：Workers 代理调用（§42），30 秒超时，非 2xx 视为内部错误
      const baseUrl = normalizeAiBaseUrl(
        mode === 'own' ? userSettings?.base_url : platformCfg?.baseUrl ||
        c.env.AI_BASE_URL ||
        'https://api.openai.com/v1'
      );
      const model = mode === 'own' ? userSettings?.model : platformCfg?.model || c.env.AI_MODEL || 'gpt-4o-mini';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
      try {
        const resp = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: buildSystemPrompt(type) },
              { role: 'user', content: prompt },
            ],
          }),
          signal: controller.signal,
        });
        if (!resp.ok) {
          const upstream = await resp.text().catch(() => '');
          let detail = '';
          try {
            const parsed = JSON.parse(upstream);
            detail = parsed?.error?.message || parsed?.message || '';
          } catch {
            detail = upstream.trim().slice(0, 180);
          }
          const hint =
            resp.status === 401
              ? '请检查平台 API 密钥是否有效，以及该端点是否要求 Bearer 鉴权'
              : resp.status === 403
                ? '请检查 API 密钥权限、账户余额或模型访问权限'
                : resp.status === 404
                  ? '请检查 API 端点是否为 OpenAI 兼容接口，以及模型名称是否正确'
                  : '';
          throw new ApiError(
            'INTERNAL_ERROR',
            `AI 服务返回异常状态 ${resp.status}${hint ? `：${hint}` : ''}${detail ? `（${detail}）` : ''}`
          );
        }
        const data = await resp.json();
        result = data?.choices?.[0]?.message?.content ?? '';
        if (!result) throw new ApiError('INTERNAL_ERROR', 'AI 服务未返回有效内容');
      } finally {
        clearTimeout(timer);
      }
    } else {
      // 无 key：内置 mock，保证演示可用
      result = mockGenerate(type, prompt);
      mock = true;
    }
  }

  const id = newId();
  await db
    .prepare(
      `INSERT INTO ai_generations (id, tenant_id, user_id, type, prompt, result, billed, credits, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, tenantId, user.id, type, prompt, result, cf ? 1 : userSettings?.api_key ? 0 : 1, credits, now())
    .run();

  const userCreditsLeft = cf ? (await resolveUserCreditQuota(c, user.id)).remaining : null;
  return c.json({ success: true, data: { id, type, result, mock, cf, credits, creditsLeft, userCreditsLeft } }, 201);
});

/**
 * GET /api/v1/ai/history — 最近 20 条生成记录（当前租户）
 */
app.get('/history', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const user = c.get('user');
  const rows = await db
    .prepare(
      `SELECT id, user_id, type, prompt, result, credits, created_at FROM ai_generations
        WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 20`
    )
    .bind(tenantId)
    .all();
  const balance = await db.prepare('SELECT ai_credits FROM tenants WHERE id = ?').bind(tenantId).first();
  const userCreditQuota = await resolveUserCreditQuota(c, user.id);
  return c.json({
    success: true,
    data: { items: rows.results.map((item) => ({
      ...item,
      creditsLeft: item.credits === null ? null : balance?.ai_credits ?? null,
      userCreditsLeft: item.user_id === user.id ? userCreditQuota.remaining : null,
    })) },
  });
});

/**
 * GET /api/v1/ai/settings — 当前用户的 AI Provider 配置（密钥仅返回掩码）
 * 响应：{ baseUrl, model, hasKey, keyMasked, source: 'user'|'env'|'mock',
 *        mode: 'own'|'platform'|'cloudflare', cfModel,
 *        cf: { available, enabled, models }, tenantCredits }
 */
app.get('/settings', requireAuth, async (c) => {
  // user_ai_settings 是用户级全局表，只在主库（试用租户也不例外）
  const db = c.env.DB;
  const user = c.get('user');
  const row = await getUserAiSettings(db, user.id);
  // 平台接口（platform_settings.ai_provider）也视为平台侧来源
  const platformCfg = await getPlatformAiConfig(db);
  // 平台 Cloudflare AI 开关 + binding 状态（available = 已绑定且平台已启用）
  const cfSetting = await getCfAiSetting(db);
  const cfAvailable = !!c.env.AI && cfSetting.enabled === true;
  const tenantCredits = await resolveTenantCredits(c);
  const userCredits = await resolveUserCreditQuota(c, user.id);
  const defaultMode = row?.api_key ? 'own' : 'cloudflare';
  const platformEnabled = platformCfg?.enabled !== false;
  const mode = row?.mode === 'platform' && !platformEnabled ? 'cloudflare' : row?.mode || defaultMode;
  return c.json({
    success: true,
    data: {
      baseUrl: row?.base_url || '',
      model: row?.model || '',
      hasKey: !!row?.api_key,
      keyMasked: maskKey(row?.api_key),
      source: row?.api_key ? 'user' : platformCfg || c.env.AI_API_KEY ? 'platform' : 'mock',
      mode,
      cfModel: row?.cf_model || '',
      cf: { available: cfAvailable, enabled: cfSetting.enabled, models: CF_MODELS },
      tenantCredits: tenantCredits ? tenantCredits.credits : null,
      tenantCreditsMonthly: tenantCredits ? tenantCredits.monthly : null,
      tenantCreditsBonus: tenantCredits ? tenantCredits.bonus : null,
      userCredits,
      platformEnabled,
    },
  });
});

/**
 * PUT /api/v1/ai/settings — 保存/清除用户 AI 服务方式与 Provider 配置
 * body: { mode?, baseUrl?, apiKey?, model?, cfModel?, clear? }
 * - clear=true：删除配置，回默认平台模式
 * - mode='own' 需 apiKey（或已存），沿用端点/模型校验；'cloudflare' 需 cfModel 在目录内；
 *   'platform' 保留原校验逻辑；未提供的字段保持原值；apiKey 传空串表示保持原密钥
 */
app.put('/settings', requireAuth, async (c) => {
  // user_ai_settings 是用户级全局表，只在主库（试用租户也不例外）
  const db = c.env.DB;
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));

  if (body.clear) {
    await db.prepare('DELETE FROM user_ai_settings WHERE user_id = ?').bind(user.id).run();
    return c.json({ success: true, data: { cleared: true, mode: 'cloudflare', cfModel: '' } });
  }

  const row = await getUserAiSettings(db, user.id);
  const mode = body.mode !== undefined ? String(body.mode).trim() : row?.mode || (row?.api_key ? 'own' : 'cloudflare');
  if (!['own', 'platform', 'cloudflare'].includes(mode)) {
    throw new ApiError('VALIDATION_ERROR', "mode 必须是 'own' | 'platform' | 'cloudflare'");
  }
  const baseUrl = body.baseUrl !== undefined ? String(body.baseUrl).trim() : row?.base_url || '';
  const model = body.model !== undefined ? String(body.model).trim() : row?.model || '';
  const apiKey = body.apiKey !== undefined ? String(body.apiKey).trim() : row?.api_key || '';
  const cfModel = body.cfModel !== undefined ? String(body.cfModel).trim() : row?.cf_model || '';

  if (mode === 'own') {
    if (apiKey && baseUrl && !/^https?:\/\/.+/.test(baseUrl)) {
      throw new ApiError('VALIDATION_ERROR', '端点需以 http:// 或 https:// 开头');
    }
    if (apiKey && !model) {
      throw new ApiError('VALIDATION_ERROR', '请填写模型名称');
    }
    if (!apiKey) {
      throw new ApiError('VALIDATION_ERROR', '请同时填写 API 密钥');
    }
  } else if (mode === 'cloudflare') {
    if (!getCfModel(cfModel)) {
      throw new ApiError('VALIDATION_ERROR', 'cfModel 必须是平台支持的 Cloudflare AI 模型');
    }
  } else {
    // platform：保留原校验逻辑（未提供密钥时仍可保存空配置）
    if (apiKey && baseUrl && !/^https?:\/\/.+/.test(baseUrl)) {
      throw new ApiError('VALIDATION_ERROR', '端点需以 http:// 或 https:// 开头');
    }
    if (apiKey && !model) {
      throw new ApiError('VALIDATION_ERROR', '请填写模型名称');
    }
    if (!apiKey && (baseUrl || model)) {
      throw new ApiError('VALIDATION_ERROR', '请同时填写 API 密钥');
    }
  }

  const ts = now();
  await db
    .prepare(
      `INSERT INTO user_ai_settings (user_id, base_url, api_key, model, mode, cf_model, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET base_url = ?, api_key = ?, model = ?, mode = ?, cf_model = ?, updated_at = ?`
    )
    .bind(user.id, baseUrl, apiKey, model, mode, cfModel, ts, ts, baseUrl, apiKey, model, mode, cfModel, ts)
    .run();

  return c.json({
    success: true,
    data: {
      baseUrl,
      model,
      hasKey: !!apiKey,
      keyMasked: maskKey(apiKey),
      source: apiKey ? 'user' : 'mock',
      mode,
      cfModel,
    },
  });
});

export default app;
