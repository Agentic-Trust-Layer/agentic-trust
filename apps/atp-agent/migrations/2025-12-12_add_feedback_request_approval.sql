-- Add approval fields to feedback requests
ALTER TABLE agent_feedback_requests ADD COLUMN approved INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_feedback_requests ADD COLUMN approved_on_date INTEGER NULL; -- unix seconds
ALTER TABLE agent_feedback_requests ADD COLUMN approved_for_days INTEGER NULL;


