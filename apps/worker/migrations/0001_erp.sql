PRAGMA foreign_keys=ON;
-- statement-breakpoint
CREATE TABLE context (id INTEGER PRIMARY KEY CHECK(id=1), release_id TEXT NOT NULL, rules_hash TEXT NOT NULL, data_revision INTEGER NOT NULL DEFAULT 0, authority_revision INTEGER NOT NULL DEFAULT 0);
-- statement-breakpoint
CREATE TABLE persons (id TEXT PRIMARY KEY, body TEXT NOT NULL CHECK(json_valid(body)));
-- statement-breakpoint
CREATE TABLE sessions (id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES persons(id), version INTEGER NOT NULL, updated_at TEXT NOT NULL);
-- statement-breakpoint
CREATE TABLE artifacts (id TEXT PRIMARY KEY, document_code TEXT UNIQUE NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('regulation','template','record')), body TEXT NOT NULL CHECK(json_valid(body)));
-- statement-breakpoint
CREATE TABLE revisions (id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id), body TEXT NOT NULL CHECK(json_valid(body)));
-- statement-breakpoint
CREATE TABLE relations (id TEXT PRIMARY KEY, body TEXT NOT NULL CHECK(json_valid(body)));
-- statement-breakpoint
CREATE TABLE decisions (id TEXT PRIMARY KEY, revision_id TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)));
-- statement-breakpoint
CREATE TABLE circulations (id TEXT PRIMARY KEY, revision_id TEXT NOT NULL REFERENCES revisions(id), body TEXT NOT NULL CHECK(json_valid(body)));
-- statement-breakpoint
CREATE TABLE receipts (id TEXT PRIMARY KEY, circulation_id TEXT NOT NULL REFERENCES circulations(id), person_id TEXT NOT NULL REFERENCES persons(id), kind TEXT NOT NULL CHECK(kind IN ('received','understood')), body TEXT NOT NULL CHECK(json_valid(body)), UNIQUE(circulation_id,person_id,kind));
-- statement-breakpoint
CREATE TABLE events (id TEXT PRIMARY KEY, artifact_id TEXT, body TEXT NOT NULL CHECK(json_valid(body)));
-- statement-breakpoint
CREATE TABLE assignments (id TEXT PRIMARY KEY, body TEXT NOT NULL CHECK(json_valid(body)));
-- statement-breakpoint
CREATE TABLE releases (id TEXT PRIMARY KEY, object_key TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)));
-- statement-breakpoint
CREATE TABLE regulation_changes (id TEXT PRIMARY KEY, body TEXT NOT NULL CHECK(json_valid(body)));
-- statement-breakpoint
CREATE TABLE mutation_requests (actor_id TEXT NOT NULL, request_key TEXT NOT NULL, payload_hash TEXT NOT NULL, result TEXT NOT NULL CHECK(json_valid(result)), session_id TEXT NOT NULL, session_version INTEGER NOT NULL, release_id TEXT NOT NULL, data_revision INTEGER NOT NULL, authority_revision INTEGER NOT NULL, rules_hash TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(actor_id, request_key));
-- statement-breakpoint
CREATE TRIGGER mutation_fence BEFORE INSERT ON mutation_requests BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM context WHERE id=1 AND release_id=NEW.release_id AND data_revision=NEW.data_revision AND authority_revision=NEW.authority_revision AND rules_hash=NEW.rules_hash) THEN RAISE(ABORT,'CONTEXT_CONFLICT') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sessions s JOIN persons p ON p.id=s.person_id WHERE s.id=NEW.session_id AND s.version=NEW.session_version AND s.person_id=NEW.actor_id AND json_extract(p.body,'$.active')=1) THEN RAISE(ABORT,'SESSION_CONFLICT') END;
END;
-- statement-breakpoint
CREATE TRIGGER decisions_immutable_update BEFORE UPDATE ON decisions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_EVENT'); END;
-- statement-breakpoint
CREATE TRIGGER decisions_immutable_delete BEFORE DELETE ON decisions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_EVENT'); END;
-- statement-breakpoint
CREATE TRIGGER events_immutable_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'IMMUTABLE_EVENT'); END;
-- statement-breakpoint
CREATE TRIGGER events_immutable_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'IMMUTABLE_EVENT'); END;
-- statement-breakpoint
CREATE TRIGGER receipts_immutable_update BEFORE UPDATE ON receipts BEGIN SELECT RAISE(ABORT,'IMMUTABLE_EVENT'); END;
-- statement-breakpoint
CREATE TRIGGER receipts_immutable_delete BEFORE DELETE ON receipts BEGIN SELECT RAISE(ABORT,'IMMUTABLE_EVENT'); END;
-- statement-breakpoint
CREATE INDEX revision_artifact ON revisions(artifact_id);
-- statement-breakpoint
CREATE INDEX decision_revision ON decisions(revision_id);
-- statement-breakpoint
CREATE INDEX event_artifact ON events(artifact_id);
