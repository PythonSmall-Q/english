/**
 * routes/ai.js — AI 教学助手（§41/§42/§43）
 *
 * 约定：
 * - 快捷指令 type：practice 生成练习题 / lesson_plan 写教案 / essay_feedback 批改作文
 *   / analysis 学情解读 / translate 中英互译
 * - 流程（§42）：身份/租户/角色校验 → checkQuota('ai') → 构造 system prompt
 *   → 优先用用户自配 Provider（user_ai_settings 表），其次环境变量 AI_API_KEY，
 *     都没有则用内置 mock（保证可演示）→ 写 ai_generations
 * - 浏览器不直连 AI Provider，全部经 Worker 代理
 * - 用户配置端点：GET/PUT /ai/settings（仅本人；密钥只写不读全量，GET 返回掩码）
 */

import { Hono } from 'hono';
import { ApiError, newId, now } from '../db.js';
import { requireAuth, requireTenant, requireRole, audit } from '../middleware.js';
import { checkQuota } from '../quota.js';

const app = new Hono();

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

const AI_TIMEOUT_MS = 30000;

/** 读取用户自配 AI Provider（无则返回 null） */
async function getUserAiSettings(db, userId) {
  return db
    .prepare('SELECT user_id, base_url, api_key, model FROM user_ai_settings WHERE user_id = ?')
    .bind(userId)
    .first();
}

/**
 * 读取平台级 AI 接口配置（platform_settings.ai_provider，JSON {baseUrl, apiKey, model}）
 * 未配置返回 null
 */
async function getPlatformAiConfig(mainDb) {
  const row = await mainDb.prepare("SELECT value FROM platform_settings WHERE key = 'ai_provider'").first();
  if (!row || !row.value) return null;
  try {
    const cfg = JSON.parse(row.value);
    return cfg && cfg.apiKey ? cfg : null;
  } catch {
    return null;
  }
}

