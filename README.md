# iso-agent

ISO/IEC 42001 문서·기록을 기반으로 하는 ERP를 재설계하는 저장소다. 현재는 구현 전 정리 단계이며, 기존 시드·관계 엔진·UI·업무 API를 제거했다. 새 ERP와 초기 지식은 아직 구현하지 않았다.

## 디렉토리

```text
apps/
  worker/       # Hono 실행 기반; 현재 /api/health만 제공
  packages/     # 재사용 가능한 LLM·위키 모듈
  seed/         # 전체 규정 기반 초기 지식 구축용 소스 위치
docs/
  manual/       # 매뉴얼
  procedure/    # 절차서
  guide/        # 지침서
  forms/        # 빈 양식
  records/      # 기존 기록 74건과 목차
output/
  superpowers/  # 로컬 설계·계획; Git 추적 제외
  erp-ui-concepts/ # 로컬 A/B/C 배치 참고; Git 추적 제외
  runtime/      # 로컬 실행 상태; Git 추적 제외
```

개발 계획·보고서·일회성 스크립트·빌드·검증 산출물은 모두 `output/`에 둔다. 테스트 소스·합성 입력·설정은 향후 `apps/test/`, 실행 결과·캐시·임시 상태는 `output/test/`에 둔다. 반복 사용하는 제품·구축 코드는 `apps/`에 둔다. `.raw/` 원자료와 비밀 설정, 의존성·Git 관리 디렉토리는 별도로 유지한다.

Superpowers 설계·계획은 `output/superpowers/`에서 작업하며 커밋하지 않는다. 확정본은 [ERP 신규 구축 Issue #2](https://github.com/forcom/iso-agent/issues/2)에 등록했으며, 후속 개정은 이 Issue에서 이전 확정본을 대체한다는 사실과 변경 내용을 명시한다. 구체적인 작업 규칙은 [AGENTS.md](AGENTS.md)를 따른다.

[재설계 화면별 그래픽 시안 19개](https://github.com/forcom/iso-agent/issues/2#issuecomment-6347700335)는 Issue #2 첨부파일로 보관한다. 모바일 시안은 제외했다.

## 현재 가능한 검증

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm dev
```

`GET /api/health`는 Worker 실행 여부만 확인한다. ERP 화면·시드 import·기록 스캔·온톨로지 질의는 제공하지 않는다. 배포 명령과 이전 DB migration은 제거했으며 Workers·Containers 배포는 별도 구현 단계다.

기존 로컬 Wrangler 데이터는 `output/runtime/legacy-worker/`에 보관했다. 새 개발 실행 상태는 `output/runtime/worker/`를 사용한다. `.dev.vars`의 키와 `.raw/` 원문은 커밋하지 않는다. 기존 기록의 인명·결정 기재를 실제 직원 인증·새 시스템의 승인 이벤트로 자동 전환하지 않는다.

라이선스는 [MPL-2.0](LICENSE)이며 관련 고지는 [NOTICE](NOTICE)를 참조한다.
