-- 合并考试（§36 衍生视图）：composite=1 的考试不存自己的分数行，
-- 总分 = 各分项 total_score 之和（任一分项为 NULL 则结果为 NULL），成绩按分项实时合并
ALTER TABLE exams ADD COLUMN composite INTEGER NOT NULL DEFAULT 0;

-- 合并考试分项关系（exam_id=合并考试，component_exam_id=分项考试，不允许嵌套合并）
CREATE TABLE exam_components (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    exam_id TEXT NOT NULL,
    component_exam_id TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_exam_components_exam ON exam_components(exam_id);
CREATE INDEX idx_exam_components_component ON exam_components(component_exam_id);
