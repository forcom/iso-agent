# 실제 기록 인수시험 실행기

기준은 Issue #6 확정 r2와 Issue #13이다. 이 디렉토리의 일반 단위시험은 합성 자료만 사용한다. `run.ts --prepare`와 명시적 실행만 `docs/records/`의 74개 원본을 읽는다. 원본을 수정하지 않는다.

현재 구현 검증과 실제 인수를 구분한다. 단위시험 통과, 준비 파일 작성, P-7 API 실행 성공, 화면 표본 성공은 각각 별개다. 이 도구는 AT-01~20 전체 완료를 선언하지 않으며 초기화도 수행하지 않는다. 실제 74건 복제본 실행과 G-10 원격 회귀는 별도로 실행해 증거를 남겨야 한다.

## 준비

앱에서 이미 선택한 직원의 세션 쿠키를 `ACCEPTANCE_SESSION_COOKIE`에 제공한다. 선택 버전이 1이 아니면 `ACCEPTANCE_SESSION_VERSION`도 지정한다. 비밀값을 명령 기록·계획 파일·보고서에 넣지 않는다. 준비 단계는 기존 세션을 사용한 GET 요청만 한다.

저장소 루트에서 다음 명령을 실행한다.

```sh
pnpm --filter @iso-agent/test exec tsx acceptance/run.ts --prepare --target local --run-id r2-local-001 --plan output/test/acceptance/r2-local-001/local/inventory.json
```

경로 인수는 항상 저장소 루트 기준이다. 로컬 기본 주소는 `http://127.0.0.1:5173`이다. 다른 실제 로컬 ERP 포트는 `--base-url http://127.0.0.1:<port>`로 지정한다. 합성 E2E 서버 4173은 허용하지 않는다. 원격은 `--target remote`와 고정 데모 주소만 허용한다.

준비 파일은 원본 SHA-256·information_id·form_id·template_version, 현재 설치된 기록 유형·양식 버전·직원 ID와 P-6 행위자 후보를 담는다. `issues`의 대상 시스템, 필요한 검토자·승인자, 회람 수신자, 직무 분리, 조건 증거를 사람이 확인한다. 조건은 `confirmations`에 `field/value/personId/lineStart/lineEnd/quote/comment`를 기록한다. `quote`는 해당 원본 줄과 정확히 같아야 한다. 불명확한 값을 자동으로 채우지 않는다. 모든 `issues`가 해결되어야 실행할 수 있다.

P-6는 2026-10-24 사용자 개정에 따라 **한 사람의 최종 확인**, 전 행 승인, 모든 정책 차이의 판정이 필요하다. 기존 `humanAuthor` 또는 `humanReviewer` 중 하나에 이름·유효한 확인 시각·현재 기대값의 해시가 일치하는 확인이 있으면 충족한다. 별도 두 번째 검토자와 서로 다른 이름은 요구하지 않으며, 이전 작성 메모의 두 사람 확인 요구는 이 개정으로 대체한다. 각 행에는 거부 표본(`deniedSamples`)이 있어야 하며, 거부 대상이 있을 수 없는 행은 `noDeniedSampleReason`에 사유를 적는다. 빈 배열은 전원 허용을 뜻하지 않는다. 준비 보고서의 `differenceSummary`는 정책 차이를 오라클이 해당 측면을 정하지 않은 `unspecified`와 값이 어긋난 `mismatch`로 나눈다. 두 종류 모두 판정해야 실행할 수 있다. 원문·직원 입력·정책 파일 해시와 비교 결과를 실행 전에 다시 검증한다. AI가 작성한 현재 초안만으로는 실행할 수 없다. P-6 파일이 바뀌면 인벤토리를 다시 준비하고 검토한다.

역할 지정 후보와 근거는 ERP의 역할 지정 화면에서 모든 직원이 열람한다. 적용은 승인된 정확한 원본과 현재 `apply_assignment` 정책으로 판단한다. 확정 P-6의 대표이사 적용 권한에 관리자 자격을 추가 요구하지 않으며, 관리자라는 이유만으로 적용 권한을 부여하지 않는다.

실제 서비스의 건별 지정은 지식 번들과 분리된 `record-designations/<SHA-256>.json` 운영 자료로 적용한다. 해당 정책에 지정 제약을 선언하고 실제 역할과 함께 원본 ID·파일명·해시·시스템·담당자·행위를 모두 대조한다. 사용자 입력만으로 지정 권한이 생기지 않는다. 규정 개정 후보는 현재 지정 참조를 유지하며, 지정 원본의 손상이나 후보와 기준의 참조 불일치가 있으면 구축·시행을 거부한다. 업무 초기화는 이 운영 자료와 릴리스의 지정 참조만 제거하며 규정·직원·역할 근거는 보존한다.

