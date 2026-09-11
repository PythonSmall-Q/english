/**
 * routes/ai.js — AI 教学助手（§41/§42/§43）
 *
 * 约定：
 * - 快捷指令 type：practice 生成练习题 / lesson_plan 写教案 / essay_feedback 批改作文
 *   / analysis 学情解读 / translate 中英互译
 * - 流程（§42）：身份/租户/角色校验 → checkQuota('ai') → 构造 system prompt
 *   → 有 AI_API_KEY 走真实 Provider，无 key 用内置 mock（保证可演示）→ 写 ai_generations
 * - 浏览器不直连 AI Provider，全部经 Worker 代理
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
        `（当前为本地模拟生成，配置 AI_API_KEY 后将调用真实模型）`
      );
    case 'lesson_plan':
      return (
        `【教案 · Mock】课题：${key}\n\n一、教学目标\n1. 知识目标：掌握本课核心词汇与句型。\n2. 能力目标：提升阅读理解与口头表达能力。\n` +
        `二、教学重难点\n重点：核心词汇运用；难点：长难句理解。\n三、教学过程\n1. 导入（5 分钟）2. 新授（20 分钟）3. 操练（15 分钟）4. 总结与作业（5 分钟）\n` +
        `四、作业布置\n完成课后练习并背诵重点段落。\n（当前为本地模拟生成，配置 AI_API_KEY 后将调用真实模型）`
      );
    case 'essay_feedback':
      return (
        `【作文批改 · Mock】\n\n原文要点：${key}\n\n一、主要问题\n1. 时态不一致：叙事部分应统一使用过去时。\n2. 中式表达：注意主谓一致与冠词使用。\n` +
        `二、修改建议\n建议多用连接词（however / therefore / in addition）增强连贯性。\n三、评定等级：B（良好）\n总评：结构完整、内容充实，注意语法细节即可更上一层楼。\n` +
        `（当前为本地模拟生成，配置 AI_API_KEY 后将调用真实模型）`
      );
    case 'analysis':
      return (
        `【学情解读 · Mock】\n\n数据：${key}\n\n一、整体情况\n班级均分稳定，及格率良好。\n二、优势题型\n阅读与听力整体表现较好。\n` +
        `三、薄弱题型\n完形填空与书面表达失分集中，需专项训练。\n四、教学建议\n1. 对薄弱学生分层布置基础巩固任务；2. 每周安排一次限时完形训练。\n` +
        `（当前为本地模拟生成，配置 AI_API_KEY 后将调用真实模型）`
      );
    case 'translate':
      return (
        `【中英互译 · Mock】\n\n原文：${key}\n\n译文：这是一条本地模拟的翻译结果。配置 AI_API_KEY 后将调用真实模型提供准确译文。\n` +
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
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const body = await c.req.json().catch(() => ({}));
  const type = String(body.type || '');
  const prompt = String(body.prompt || '').trim();
  if (!AI_TYPES.includes(type)) {
    throw new ApiError('VALIDATION_ERROR', `type 必须是 ${AI_TYPES.join('|')}`);
  }
  if (!prompt) throw new ApiError('VALIDATION_ERROR', 'prompt 不能为空');

  // §43：写操作前先校验 AI 月度配额
  await checkQuota(db, tenantId, 'ai');

  let result;
  let mock = false;
  if (c.env.AI_API_KEY) {
    // 真实 Provider：Workers 代理调用（§42），30 秒超时，非 2xx 视为内部错误
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    try {
      const resp = await fetch(`${c.env.AI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${c.env.AI_API_KEY}`,
        },
        body: JSON.stringify({
          model: c.env.AI_MODEL || 'gpt-4o-mini',
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
      `INSERT INTO ai_generations (id, tenant_id, user_id, type, prompt, result, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, tenantId, user.id, type, prompt, result, now())
    .run();

  return c.json({ success: true, data: { id, type, result, mock } }, 201);
});

/**
 * GET /api/v1/ai/history — 最近 20 条生成记录（当前租户）
 */
app.get('/history', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.env.DB;
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

export default app;
