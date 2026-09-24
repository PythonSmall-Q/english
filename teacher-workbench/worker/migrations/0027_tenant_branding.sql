-- 0027_tenant_branding.sql — 商议版租户品牌定制（校徽/校训/自定义 icon/加载图标与动画）
-- branding 存 JSON：{logoUrl, motto, faviconUrl, loaderUrl, loaderAnim}
-- 图片为 URL（可托管于 GitHub，经 raw/jsDelivr 等访问），由平台 API 下发、前端应用
ALTER TABLE tenants ADD COLUMN branding TEXT;
