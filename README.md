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
- OpenAI API 키 → 루트 `.dev.vars`에 `OPENAI_API_KEY=...` (커밋 금지)<br>
  Worker는 `apps/worker/.dev.vars` → `../../.dev.vars` 심볼릭 링크를 사용합니다.

## 빠른 시작

```bash
pnpm install
pnpm corpus:scan          # docs/records 매니페스트 + public/seed 동기화
pnpm db:migrate:local
pnpm dev                  # http://127.0.0.1:8787
```

브라우저에서:

1. 첫 접속 시 `/api/bootstrap`이 예시 시드를 적재합니다 (Person이 없을 때만).
2. 상단에서 사용자 선택 (시드·스캔 모두: `person:P03` 기술책임자; `person:P15`는 스캔·질의, `person:P01`은 시드·질의).
3. **문서 스캔** → **기록 스캔·자동 fact화**.
4. 질의 / 영향평가 초안 실행.

---

## 로컬에서 전체 매뉴얼·절차 시드하기

규범 지식(매뉴얼·절차·지침·양식·요구사항 관계)은 **시드 JSON**으로 넣고,<br>
운영 증적(`records/`)은 **스캔 시 자동 승인 fact**로 넣습니다. 두 경로를 섞지 마세요.

### 1. 시드가 담는 것

| 구분 | 넣는 곳 | 승인 |
| --- | --- | --- |
| Person / Role / Permission | 시드 `entities` + `holds_role` / `grants` | 시드 `status` |
| Document / Requirement / RecordTemplate | 시드 `entities` | — |
| `addresses`, `depends_on`, `requires_record` 등 | 시드 `facts` (`knowledge_kind=normative`) | `draft`면 UI에서 승인, `approved`면 즉시 그래프 반영 |
| 주제별 설명 페이지 | 시드 `wiki_pages` | `approved` 권장 |
| 작성된 기록 파일 | `records/*.md` 스캔 | 항상 `auto_approved` (`knowledge_kind=record`) |

스키마: [`seed/schema.json`](seed/schema.json)<br>
저장소 기본 시드: [`seed/example-persons-roles.json`](seed/example-persons-roles.json)

현재 예시 시드에는 Person/Role/권한과 함께 저장소 ISO 문서·양식·요구사항 매핑이 포함되어 있습니다.

- 문서: 매뉴얼 8 + 절차(목차 포함) + 지침(목차 포함)
- 기록 양식·요구사항 개체와 `source_ref`(원문 Markdown / 매뉴얼 행)
- `addresses`: 매뉴얼 조항 ↔ 절차·지침
- `depends_on`: 절차→매뉴얼, 지침→매뉴얼·절차
- `requires_record`: 절차→양식 (조건부 양식은 필수 누락으로 집계하지 않도록 `depends_on`으로 조건 연결)

시드의 `approved`는 **데모용 문서 관계 상태**이며, 운영 적합성 판정이 아닙니다.

### 2. 새 로컬 DB에 한 번에 올리기 (권장)

```bash
pnpm corpus:scan
pnpm db:migrate:local
pnpm dev
```

- UI 첫 로드 또는 `curl -X POST http://127.0.0.1:8787/api/bootstrap`<br>
  → `seed/example-persons-roles.json` 전체를 D1에 import<br>
- 사용자 선택 후 **문서 스캔** / **기록 스캔**

공개 Assets에 올라가는 시드 사본은 `pnpm corpus:scan`이 `apps/worker/public/seed/`로 복사합니다.<br>
시드 파일을 고쳤으면 **반드시 `pnpm corpus:scan` 후** 서버를 다시 띄우거나 시드 탭에서 다시 import하세요.

### 3. 이미 Bootstrap한 DB에 시드만 다시 넣기

`seed.import` 권한이 있는 사용자로 로그인합니다 (예: `person:P01`, `person:P03`, `person:P04`).

**UI**

1. **시드** 탭 → **예시 시드 로드** (또는 자체 JSON 붙여넣기)
2. **dry-run** 켠 채 Import → 건수·오류 확인
3. dry-run 해제 후 Import<br>
   - 기존 fact id를 덮어쓰려면 **overwrite** 체크

**API**

```bash
# 세션 쿠키가 필요하면 브라우저에서 로그인 후, 또는 아래처럼 session 후 -b 사용
curl -c /tmp/iso -X POST http://127.0.0.1:8787/api/session \
  -H 'content-type: application/json' \
  -d '{"person_id":"person:P03"}'

curl -b /tmp/iso -X POST http://127.0.0.1:8787/api/seed/import \
  -H 'content-type: application/json' \
  -d @<(python3 -c "
import json
seed=json.load(open('seed/example-persons-roles.json'))
print(json.dumps({'seed': seed, 'dry_run': False, 'overwrite': True}))
")
```

**CLI (형태만 검증·요약)**

```bash
pnpm seed:import seed/example-persons-roles.json
```

