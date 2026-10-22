# iso-agent

[Issue #2](https://github.com/forcom/iso-agent/issues/2)의 ISO/IEC 42001 ERP 구현이다. React 화면, Markdown 원본·버전 관리, 규정별 검토·승인, 회람 확인, 규정 개정·지식 재구축, 그래프·위키·Q&A·영향평가를 제공한다. 권한과 관계 계산은 실제 PyreWire를 사용한다.

배포 대상은 사용자 요청에 따른 `iso-agent-demo`다. 가상 직원 15명이 사용하는 데모이며 실제 본인 인증·전자서명·운영 인사발령을 제공하지 않는다. 로컬 및 원격 검증 결과는 각각 기록하며, 로컬 통과만으로 원격 통합 수용 게이트 G-10의 완료를 주장하지 않는다.

## 실행

Node 20 이상, pnpm, PyreWire 1.1.2를 설치할 수 있는 Python이 필요하다.

```sh
pnpm install --frozen-lockfile
pnpm engine:setup
pnpm knowledge:build
pnpm knowledge:check
pnpm knowledge:install --environment local --bundle output/knowledge/<release-id>/bundle.json
```

`knowledge:build`가 출력한 릴리스 ID를 사용한다. 초기 설치는 비어 있는 로컬 DB에만 허용한다. 이미 설치한 환경에서는 다시 설치하지 않는다. 전체 87개 규정 원문과 60개 기록 유형을 구축하며 `docs/records/`와 페르소나는 입력으로 사용하지 않는다. 상세 입력·직원 지정 계약은 [초기 지식 구축 안내](apps/seed/README.md)를 따른다.

별도 터미널 두 개에서 실행한다.

```sh
pnpm dev:engine
pnpm dev
```

앱은 `http://127.0.0.1:5173/`, 실제 PyreWire는 `127.0.0.1:8788`에서 실행한다. 포트가 사용 중이면 `pnpm --filter @iso-agent/worker dev --port 5174`로 앱 포트를 바꿀 수 있다. 로컬 앱은 `wrangler.local.toml`과 `output/runtime/erp-state/v3`의 D1/R2를 사용한다. 엔진이 중단되면 필요한 권한·관계 계산을 503으로 중단한다.

실제 직원·기능 역할·최초 관리자 지정 근거가 없으면 직원 목록은 빈 상태다. 사용자가 요청한 에이아이듀 가상 조직은 초기 지식 설치 후 `pnpm personnel:install --environment local`로 별도 적용한다. [직원·역할 구성표](docs/aidu-erp-personnel.md)에 따라 15명·20개 역할·역할 지정 44건을 추가하며, 문서관리 담당자 홍길순에게만 관리자 자격을 부여한다. 기존 직원·역할이 있으면 덮어쓰지 않고, 같은 설정을 다시 실행하면 중복 생성하지 않는다.

가상 직원은 명시적으로 허용한 로컬·원격 데모 설정에서 활성화되며 화면에도 가상 구성임을 표시한다. 이 설정은 실제 인사발령·회사 승인 증거를 만들지 않는다. 직원 선택은 데모 신원 선택이며 본인 인증·전자서명이 아니다. 각 직원은 자신의 역할과 범위에 해당하는 동작을 수행하고, 관리자 자격은 규정의 검토·승인권을 대신하지 않는다.

OpenAI 호출은 서버의 `OPENAI_API_KEY`와 `LLM_MODEL`을 사용한다. 키가 없거나 호출이 실패하면 계산 결과·근거를 보존한 오류를 표시한다. 기존 `apps/worker/.dev.vars`는 보존하고 공개하지 않는다.

## 검증과 빌드

```sh
python3 -m venv output/test/engine/venv
output/test/engine/venv/bin/pip --cache-dir output/test/pip-cache install -r apps/engine/requirements.txt
PLAYWRIGHT_BROWSERS_PATH="$PWD/output/test/browsers" pnpm --filter @iso-agent/test exec playwright install chromium
pnpm typecheck
pnpm test
pnpm test:engine
pnpm test:e2e
pnpm build
```

테스트는 `apps/test/`의 합성 규정·직원·양식만 사용하고 DB/R2·캐시·브라우저·보고서를 `output/test/`에 둔다. API 시험과 브라우저 시험 모두 실제 PyreWire를 호출한다. OpenAI는 시험 내부 stub으로 격리한다. 브라우저 시험은 다섯 화면 크기에서 업로드→검토→승인→회람, 규정 재구축→시행, 직원 전환과 포커스를 검사한다.

빌드는 `output/build/worker/`에 생성된다. 빌드에 임시 복사된 `.dev.vars`는 빌드 명령이 제거한다. 배포 번들·로그·로컬 비밀 파일은 공개 산출물로 취급하지 않는다.

## 원격 데모 배포

`apps/worker/wrangler.toml`은 전용 Worker `iso-agent-demo`, D1 `iso-agent-demo`, R2 `iso-agent-demo-sources`, PyreWire Container를 연결한다. 로컬 DB 및 기존 다른 서비스의 자원과 분리한다. 직원 드롭다운은 인증 수단이 아니므로 데모에 실제 개인정보·업무 기록을 등록하지 않는다.

Cloudflare 로그인과 실행 중인 Docker 호환 엔진이 필요하다. Podman을 사용하면 저장소 최상위에서 `export WRANGLER_DOCKER_BIN="$PWD/apps/engine/podman-docker.mjs"`로 지정한다. 이 어댑터는 Podman에서 지원하지 않는 Docker 전용 빌드 옵션만 제거한다. 최초 설치는 신규 빈 데모 DB에만 실행한다.

```sh
pnpm knowledge:check
pnpm knowledge:install --environment demo --bundle output/knowledge/<release-id>/bundle.json
pnpm personnel:install --environment demo
pnpm deploy:demo
```

원격 직원 설치는 사용자의 2026-10-23 추가 요청에 따라 기존 [가상 역할 구성표](docs/aidu-erp-personnel.md)의 동일한 구성을 재사용한다. 원문 3개와 가상 지정 근거를 보존하고, 로컬 업로드 기록·승인·회람 이력은 복사하지 않는다. 이후 코드 배포는 `pnpm deploy:demo`만 실행하며 초기 지식을 재설치하지 않는다. OpenAI 키는 Worker의 비밀 설정 `OPENAI_API_KEY`로 별도 등록한다.

배포 후 Worker 응답, 직원 목록·역할, 원문 조회, 실제 Container 권한·관계 계산을 확인한다. 합성 staging의 실제 OpenAI까지 포함하는 G-10과 데모 원격 점검 결과는 구분한다.

## 자료와 변경 이력

원본 바이트, 해시, 문서 버전, 결정과 회람 대상은 각각 보존한다. 새 작업본이 생겨도 기존 시행본이 즉시 교체되지 않는다. 규정 변경은 전체 후보 구축과 지식 검증, 기존 권한에 따른 검토·승인을 거쳐 시행 포인터를 한 번에 바꾼다. 철회된 자료도 원본과 이력을 보존한다. 실패한 업로드의 미등록 R2 객체는 자동 삭제하지 않으며 DB에 등록된 기록으로 취급하지 않는다.

모든 임직원 공통 열람과 규정상 제한등급 조항의 차이는 Issue #2의 제품 결정으로 표시한다. 앱의 열람 허용이 해당 규정 원문을 수정한 것은 아니다. Edu Score는 평가 대상으로만 선언되어 있으며 실제 운영 범위·구성·의존성은 미확정이다.

```text
apps/worker/      # Hono API, React UI, migration, Workers 설정
apps/engine/      # 실제 PyreWire 서버와 Container 이미지 정의
apps/packages/   # 계약, 지식 컴파일러, 온톨로지, LLM, 위키
apps/seed/       # 전체 규정 manifest, 검토 매핑, 반복 구축·설치 CLI
apps/test/       # 합성 시험 소스와 설정
docs/           # 규정, 회사 자료, 실제 기록
output/         # 구축·빌드·검증 결과, 로컬 상태, 설계·검토 산출물
```

기존 `.raw/`, `.dev.vars`, `output/runtime/legacy-worker/`와 `output/runtime/worker/`의 데이터는 보존한다. 폐기된 bootstrap·시드 import·폴더 스캔 API를 제공하지 않는다. 확정 설계·계획은 Issue #2에서, 저장소 규칙은 [AGENTS.md](AGENTS.md)에서 관리한다.

라이선스는 [MPL-2.0](LICENSE)이며 관련 고지는 [NOTICE](NOTICE)를 참조한다.
