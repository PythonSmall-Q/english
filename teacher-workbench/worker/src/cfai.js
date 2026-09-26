/**
 * cfai.js — Cloudflare Workers AI 模型目录与计费（§41 扩展）
 *
 * 约定：
 * - 模型目录 CF_MODELS 为本服务支持的全部 Workers AI 文本模型（id/label/标签/单价）
 * - tag：low=低 / efficient=经济 / high=高 / extra-high=极高（前端徽标四色同构）
 * - 计费：creditsUsed = usage.credits ?? ceil(totalTokens / 1000 × creditsPer1k)
 * - 目录为前后端共享契约：frontend 持有同构常量，改动须同步
 */

/** Cloudflare Workers AI 模型目录 */
/**
 * Cloudflare 官方定价精确计费（developers.cloudflare.com/workers-ai/platform/pricing）。
 * 1 tenant credit = $0.01（与 Cloudflare 预付 credit 同口径）；
 * inPer1k / outPer1k = 每 1K 输入/输出 token 的 credits（官方 $/M × 100 / 1000），输入输出分列。
 * 若 Workers AI 将来在 usage 里直接回传 credits，优先采用回传值。
 * 档位按输出价分档：low≤0.04 / efficient≤0.08 / high≤0.25 / extra-high>0.25（credits per 1k out）。
 */
export const CF_MODELS = [
  // ---- low ----
  { id: '@cf/ibm-granite/granite-4.0-h-micro', label: 'Granite 4.0 H Micro', tag: 'low', inPer1k: 0.0017, outPer1k: 0.0112 },
  { id: '@cf/mistral/mistral-7b-instruct-v0.1', label: 'Mistral 7B', tag: 'low', inPer1k: 0.011, outPer1k: 0.019 },
  { id: '@cf/meta/llama-3.2-1b-instruct', label: 'Llama 3.2 1B', tag: 'low', inPer1k: 0.0027, outPer1k: 0.0201 },
  { id: '@cf/meta/llama-3.2-3b-instruct', label: 'Llama 3.2 3B', tag: 'low', inPer1k: 0.0051, outPer1k: 0.0335 },
  // ---- efficient ----
  { id: '@cf/meta/llama-3.1-8b-instruct-fp8-fast', label: 'Llama 3.1 8B Fast', tag: 'efficient', inPer1k: 0.0045, outPer1k: 0.0384 },
  { id: '@cf/openai/gpt-oss-20b', label: 'GPT-OSS 20B', tag: 'efficient', inPer1k: 0.02, outPer1k: 0.03 },
  { id: '@cf/qwen/qwen3-30b-a3b-fp8', label: 'Qwen3 30B A3B', tag: 'efficient', inPer1k: 0.0051, outPer1k: 0.0335 },
  { id: '@cf/zai-org/glm-4.7-flash', label: 'GLM 4.7 Flash', tag: 'efficient', inPer1k: 0.006, outPer1k: 0.04 },
  { id: '@cf/google/gemma-3-12b-it', label: 'Gemma 3 12B', tag: 'efficient', inPer1k: 0.0345, outPer1k: 0.0556 },
  { id: '@cf/meta/llama-3.1-8b-instruct', label: 'Llama 3.1 8B', tag: 'efficient', inPer1k: 0.0282, outPer1k: 0.0827 },
  // ---- high ----
  { id: '@cf/openai/gpt-oss-120b', label: 'GPT-OSS 120B', tag: 'high', inPer1k: 0.035, outPer1k: 0.075 },
  { id: '@cf/nvidia/nemotron-3-120b-a12b', label: 'Nemotron 3 120B', tag: 'high', inPer1k: 0.05, outPer1k: 0.15 },
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'Llama 3.3 70B', tag: 'high', inPer1k: 0.0293, outPer1k: 0.2253 },
  { id: '@cf/moonshotai/kimi-k2.5', label: 'Kimi K2.5', tag: 'high', inPer1k: 0.06, outPer1k: 0.3 },
  // ---- extra-high ----
  { id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', label: 'DeepSeek R1 32B', tag: 'extra-high', inPer1k: 0.0497, outPer1k: 0.4881 },
];

/** tag 中文（错误提示/前端徽标映射同源） */
export const CF_TAG_LABELS = { low: '低', efficient: '经济', high: '高', 'extra-high': '极高' };

/** 按 id 查目录项，未命中返回 null */
export function getCfModel(id) {
  return CF_MODELS.find((m) => m.id === id) || null;
}

/**
 * 解析 platform_settings 'cf_ai' 的值（JSON {enabled}）。
 * @param {string|null|undefined} value
 * @returns {{enabled: boolean}}
 */
export function parseCfAiSetting(value) {
  try {
    const cfg = value ? JSON.parse(value) : null;
    return { enabled: !!(cfg && cfg.enabled) };
  } catch {
    return { enabled: false };
  }
}

/**
 * 估算/读取一次生成消耗的 credits。
 * usage 支持两种形态：{credits}（CF 显式回传，直接采用）或
 * {prompt_tokens, completion_tokens[, total_tokens]}（按官方输入/输出分列单价精确计算）。
 * @param {string} modelId 模型 id（须在目录内；未命中按 low 档平均价兜底）
 * @param {object|null|undefined} usage Workers AI run 的 response.usage
 * @returns {number} credits（向上取整到 0.001，最小 0.001；1 credit = $0.01）
 */
export function estimateCredits(modelId, usage) {
  if (usage && typeof usage.credits === 'number' && Number.isFinite(usage.credits)) {
    return Math.max(0.001, Math.ceil(usage.credits * 1000) / 1000);
  }
  const m = getCfModel(modelId);
  const inRate = m?.inPer1k ?? 0.02;
  const outRate = m?.outPer1k ?? 0.03;
  const pin = usage ? Number(usage.prompt_tokens ?? usage.promptTokens ?? 0) || 0 : 0;
  const pout = usage ? Number(usage.completion_tokens ?? usage.completionTokens ?? 0) || 0 : 0;
  let credits;
  if (pin + pout > 0) {
    credits = (pin / 1000) * inRate + (pout / 1000) * outRate;
  } else {
    // 无分列仅有总量时按两档均价折算
    const total = usage ? Number(usage.total_tokens ?? usage.totalTokens ?? 0) || 0 : 0;
    credits = (total / 1000) * ((inRate + outRate) / 2);
  }
  return Math.max(0.001, Math.ceil(credits * 1000) / 1000);
}

/** 当前月份 YYYY-MM（UTC 月份即可，与 substr(created_at,1,7) 口径一致） */
export function currentCreditMonth() {
  return new Date().toISOString().slice(0, 7);
}

/**
 * 月度补足（惰性：在新月首次使用时触发一次）：
 * 余额补足到「月度限额 + 加赠余额」；加赠池不动；已耗尽的管理员加赠不会复活。
 * @returns {Promise<boolean>} 是否执行了补足
 */
export async function ensureMonthlyReplenish(db, tenantId) {
  const row = await db
    .prepare('SELECT ai_credits_monthly, ai_credits_bonus, ai_credits_period FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!row || row.ai_credits_monthly == null) return false;
  const ym = currentCreditMonth();
  if (row.ai_credits_period === ym) return false;
  await db
    .prepare('UPDATE tenants SET ai_credits = ai_credits_monthly + ai_credits_bonus, ai_credits_period = ? WHERE id = ?')
    .bind(ym, tenantId)
    .run();
  return true;
}