실제 D1 적재는 Worker `/api/seed/import` 또는 bootstrap입니다.

### 4. Cursor 등으로 시드를 새로 만들 때

1. `docs/manual/`, `docs/procedure/`, `docs/guide/`, `docs/forms/`를 읽고<br>
   [`seed/schema.json`](seed/schema.json) + [`packages/ontology/relations.json`](packages/ontology/relations.json)에 맞게 JSON 작성
2. 권장 ID 규칙
   - 문서: `doc:AIDU-AIM-01-01`, `doc:AIDU-AIP-06-02`
   - 요구: `req:42001-6.1.4`
   - 양식: `tpl:AIDU-AIP-06-02-F01`
   - fact: `fact:seed:...` (records 자동분은 `fact:record:...`)
3. 각 fact에 `source_document_id`, 가능하면 `quote` / `source_ref` 유지
4. 처음에는 `status: "draft"`로 import → Fact 탭에서 승인<br>
   또는 검토 끝난 뒤 `approved`로 import
5. `wiki_pages`에 주제 요약(주장+인용+fact_ids)을 넣으면 Q&A가 위키를 우선 사용
6. 파일을 `seed/my-aims.json` 등으로 저장 → UI/API import → `pnpm corpus:scan`(배포·bootstrap용 복사본이 필요하면 public에 반영)

Person/Role만 예시 시드를 쓰고, 문서 관계는 별도 파일로 나눠 import해도 됩니다 (같은 스키마).

### 5. records는 시드에 넣지 않기

```text
문서 스캔  → documents 레지스트리 + Document 개체
기록 스캔  → Record / instance_of / produced_by / evidence_for 등 auto_approved
```

기록 파일을 추가·수정한 뒤 **기록 스캔**만 다시 하면 그래프에 반영됩니다. 시드 JSON을 고칠 필요 없습니다.

---

## LLM Wiki 인제스트 → Wirelog 온톨로지 구축

원문과 계산용 사실을 분리합니다.

```text
docs/ · records/          원문 (Assets)
        │
        ├─ 시드 JSON ──► entities + normative facts + wiki_pages
        │                 (사람/구독 LLM으로 작성·검토)
        │
        └─ 스캔 ────────► record auto_approved facts
                          (결정적 파서)

승인된 fact + rules.dl ──► OntologyEngine / Wirelog 엔진
        │
        ├─ trace / evidence / missing / impact
        └─ Q&A · 영향평가 초안 (승인 지식 우선)
```

### 단계 A — 원문 인덱스

```bash
pnpm corpus:scan
```

`apps/worker/public/corpus-manifest.json`에 docs·records 경로 목록이 생깁니다.

### 단계 B — 규범 온톨로지 (LLM Wiki 쪽)

저장소의 26개 원문을 검토한 요약은 [`seed/wiki-curation.json`](seed/wiki-curation.json)에 보관합니다.
다음 명령으로 문서별 26개·주제별 7개·색인 1개를 기본 시드의 `wiki_pages`에 구성합니다.
기존 Edu Score 페이지까지 합쳐 35개 페이지이며, 주장·인용 231개에 원문 위치와 SHA-256을 연결합니다.

```bash
pnpm wiki:ingest
pnpm wiki:check
pnpm corpus:scan
```

문서별 페이지에는 검토 요약, 절별 대표 실행 기준의 정확한 인용, fact ID와 상호참조를 넣습니다.
대표 인용은 원문의 모든 조건·예외를 대체하지 않습니다. 기록 원문은 이 인제스트에 포함하지 않습니다.
원문 해시가 바뀌면 인제스트가 중단되므로 변경된 요약·관계·인용을 검토하고 curation의 해시를 갱신합니다.
승인된 fact만 위키의 관계 설명·참조에 포함하며, 보존하는 승인 페이지가 초안 fact를 참조하면 검토를 위해 생성을 중단합니다.
[`seed/wiki-ingest-manifest.json`](seed/wiki-ingest-manifest.json)은 출처·시드·규칙 해시와 생성 페이지 목록을 기록합니다.
`wiki:check`는 출처 변경, 원문 인용, 누락 문서, 끊어진 링크·fact 참조와 생성 결과의 일치를 확인합니다.
이 명령은 파일 생성·검증 단계이며, D1에는 위의 `/api/seed/import`로 적재합니다.

1. **추출(오프라인)**: Cursor 등에서 원문을 읽고 개체·관계·위키 claim 후보를 JSON으로 작성<br>
   - 위키 claim = 읽기용 설명 + `quote` + 가능하면 `fact_ids`<br>
   - fact = Wirelog에 넣을 triple (`subject`/`predicate`/`object`)
2. **Import**: `/api/seed/import` (dry-run → 적용)
3. **검토**: Fact 탭에서 `draft` 승인/반려 (이미 `approved`면 생략)
4. **위키**: import된 `wiki_pages`는 **위키** 탭에서 확인. Q&A는 `status=approved` 페이지만 사용

