/**
 * branding.js — 空间品牌定制的校验与保存（平台管理员 / 空间所有者共用）
 *
 * branding JSON：{ logoUrl?, motto?, faviconUrl?, loaderUrl?, loaderAnim? }
 * 图片为 URL（可用平台 GitHub 图床上传获得，亦可托管任意图床）；全部为空 = 清除。
 */
import { ApiError, now } from './db.js';

export const BRAND_ANIMS = ['spin', 'pulse', 'bounce', 'bar'];

/** 校验 body → branding 对象（无任一字段返回 null=清除）；非法值抛 ApiError */
export function validateBranding(body) {
  const branding = {};
  for (const f of ['logoUrl', 'faviconUrl', 'loaderUrl']) {
    const v = String(body[f] || '').trim();
    if (v && !/^https?:\/\//.test(v)) {
      throw new ApiError('VALIDATION_ERROR', `${f} 必须是 http(s) 图片地址`);
    }
    if (v) branding[f] = v;
  }
  const motto = String(body.motto || '').trim();
  if (motto.length > 60) throw new ApiError('VALIDATION_ERROR', '校训需为 60 字以内');
  if (motto) branding.motto = motto;
  const loaderAnim = String(body.loaderAnim || '').trim();
  if (loaderAnim && !BRAND_ANIMS.includes(loaderAnim)) {
    throw new ApiError('VALIDATION_ERROR', `loaderAnim 必须是 ${BRAND_ANIMS.join('|')}`);
  }
  if (loaderAnim) branding.loaderAnim = loaderAnim;
  return Object.keys(branding).length ? branding : null;
}

/** 保存（null=清除），返回保存后的对象或 null */
export async function saveBranding(db, tenantId, branding) {
  await db
    .prepare('UPDATE tenants SET branding = ?, updated_at = ? WHERE id = ?')
    .bind(branding ? JSON.stringify(branding) : null, now(), tenantId)
    .run();
  return branding;
}

/** 解析 tenants.branding 列 → 对象或 null */
export function parseBranding(raw) {
  if (!raw) return null;
  try {
    const b = JSON.parse(raw);
    return b && typeof b === 'object' ? b : null;
  } catch {
    return null;
  }
}