건별 담당자가 필요한 행은 `recordCases`에 원본 ID·경로·SHA-256·시스템, 담당자 후보, 거부 표본과 정확한 근거 줄을 기록한다. 이 경우 양식 전체 후보는 집계용이고 실제 준비·행위자 검증에는 해당 원본의 후보만 사용한다. 다른 건, 변경된 원본 또는 다른 시스템에 전역 후보를 대신 적용하지 않는다. 원본의 과거 판단 이력은 인수시험 담당자를 선정하는 근거이며, 새 ERP의 승인 이벤트로 가져오지 않는다.

차이 판정의 `outcome=equivalent`는 의미상 동등, `expected_value_controls`는 원문·사용자 결정에 따른 기대값을 시험 기준으로 채택한다는 뜻이다. 후자는 구현 합격이나 수정 완료가 아니며 해당 동작이 기대값과 다르면 인수시험은 실패해야 한다. 준비 보고서의 `expectedValueControlsCount`와 개별 판정 사유에서 이를 확인한다. AI의 차이 대조 기록은 사람의 최종 확인을 대체하지 않는다.

로컬·원격 모두 실제 로컬 복제본의 P-3 초기화 예행 성공 보고서를 `prerequisites.resetRehearsalReport`의 `{path,sha256}`로 연결해야 첫 쓰기가 허용된다. 원격에는 아래 추가 선행 증거도 필요하다.

## 초기화·릴리스 복귀 유지보수

ERP 화면/API와 별개인 `apps/seed/scripts/reset-business.ts`를 사용한다. 실제 로컬 상태의 읽기 전용 복제로 예행하려면 다음을 실행한다. 원본은 SQLite나 Wrangler로 열지 않고 복사한 파일만 열며, 전후 원본 해시를 대조한다.

```sh
pnpm --filter @iso-agent/test exec tsx acceptance/maintenance-rehearsal.ts --run-id maintenance-local-001
```

복제본에서 업무 처리·규정 개정과 시행·시작 릴리스 복귀·업무 초기화·백업 복구·재실행을 확인하고 `output/test/acceptance/<run-id>/rehearsal/maintenance-report.json`에 결과를 남긴다. 보존할 근거 원문이 빠졌으면 중단한다. 복제본을 보정한 결과를 원본 환경의 성공 증거로 사용하면 안 된다.

계층 추적 검사에서는 검증된 `requires_record_type`의 적용 조건이 아직 미판정인 경우에만 해당 `CONDITION_UNKNOWN` 제외를 허용하고, 보고서의 `checks.unresolvedConditionalRelations`에 그대로 기록한다. 계층 관계 누락·미판정, 원문 근거 손상, 미검토 관계와 선언된 조건에 대응하지 않는 제외는 실패한다. 조건부 기록의 적용 여부를 자동 확정하지 않는다.

누락 색인의 원인을 진단하려면 새 `run-id`에 `--repair-clone-index`를 명시할 수 있다. 설치 번들에 담긴 색인 텍스트가 원본 SHA-256과 정확히 일치할 때만 복제본에 복원한다. 결과는 `passed-repaired-clone`과 `provenanceRepaired: true`로 기록하며 실제 환경의 실행 게이트를 열지 않는다. 원본 환경은 수정하지 않는다.

원격 격리 예행은 별도 사용자 확인 후 `--target staging --config output/test/staging/<설정 파일> --confirm-target <iso-test-g10-이름>`을 지정한다. 합성 원문만 있는 G-10 격리 자원에 한정하며 데모 구성으로 실행할 수 없다. 이 예행은 실제 원격 D1/R2를 쓰므로 일반 회귀시험에 포함하지 않는다.

실제 시험 시작 전에 `snapshot`으로 시작 기준을 저장한다. `--state-path`는 명시한 복제본 또는 정확한 `output/runtime/erp-state/v3`만 허용한다. 아래의 대문자 경로·해시는 명령 출력에서 확인한 값으로 바꾼다.

```sh
pnpm maintenance:business snapshot --environment local --run-id r2-local-001 --state-path output/test/acceptance/CLONE/state
pnpm maintenance:business plan --environment local --run-id r2-local-001 --state-path output/test/acceptance/CLONE/state --baseline output/test/acceptance/r2-local-001/local/backup/SNAPSHOT_HASH.json --operation reset-business
pnpm maintenance:business apply --environment local --run-id r2-local-001 --state-path output/test/acceptance/CLONE/state --baseline output/test/acceptance/r2-local-001/local/backup/SNAPSHOT_HASH.json --plan-file output/test/acceptance/r2-local-001/local/reset-business-plan.json --expected-hash PLAN_HASH
```

