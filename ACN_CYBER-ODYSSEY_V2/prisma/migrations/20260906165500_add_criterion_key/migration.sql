-- Stable machine identity for evaluation criteria whose value is read outside
-- the evaluator console (Level 3 REPORT and RESPONSE, shown on the participant
-- page). Additive and nullable, so every existing row stays valid.
ALTER TABLE "EvaluationCriterion" ADD COLUMN "key" TEXT;

-- Unique per level. PostgreSQL does not treat NULLs as equal, so the unkeyed
-- criteria that make up the rest of the catalogue are unaffected by this.
CREATE UNIQUE INDEX "EvaluationCriterion_levelNumber_key_key" ON "EvaluationCriterion"("levelNumber", "key");