/** 密钥掩码：只暴露末 4 位 */
function maskKey(key) {
  const k = String(key || '');
  return k ? `****${k.slice(-4)}` : '';
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
 * 成功：{ result, mock: true|false }（并写入 ai_generations 供历史与配额统计）
 */
app.post('/generate', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  // 租户级（配额、生成记录）走试用库/主库 tenantDb；用户级 AI Provider 配置 user_ai_settings 只在主库
  const db = c.get('tenantDb') || c.env.DB;
  const mainDb = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const body = await c.req.json().catch(() => ({}));
  const type = String(body.type || '');
  const prompt = String(body.prompt || '').trim();
  if (!AI_TYPES.includes(type)) {
    throw new ApiError('VALIDATION_ERROR', `type 必须是 ${AI_TYPES.join('|')}`);
  }
  if (!prompt) throw new ApiError('VALIDATION_ERROR', 'prompt 不能为空');

  // Provider 优先级：用户自配（主库 user_ai_settings 表，不计配额）>
  //   平台接口（platform_settings，平台管理员配置，计配额）> 环境变量 AI_API_KEY（计配额）> 内置 mock（计配额）
  const userSettings = await getUserAiSettings(mainDb, user.id);
  const platformCfg = userSettings?.api_key ? null : await getPlatformAiConfig(mainDb);
  const apiKey = userSettings?.api_key || platformCfg?.apiKey || c.env.AI_API_KEY || '';
  // billed=1：走平台侧（平台接口/环境变量/mock），计入 AI 月度配额；billed=0：用户自配接口，不计配额
  const billed = userSettings?.api_key ? 0 : 1;

  // §43：只有走平台侧的调用才校验/占用 AI 月度配额（租户级，按所在库统计）
  if (billed) {
    await checkQuota(db, tenantId, 'ai', user.id);
  }

  let result;
  let mock = false;
  if (apiKey) {
    // 真实 Provider：Workers 代理调用（§42），30 秒超时，非 2xx 视为内部错误
    const baseUrl = (
      userSettings?.base_url ||
      platformCfg?.baseUrl ||
      c.env.AI_BASE_URL ||
      'https://api.openai.com/v1'
    ).replace(/\/$/, '');
    const model = userSettings?.model || platformCfg?.model || c.env.AI_MODEL || 'gpt-4o-mini';
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
            { role: 'system', content: SYSTEM_PROMPTS[type] },
            { role: 'user', content: prompt },
          ],
        }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        throw new ApiError('INTERNAL_ERROR', `AI 服务返回异常状态 ${resp.status}`);
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

  const id = newId();
  await db
    .prepare(
      `INSERT INTO ai_generations (id, tenant_id, user_id, type, prompt, result, billed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, tenantId, user.id, type, prompt, result, billed, now())
    .run();

  return c.json({ success: true, data: { id, type, result, mock } }, 201);
});

/**
 * GET /api/v1/ai/history — 最近 20 条生成记录（当前租户）
 */
app.get('/history', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const rows = await db
    .prepare(
      `SELECT id, type, prompt, result, created_at FROM ai_generations
        WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 20`
    )
    .bind(tenantId)
    .all();
  return c.json({ success: true, data: { items: rows.results } });
});

/**
 * GET /api/v1/ai/settings — 当前用户的 AI Provider 配置（密钥仅返回掩码）
 * 响应：{ baseUrl, model, hasKey, keyMasked, source: 'user'|'env'|'mock' }
 */
app.get('/settings', requireAuth, async (c) => {
  // user_ai_settings 是用户级全局表，只在主库（试用租户也不例外）
  const db = c.env.DB;
  const user = c.get('user');
  const row = await getUserAiSettings(db, user.id);
  // 平台接口（platform_settings.ai_provider）也视为平台侧来源
  const platformCfg = await getPlatformAiConfig(db);
  return c.json({
    success: true,
    data: {
      baseUrl: row?.base_url || '',
      model: row?.model || '',
      hasKey: !!row?.api_key,
      keyMasked: maskKey(row?.api_key),
      source: row?.api_key ? 'user' : platformCfg || c.env.AI_API_KEY ? 'platform' : 'mock',
    },
  });
});

/**
 * PUT /api/v1/ai/settings — 保存/清除用户 AI Provider 配置
 * body: { baseUrl?, apiKey?, model?, clear? }
 * - clear=true：删除配置，回退到环境变量或内置 mock
 * - 未提供的字段保持原值；apiKey 传空串表示保持原密钥
 */
app.put('/settings', requireAuth, async (c) => {
  // user_ai_settings 是用户级全局表，只在主库（试用租户也不例外）
  const db = c.env.DB;
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));

  if (body.clear) {
    await db.prepare('DELETE FROM user_ai_settings WHERE user_id = ?').bind(user.id).run();
    return c.json({ success: true, data: { cleared: true } });
  }

  const row = await getUserAiSettings(db, user.id);
  const baseUrl = body.baseUrl !== undefined ? String(body.baseUrl).trim() : row?.base_url || '';
  const model = body.model !== undefined ? String(body.model).trim() : row?.model || '';
  const apiKey = body.apiKey !== undefined ? String(body.apiKey).trim() : row?.api_key || '';

  if (apiKey && baseUrl && !/^https?:\/\/.+/.test(baseUrl)) {
    throw new ApiError('VALIDATION_ERROR', '端点需以 http:// 或 https:// 开头');
  }
  if (apiKey && !model) {
    throw new ApiError('VALIDATION_ERROR', '请填写模型名称');
  }
  if (!apiKey && (baseUrl || model)) {
    throw new ApiError('VALIDATION_ERROR', '请同时填写 API 密钥');
  }

  const ts = now();
  await db
    .prepare(
      `INSERT INTO user_ai_settings (user_id, base_url, api_key, model, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET base_url = ?, api_key = ?, model = ?, updated_at = ?`
    )
    .bind(user.id, baseUrl, apiKey, model, ts, ts, baseUrl, apiKey, model, ts)
    .run();

  return c.json({
    success: true,
    data: { baseUrl, model, hasKey: !!apiKey, keyMasked: maskKey(apiKey), source: apiKey ? 'user' : 'mock' },
  });
});

export default app;
