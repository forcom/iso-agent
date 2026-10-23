CREATE TABLE research_connection (id TEXT PRIMARY KEY, version INTEGER NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)));
-- statement-breakpoint
INSERT INTO research_connection VALUES('company-dots',1,'{"id":"company-dots","version":1,"state":"unconfigured","label":"회사 공유 Dots","reason":"회사 인증·Dots 연결 검증이 필요합니다."}');
-- statement-breakpoint
CREATE TABLE research_schedules (id TEXT PRIMARY KEY, version INTEGER NOT NULL, next_at TEXT, enabled INTEGER NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)));
-- statement-breakpoint
CREATE INDEX research_due ON research_schedules(enabled,next_at);
-- statement-breakpoint
CREATE TABLE research_jobs (id TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, schedule_id TEXT REFERENCES research_schedules(id), slot TEXT, body TEXT NOT NULL CHECK(json_valid(body)), UNIQUE(schedule_id,slot));
-- statement-breakpoint
CREATE INDEX research_queue ON research_jobs(state,created_at);
-- statement-breakpoint
CREATE TABLE research_attempts (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES research_jobs(id), state TEXT NOT NULL, expires_at TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)));
-- statement-breakpoint
CREATE UNIQUE INDEX research_one_active_attempt ON research_attempts((1)) WHERE state IN ('reserved','running');
-- statement-breakpoint
CREATE TABLE research_outbox (id TEXT PRIMARY KEY REFERENCES research_jobs(id), state TEXT NOT NULL, event_id TEXT, body TEXT NOT NULL CHECK(json_valid(body)));
-- statement-breakpoint
CREATE TABLE research_results (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES research_jobs(id), attempt_id TEXT UNIQUE NOT NULL REFERENCES research_attempts(id), body TEXT NOT NULL CHECK(json_valid(body)));
-- statement-breakpoint
CREATE TABLE research_proposals (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES research_jobs(id), result_id TEXT NOT NULL REFERENCES research_results(id), body TEXT NOT NULL CHECK(json_valid(body)));
-- statement-breakpoint
CREATE TABLE research_adoptions (id TEXT PRIMARY KEY REFERENCES research_proposals(id), artifact_id TEXT NOT NULL REFERENCES artifacts(id), revision_id TEXT NOT NULL REFERENCES revisions(id), body TEXT NOT NULL CHECK(json_valid(body)));
-- statement-breakpoint
CREATE TRIGGER research_job_version BEFORE UPDATE ON research_jobs WHEN NEW.version<>OLD.version+1 BEGIN SELECT RAISE(ABORT,'RESEARCH_CONFLICT'); END;
-- statement-breakpoint
CREATE TRIGGER research_schedule_version BEFORE UPDATE ON research_schedules WHEN NEW.version<>OLD.version+1 BEGIN SELECT RAISE(ABORT,'RESEARCH_CONFLICT'); END;
-- statement-breakpoint
CREATE TRIGGER research_connection_version BEFORE UPDATE ON research_connection WHEN NEW.version<>OLD.version+1 BEGIN SELECT RAISE(ABORT,'RESEARCH_CONFLICT'); END;
-- statement-breakpoint
CREATE TRIGGER research_results_immutable_update BEFORE UPDATE ON research_results BEGIN SELECT RAISE(ABORT,'IMMUTABLE_EVENT'); END;
-- statement-breakpoint
CREATE TRIGGER research_results_immutable_delete BEFORE DELETE ON research_results BEGIN SELECT RAISE(ABORT,'IMMUTABLE_EVENT'); END;
-- statement-breakpoint
CREATE TRIGGER research_proposals_immutable_update BEFORE UPDATE ON research_proposals BEGIN SELECT RAISE(ABORT,'IMMUTABLE_EVENT'); END;
-- statement-breakpoint
CREATE TRIGGER research_proposals_immutable_delete BEFORE DELETE ON research_proposals BEGIN SELECT RAISE(ABORT,'IMMUTABLE_EVENT'); END;
-- statement-breakpoint
CREATE TRIGGER research_adoptions_immutable_update BEFORE UPDATE ON research_adoptions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_EVENT'); END;
-- statement-breakpoint
CREATE TRIGGER research_adoptions_immutable_delete BEFORE DELETE ON research_adoptions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_EVENT'); END;
