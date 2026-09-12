-- 0016_archive_summary.sql — 主表新增 archived_stats 汇总列（归档方案改版）
-- 改版后归档不再删除主表行：归档时把该行明细的汇总统计 JSON 写入 archived_stats，
-- 仅删除子表明细行。查看历史学年列表直接读主表删减行，统计取自 archived_stats；
-- 完整明细仅保留在 year_archives.payload（gzip+base64）中，供租户管理员下载离线解压。
-- archived_stats 为 JSON 字符串，各模块口径与对应路由 GET / 的统计子查询完全一致：
--   dictations: {"registered":n,"passed":n,"failed":n,"retestRequired":n,"retestCompleted":n}
--     （failed=未过且无需重默；retestRequired=需重默且未重默）
--   assignments: {"total":n,"submitted":n,"missing":n}（missing 含 missing+pending）
--   exams: {"studentCount":n,"avgScore":n}（avg 保留 2 位小数，无成绩为 null）
-- 未归档行该列为 NULL。

ALTER TABLE dictations ADD COLUMN archived_stats TEXT;
ALTER TABLE assignments ADD COLUMN archived_stats TEXT;
ALTER TABLE exams ADD COLUMN archived_stats TEXT;
