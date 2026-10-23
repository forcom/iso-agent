# 초기 지식 구축

`inputs/regulations.manifest.json`은 규정집 87개 Markdown의 원본 해시와 문서·버전 식별자를 지정한다. `inputs/reviewed-mappings.json`은 전체 원문의 조항 처리, 기능상 역할, 60개 빈 양식의 기록 유형과 작성·수정·검토·승인·회람 권한을 정확한 원문 인용에 연결한다. 목차 3개는 탐색 입력으로만 포함한다.

온톨로지 2.1.0은 `Regulation` 안에서 매뉴얼(1: 준수 요구사항), 절차서(2: 수행 절차), 지침서(3: 세부 수행 방법)를 구별한다. 문서와 버전 개체의 `regulationType`·`hierarchyLevel`에 이를 기록하며 양식·기록에는 규정 계층을 부여하지 않는다.

`subordinate_to`는 하위 버전 → 직상위 버전의 관계다. 현재 원문 대조 결과는 절차서 → 매뉴얼 18개, 지침서 → 절차서 20개이며, 각 관계에 문서체계·목차의 정확한 인용을 보존한다. 여러 부모를 허용하며 `trace`와 `neighbors`에서 경로를 조회한다. 단순 참조, 변경 의존성, 권한·승인 또는 수행 증거로 자동 확장하지 않는다. 연결 버전이 개정되면 관계를 후보로 되돌리고 관리자 지식 검증에서 다시 확정한다. 목차는 연결 근거로 인용할 수 있으나 규정 개체나 권한 근거로 자동 생성하지 않는다. 목차 인용은 저장된 원본 해시를 검증한 후 읽기 전용 원문 화면에서 열며, 원본 부재·변조 시 관계를 조회 근거에서 제외한다.

기존 설치 릴리스는 자동 변경되지 않는다. 아래 구축·검증은 새 번들을 생성하며 서비스 반영에는 해당 버전의 앱·엔진과 별도 릴리스 설치가 필요하다.

저장소 최상위에서 실행한다.

```sh
pnpm knowledge:build
pnpm knowledge:check
pnpm knowledge:install --environment local --bundle output/knowledge/<release-id>/bundle.json
```

구축 결과는 `output/knowledge/<release-id>/`의 `bundle.json`, `manifest.json`, `coverage.json`, `permissions.json`, `validation.json`에 저장된다. `current-release.json`은 마지막 구축 결과를 가리킨다. 검증은 bundle 전체 해시·현재 원문·매핑·규칙·스키마·인용·유형·권한 누락을 확인하며 원문과 매핑이 어긋나면 실패한다. 입력 내용이 같으면 동일한 릴리스가 생성된다.

초기 설치는 명시적으로 지정한 새 로컬 D1/R2(`output/runtime/erp-state`) 또는 전용 원격 데모에만 허용한다. 원격 설치는 `--environment demo`로 지정하며 `apps/worker/wrangler.toml`의 데모 자원 이름·실제 D1 ID·원격 바인딩·가상 직원 허용 설정을 확인한다. 기존 context·자료·직원·역할 지정·릴리스가 있으면 덮어쓰지 않는다. 설치는 실제 원본과 검증된 지식, 재구축용 규칙·스키마를 저장한다. 원문 등록은 회사의 검토·승인 또는 업무 수행 사실을 생성하지 않는다.

실제 직원·운영자 지정·승인된 역할 지정 자료가 있다면 `output/runtime/deploy/` 아래의 비공개 JSON을 `--preparation`으로 지정할 수 있다. 구조는 `DeploymentPreparation` 계약을 따른다. 직원의 실제 식별·확인 근거, 운영자 지정 근거, 지정 원문의 SHA-256과 정확한 인용·승인 근거·기간·범위가 필요하다. 자료가 없으면 사람이나 역할을 추정하지 않고 모든 역할을 미지정 상태로 설치한다. 실행 결과는 `output/runtime/installation-report.json`에 남긴다.

사용자가 별도로 요청한 가상 에이아이듀 직원·역할 구성은 초기 지식 설치 후 다음 명령으로 적용한다.

```sh
pnpm personnel:install --environment local
```

`inputs/aidu-personnel.json`과 `docs/aidu-company-profile.md`, `docs/aidu-personas.md`, `docs/aidu-erp-personnel.md`를 명시적으로 사용한다. 규정 지식 릴리스를 변경하지 않고, 원문 3개와 가상 구성원 15명·역할 지정 44건을 로컬 D1/R2에 추가한다. 기존 직원·역할이 있으면 덮어쓰지 않는다. 동일한 설정을 재실행하면 기존 적용 결과를 반환하고, 같은 설정 ID의 내용이 달라지면 거부한다. 결과는 `output/runtime/personnel-report.json`에 남긴다.

명시적으로 허용한 원격 데모에는 `pnpm personnel:install --environment demo`를 사용한다. 로컬·데모 모두 `ALLOW_FICTIONAL_PERSONNEL=true`가 필요하다. 원본의 정확한 인용과 해시를 지정 근거로 보존하지만 실제 승인·회람 이력을 생성하지 않는다. 설정 원문은 미승인 자료로 보존하여 기본 Q&A 근거에서 제외한다. 최초 운영자는 홍길순 한 명이며 규정별 검토·승인권을 대신하지 않는다. ERP에는 이 설치 명령을 실행하는 API나 화면을 제공하지 않는다.

검토 매핑의 `validated`는 구현 입력을 대조했다는 뜻이며 회사의 공식 승인·법적 현행성 검증·개별 기록의 적합성을 뜻하지 않는다. Edu Score 엔터티도 Issue #2에서 지정한 평가 대상이다. 실제 운영 범위·구성·의존성은 미확정 상태를 유지한다. 빈 양식은 실제 기록이나 이행 증거를 만들지 않는다.

관리자 규정 개정도 `apps/packages/knowledge`의 같은 메모리 입력 컴파일러·검증기를 사용한다. 변경된 인용은 정확히 하나의 위치로 재연결할 수 있을 때만 후보로 보존하며 누락·중복·새 문서는 명시적 검토가 필요하다. 운영 화면에서 초기 입력 파일을 직접 읽거나 편집하지 않는다.

테스트 입력·기존 기록·가상 페르소나·개발 산출물을 규정 입력에 섞지 않는다. ERP 런타임에는 시드 파일 읽기·편집·import 기능을 제공하지 않는다. 확정된 설계와 구현 계획은 [Issue #2](https://github.com/forcom/iso-agent/issues/2)에서 관리한다.
