-- Mark absence explicitly so a real zero score is not confused with an absence.
ALTER TABLE exam_scores ADD COLUMN absent INTEGER NOT NULL DEFAULT 0;

-- Historical zero scores are treated as absences by the agreed data policy.
UPDATE exam_scores SET score = NULL, absent = 1 WHERE score = 0;
