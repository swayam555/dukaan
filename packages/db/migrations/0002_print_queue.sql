-- Print queue backoff: a job is not retried before next_at (unix ms).
ALTER TABLE print_job ADD COLUMN next_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX print_job_due ON print_job(status, next_at);
