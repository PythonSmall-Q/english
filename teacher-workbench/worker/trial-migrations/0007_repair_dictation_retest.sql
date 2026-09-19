-- 0007_repair_dictation_retest.sql — 试用库同步修复旧导入数据
UPDATE dictation_results
SET retest_required = 1
WHERE passed = 0 AND retest_completed = 0 AND retest_required = 0;