`--operation restore-release`는 시작 릴리스와 규정 포인터를 복귀시키고 변경 이력을 보존한다. `reset-business`는 시작 시 직원·역할과 그 근거를 보존하며 시험 중 역할 적용을 되돌린다. 두 작업 모두 계획에 결합된 환경·현재 상태·기준 해시가 달라지면 중단한다. 적용 직전 전체 D1 행/SQL과 R2 바이트 백업을 `backup/before-<planHash>.{json,sql}`에 저장한다. 삭제 계획을 검토한 뒤 적용하며, `pendingObjects`가 남으면 같은 계획으로 재실행한다. DB 커밋을 반복하거나 백업을 덮어쓰지 않는다.

삭제는 DB에서 용도를 확인한 업무 원문·재전송 응답 객체에 한정한다. 실패한 쓰기가 남긴 참조 없는 R2 객체나 용도가 불명확한 객체는 자동으로 삭제하지 않는다. 규정 변경 비교표와 그 원문 근거는 이력으로 보존한다.

실제 로컬 적용은 `--confirm-target <DB ID> --rehearsal-report <성공 보고서> --rehearsal-hash <파일 SHA-256>`가 추가로 필요하다. 원격은 `--environment demo`로 지정하고 위 인수시험 성공·사용자 확인과 함께 `--staging-report <격리 staging 성공 보고서> --staging-hash <SHA-256>`가 필요하다. 실행 전에 쓰기를 중지하고 원격 D1 bookmark/SQL export를 별도로 확보한다. 이 CLI는 bookmark/export나 격리 staging 배포를 대신하지 않는다.

`restore-backup --baseline <백업 JSON> --expected-hash <현재 stateHash>`는 복제본만 허용한다. 실제 환경의 전체 복구는 운영 복구 절차에 따라 처리하고 세션·재전송을 무효화해야 한다. 과거 세션을 그대로 되살리는 전체 복구는 허용하지 않는다.

## API 실행과 재시작

```sh
pnpm --filter @iso-agent/test exec tsx acceptance/run.ts --target local --run-id r2-local-001 --plan output/test/acceptance/r2-local-001/local/inventory.json
```

승인된 계획을 같은 `run-id`로 재실행하면 저장한 요청·결과를 재사용한다. 새 실행에서도 완료된 같은 원본·버전·유형·범위·승인 범위와 실제 회람자·수신자·수령·이해 확인 이력을 대조해 기존 회람을 재사용한다. 정책·역할이 바뀐 진행 중 기록은 새 검토 요청으로 다시 검토하며, 이전 결정은 보존한다. 응답 유실 때도 저장된 요청 본문 그대로 재전송한다. 자료 세대 충돌만 한 번 다시 조회하며, 권한·릴리스 변경과 기록 버전 변경, 요청 키 충돌은 중단한다. 변경된 계획은 기존 체크포인트와 함께 실행하지 못한다. `run.lock`이 남았으면 해당 프로세스가 종료됐는지 먼저 확인한 뒤 수동으로 처리한다.

공개 API로 업로드 → 근거 있는 조건 확인 → 검토 요청 → 필요한 검토·승인 → 회람 → 수신자 본인 수령·이해 확인을 수행한다. 원문의 `승인` 기재는 결정으로 가져오지 않는다. `AIDU-AIP-09-03-F01-2026-001`은 등록·조회만 한다. 같은 문서번호가 있으면 원본 해시·유형·양식·범위를 대조하며, 다르면 실패하고 새 버전 등록이나 원본 변경을 대신 수행하지 않는다.

명시적으로 제한 범위의 문서·계획 승인이 확정된 행은 `approvalScope: record`를 지정한다. 이 범위가 정의된 유형에만 검토 요청부터 같은 범위를 고정하며, 검토 도중 `outcome`으로 바꾸는 요청은 `409 APPROVAL_SCOPE_CONFLICT`로 거부되어야 한다. 결과는 `record-approved`로 구분하고 원문의 미완료 조건을 유지한 채 해당 승인본을 회람한다. 이는 실제 운영·리스크 수용·효과성 확인·종결 승인이 아니며, 별도 전수 권한 검사에서 기존 `outcome` 승인의 통제 미충족 거부를 검증한다. 불리언 값만 보고 자동으로 승인 범위를 바꾸지 않는다.

