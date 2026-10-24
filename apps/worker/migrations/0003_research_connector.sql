CREATE TABLE research_subscriptions (id TEXT PRIMARY KEY, version INTEGER NOT NULL, connection_id TEXT NOT NULL UNIQUE REFERENCES research_connection(id), expires_at TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)));
-- statement-breakpoint
CREATE TRIGGER research_subscription_version BEFORE UPDATE ON research_subscriptions WHEN NEW.version<>OLD.version+1 BEGIN SELECT RAISE(ABORT,'RESEARCH_CONFLICT'); END;
-- statement-breakpoint
UPDATE research_connection SET version=version+1,body=json_set(body,'$.version',version+1,'$.reason','회사 공유 Dots에서 연결 승인과 조사 이벤트 구독이 필요합니다.') WHERE json_extract(body,'$.state')='unconfigured';
