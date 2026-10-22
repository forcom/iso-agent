# 초기 지식 구축

기존 예시 시드·스키마·curation·ingest manifest는 폐기했다. 새 시드는 아직 구축하지 않았다.

후속 구현에서 전체 규정집(`docs/manual/`, `docs/procedure/`, `docs/guide/`, `docs/forms/`)의 명시적 manifest와 검토한 매핑을 `inputs/`에 작성하고, 반복 실행할 구축·검증·설치 도구를 `scripts/`에 둔다. 생성한 릴리스·검증 보고서는 `output/knowledge/`에 저장한다.

테스트 입력·기존 기록·가상 페르소나·개발 산출물을 규정 입력에 섞지 않는다. ERP 런타임에는 시드 파일 읽기·편집·import 기능을 제공하지 않는다. 확정된 설계와 구현 계획은 [Issue #2](https://github.com/forcom/iso-agent/issues/2)에서 관리한다.