`approvalScope: record`를 지정하지 않았고 원문 근거로 `requiredControlsVerified: false`가 확인된 기록은 검토 후 승인 요청이 `403 ACTION_DENIED`로 거부되는지 확인한다. 검토 전 권한 오류·다른 오류·예상 밖 승인 성공은 실패다. 기대한 거부를 확인하면 `expectedOutcome: approval-denied`로 기록하고 승인·회람을 진행하지 않는다. 재실행에서는 확인한 거부 응답도 재사용한다. 이 검증의 성공은 문서 승인이나 업무 종결이 아니다. 해당 행이 있는 실행 보고서는 `blocked`와 종료 코드 1을 반환하므로 전체 승인 흐름이나 인수시험의 통과 증거로 사용할 수 없다. 원문의 계획·조건부·제한 범위 승인과 무제한 업무 승인 가능 여부를 별도로 검토해야 한다.

`output/test/acceptance/<run-id>/<target>/`에 다음을 저장한다.

- `checkpoint.json`: 정확한 재전송 본문과 완료 응답. 쿠키·비밀값 제외.
- `records.json`: 74행의 r2 기록별 실행표. 아직 실행하지 않은 행은 `unexecuted`, ID·앱 상태는 `null`로 명시.
- `results.jsonl`: 요청별 HTTP 상태·소요 시간·환경 context·ID·오류·확인 결과.
- `run-report.json`: P-7 API 실행 결과. 전체 인수 보고서가 아님.

원격은 첫 POST 전에 터미널에서 `RUN <run-id> <고정 데모 URL>`을 직접 입력해야 한다. 환경변수나 자동 yes 옵션은 없다. 다음 실제 증거를 `prerequisites`에 `{path, sha256}`로 연결한다.

- `localAcceptanceReport`: `{kind:'erp-records-acceptance', target:'local', status:'passed', releaseId, inputSha256, scenarios:{'AT-01':'passed', ... 'AT-18':'passed'}}`. AT-17을 포함해 18개 항목이 모두 통과해야 한다. `inputSha256`은 문서번호·원본 해시 쌍을 정렬한 배열의 결정적 JSON SHA-256이다. P-7 보고서로 대체할 수 없다.
- `resetRehearsalReport`: P-3의 `maintenance-report.json`. `sourceReadOnly`, `originalUnchanged`, `backupRestored`, `idempotent`가 모두 참이어야 한다.
- `remoteBackupReport`: P-3의 원격 `backup-report.json`. 실제 백업의 경로·해시·상태 해시가 있어야 한다.

## 화면 표본

```sh
pnpm --filter @iso-agent/test exec tsx acceptance/run.ts --target local --run-id r2-local-001 --plan output/test/acceptance/r2-local-001/local/inventory.json --screens --sample-code <문서번호>
```

업무 승인 필요 유형의 대표 한 건을 명시한다. 계획에 원문 근거로 확정한 조건이 있으면 지정 확인자가 화면에서 먼저 확인한다. 같은 사전 검증과 원격 확인을 거친 뒤 별도 Playwright 설정을 실행한다. 합성 서버를 시작하지 않으며 지정 ERP에 접속한다. 1440×900, 1920×1080, 1280×800, 1024×768, 390×844에서 업로드·조건 확인·검토·승인·회람·본인 확인·검색·원문 흐름을 확인한다. V2는 원본 출처를 붙인 시험 문장을 추가하며 파생 파일과 해시를 `screens/`에 보존한다.

대량 API 실행 후 화면 표본을 실행할 수 있다. 이미 있는 문서는 새 버전 업로드로 확인하며 결과에 `new-revision`으로 기록한다. 마지막에는 원본 내용을 새 버전으로 등록·검토·승인한다. 중간 실패 시 파생 V2가 작업본 또는 유효본으로 남을 수 있으므로 `sample-report.json`의 마지막 ID·상태를 확인한다. 이전 결정·회람·파생 버전은 삭제하지 않는다. 화면 흐름으로 작업 버전이 바뀌므로 기존 대량 실행 체크포인트의 재실행은 버전 충돌로 중단될 수 있다.

화면 표본은 AT-04·12·13·16의 대표 정상 흐름 증거다. 오래된 결정·비수신자·대리 확인 등 전체 부정 시험과 전체 AT 판정은 별도 인수 증거가 필요하다. trace/video는 쿠키가 들어갈 수 있어 저장하지 않는다. 출력은 `screens/`의 스크린샷·JSONL·보고서다.

## 합성 검증

```sh
pnpm --filter @iso-agent/test test acceptance
```

원본·운영 입력을 읽지 않고 HTTP 공통 모듈, 대상/원본 검증, 준비의 GET 전용 동작, 공개 업무 흐름, 응답 유실 재전송, 충돌 재시도, 실패 중단과 원격 선행 증거 검사를 검증한다. G-10은 기존 staging 검증과 토큰 처리를 그대로 유지하며 `client.ts`의 HTTP·마스킹·직렬화·보고서 저장만 공유한다.
