# 실제 플랫폼 G-10 검증

입력은 `apps/test/support/fixtures.ts`의 합성 자료만 사용한다. 운영 자료·준비 파일·`.dev.vars`를 테스트 실행기의 입력으로 넘기지 않는다. 출력과 생성 설정은 `output/test/staging/`에 둔다.

1. 별도 Worker·D1 이름을 `iso-test-g10-<run>`으로, R2 이름을 `<Worker 이름>-sources`로 생성한다. 운영 자원을 재사용하지 않는다.
2. `output/test/staging/wrangler.json`에 해당 계정과 새 D1 ID, `remote: true`인 `DB`·`SOURCES` 바인딩, `vars.APP_NAME`에 Worker 이름을 지정한다. entrypoint는 이 디렉토리의 `worker.ts`, Durable Object·Container 클래스는 `G10Engine`, 이미지는 `apps/engine/Dockerfile`이다. 호환 플래그는 제품과 같은 `nodejs_compat`을 사용한다.
3. `pnpm --filter @iso-agent/worker exec tsx ../../apps/test/staging/install.ts`로 빈 D1·R2에 합성 릴리스를 설치한다. 실행기는 Cloudflare에서 조회한 D1의 실제 이름과 ID를 대조하며, 운영 이름·preview 바인딩·다른 Worker의 Durable Object를 거부한다. 기존 설치는 덮어쓰지 않는다.
4. 이 설정으로 Wrangler를 배포한다. 배포 단계에서 전용 임의 `G10_TOKEN`과 OpenAI 연결 자격을 Worker secret으로 설정한다. 토큰의 로컬 사본은 `output/test/staging/.g10-token`에 권한 0600으로 보관하며 Git에 추가하지 않는다. 테스트 실행기는 OpenAI 키를 읽거나 보고서에 저장하지 않는다.
5. `pnpm --filter @iso-agent/worker exec tsx ../../apps/test/acceptance/g10.ts`로 원격 검증을 실행한다. 보고서는 `output/test/staging/g10-report.json`이다.

시험 Worker는 토큰이 없는 모든 요청을 거부한다. 시험 전용 엔진 제어는 실제 Container에 SIGKILL을 보내며, 장애 관찰 중에만 자동 재시작을 막고 정지한 TCP 포트에 접근한다. 제품 엔진이나 API에 시험 제어 경로를 추가하지 않는다. 검증 종료 시 엔진을 복구한다.

같은 staging을 다시 검증하면 이전 합성 이력은 보존되고 새 기록이 추가된다. 깨끗한 반복 시험은 새 자원 이름과 ID로 수행한다. 대용량·동시 사용자 부하 시험은 이 연결 검증에 포함하지 않는다.
