# iso-agent

ISO/IEC 42001(AIMS) 운영을 위한 **LLM Wiki · Wirelog 온톨로지 에이전트** (MPL-2.0).

가상 조직 에이아이듀 / Edu Score 문서(`docs/`, `records/`)를 데모 데이터로 사용합니다.

## 기능 (MVP)

- 매뉴얼·절차·지침·양식·기록 조회
- 시드 JSON 수동 import (dry-run / overwrite)
- `records/` 스캔 시 **자동 승인(auto_approved) fact** 적재
- Wirelog 호환 규칙으로 요구사항 추적·증거 후보·영향 집합 질의
- 승인 지식 우선 Q&A (OpenAI API)
- Edu Score 영향평가 **초안** (양식 자동완성·records 확정 없음)
- 드롭다운 Person 선택(비밀번호 없음) + 온톨로지 권한(`holds_role` / `grants`)

## 제외

연간 알림, 외부 이슈 수집, Grok Bot, OAuth, 자동 적합성 판정.

## 요구 사항

- Node 20+, pnpm 9+
- Cloudflare Workers Paid (로컬 `wrangler dev` 가능)
- OpenAI API 키 → `.dev.vars`에 `OPENAI_API_KEY=...` (커밋 금지)

## 빠른 시작

```bash
pnpm install
pnpm corpus:scan
pnpm db:migrate:local
pnpm --filter @iso-agent/worker exec wrangler d1 execute iso-agent --local --command "SELECT 1"
pnpm dev
```

브라우저에서 `http://127.0.0.1:8787` 접속 후:

1. **Bootstrap**: `POST /api/bootstrap` (또는 UI에서 예시 시드 import)로 Person/Role/권한·기본 온톨로지 적재
2. 상단에서 사용자 선택 (예: 홍길동 `person:P15`)
3. 문서 스캔 → 기록 스캔·자동 fact화
4. 질의 / 영향평가 초안 실행

예시 시드: [`seed/example-persons-roles.json`](seed/example-persons-roles.json)  
시드 스키마: [`seed/schema.json`](seed/schema.json)

## 배포

```bash
pnpm corpus:scan
# Cloudflare 대시보드에서 D1 database_id 생성 후 wrangler.toml에 반영
pnpm --filter @iso-agent/worker exec wrangler d1 migrations apply iso-agent --remote
pnpm --filter @iso-agent/worker exec wrangler secret put OPENAI_API_KEY
pnpm deploy
```

커스텀 도메인 `iso-agent.superhot.company`는 Cloudflare 존에서 Worker 라우트로 연결합니다.

## Wirelog 엔진 컨테이너

[`apps/engine`](apps/engine)는 FastAPI + (가능하면) PyreWire 사이드카입니다.  
Worker의 `ENGINE_URL`이 설정되면 `/api/graph/query`가 컨테이너를 우선 호출하고, 실패 시 Worker 내장 엔진으로 폴백합니다.

```bash
cd apps/engine && docker build -t iso-agent-engine . && docker run -p 8080:8080 iso-agent-engine
```

## 라이선스

- 앱 코드: [MPL-2.0](LICENSE)
- 제3자: [NOTICE](NOTICE) (Wirelog LGPL 등)
- `.raw/` 규격 원문은 재배포하지 않습니다.

## 이슈

구현 추적: https://github.com/forcom/iso-agent/issues/1
