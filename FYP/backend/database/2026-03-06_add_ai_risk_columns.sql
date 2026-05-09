-- Idempotent schema update for AI risk output fields in sensor_data.
-- Run this on existing deployments before enabling AI predictions.

USE landslide_ews;

ALTER TABLE sensor_data
  ADD COLUMN IF NOT EXISTS risk_score TINYINT UNSIGNED DEFAULT 0 COMMENT '0-100 percentage',
  ADD COLUMN IF NOT EXISTS risk_level ENUM('normal', 'low', 'medium', 'high', 'critical') DEFAULT 'normal';

-- Optional indexes (uncomment if missing in your DB):
-- CREATE INDEX idx_risk_score ON sensor_data (risk_score);
-- CREATE INDEX idx_risk_level ON sensor_data (risk_level);
