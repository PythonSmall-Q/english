-- 0017_graduation.sql — 班级毕业年份
-- 毕业年份（如 2027），用于学年初自动结转时判定毕业班：
-- graduation_year 等于新学年首位年份（如 2027-2028 学年的 2027）的班级
-- 整体归档到独立毕业库 GRAD_DB 并从主库删除；NULL = 未设置/不毕业。

ALTER TABLE classes ADD COLUMN graduation_year INTEGER;