위키 문장만 고쳐도 그래프는 바뀌지 않습니다. 구조 변경은 **fact를 다시 import·승인**해야 합니다.

### 단계 C — 운영 증적 fact화

UI **기록 스캔·자동 fact화** 또는:

```bash
curl -b /tmp/iso -X POST http://127.0.0.1:8787/api/corpus/scan-records
```

`knowledge_kind=record`, `status=auto_approved`로 적재되며 시드 fact와 ID 네임스페이스가 분리됩니다 (`fact:record:…`).

### 단계 D — Wirelog 규칙으로 질의

내장 엔진(또는 `ENGINE_URL`의 [`apps/engine`](apps/engine))이 [`packages/ontology/rules.dl`](packages/ontology/rules.dl)과 같은 의미로 계산합니다.

| 질의 유형 | 의미 | UI / API |
| --- | --- | --- |
| `trace` | 요구사항 ↔ 문서 ↔ 양식 ↔ 기록 | 요구사항 추적, id=`req:42001-6.1.4` |
| `evidence` | 증거 **후보** (충족 판정 아님) | 증거 후보 |
| `missing` | 양식은 요구되나 기록 instance 없음 | 미확인 증거 |
| `impact` | `depends_on` **역방향** 재검토 목록 | 영향 집합, id=`aisystem:edu-score` |

```bash
curl -b /tmp/iso -X POST http://127.0.0.1:8787/api/graph/query \
  -H 'content-type: application/json' \
  -d '{"type":"trace","id":"req:42001-6.1.4"}'
```

스냅샷(승인 fact id 목록 고정):

```bash
curl -b /tmp/iso -X POST http://127.0.0.1:8787/api/snapshots
```

### 단계 E — 승인 지식으로 답·초안

- **자연어 Q&A**: 승인 위키 + 승인/자동승인 그래프를 넣고 OpenAI가 답함 (`query.ask`)
- 승인 Wiki 전체에서 질문과 관련된 페이지 6개·페이지당 주장 4개를 선택합니다. 인용·출처·해시와 해당 주장의 fact를 함께 전달합니다.
- **영향평가 초안**: impact_set + 변경 명세 → 마크다운 초안만 (`impact.draft`). 양식·records는 만들지 않음

---

## 배포

```bash
pnpm corpus:scan
# Cloudflare 대시보드에서 D1 database_id 생성 후 apps/worker/wrangler.toml에 반영
pnpm --filter @iso-agent/worker exec wrangler d1 migrations apply iso-agent --remote
pnpm --filter @iso-agent/worker exec wrangler secret put OPENAI_API_KEY
pnpm deploy
```

커스텀 도메인 `iso-agent.superhot.company`는 Cloudflare 존에서 Worker 라우트로 연결합니다.

## Wirelog 엔진 컨테이너

[`apps/engine`](apps/engine)는 FastAPI + PyreWire 1.1.2 사이드카입니다.
승인된 triple을 `EasySession`에 넣고 실제 Datalog의 `snapshot` 결과로 추적·증거·누락·영향을 계산합니다.
관계의 전이는 `depends_on`에만 적용하며, 요구사항 충족·적합성을 추론하지 않습니다.
응답의 `engine`, `engine_version`, `rules_sha256`으로 실행 엔진과 규칙을 확인할 수 있습니다.
`packages/ontology/rules.dl`이 원본이며 `pnpm corpus:scan`이 사이드카와 공개 Assets 사본을 동기화합니다.

로컬에서 실제 Wirelog 엔진을 사용하려면 Python과 `uv`가 필요합니다. 두 터미널에서 실행합니다.

```bash
# 터미널 1: http://127.0.0.1:8081
pnpm engine:dev
# 터미널 2: http://127.0.0.1:8787
pnpm dev:wirelog
```

일반 `pnpm dev`는 기존 TypeScript 내장 엔진을 사용합니다.
Worker의 `ENGINE_URL`이 설정되면 `/api/graph/query`가 사이드카를 우선 호출하고, 실패하면 내장 엔진으로 폴백합니다.
사이드카 자체는 PyreWire 실패를 Python 계산으로 대체하지 않습니다.

```bash
cd apps/engine && docker build -t iso-agent-engine . && docker run -p 8080:8080 iso-agent-engine
```

검증: `pnpm wiki:check`, `pnpm test:wiki`, `pnpm test:ontology`, `pnpm test:wirelog`, `pnpm typecheck`.
`test:wirelog`에는 실행 Python 환경의 PyreWire 1.1.2 설치가 필요합니다.

## 라이선스

- 앱 코드: [MPL-2.0](LICENSE)
- 제3자: [NOTICE](NOTICE) (Wirelog LGPL 등)
- `.raw/` 규격 원문은 재배포하지 않습니다.

## 이슈

구현 추적: https://github.com/forcom/iso-agent/issues/1
