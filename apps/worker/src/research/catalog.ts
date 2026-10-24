// Product research guidance from Issue #14; these are proposals, never evidence of performed work.
export const researchInstructions = [
  {
    "id": "environment",
    "label": "외부 환경·기술·사회"
  },
  {
    "id": "legal",
    "label": "법령·공식 요구"
  },
  {
    "id": "supplier",
    "label": "공급자·모델·데이터"
  },
  {
    "id": "risk",
    "label": "사고·리스크·대안"
  },
  {
    "id": "impact",
    "label": "영향·윤리·이해관계자"
  },
  {
    "id": "measurement",
    "label": "목표·측정·시험"
  },
  {
    "id": "resources",
    "label": "자원·조달·대체"
  },
  {
    "id": "training",
    "label": "역량·교육·인식"
  },
  {
    "id": "documents",
    "label": "문서·보유·의사소통"
  },
  {
    "id": "operations",
    "label": "운영·권리구제·종료"
  },
  {
    "id": "audit",
    "label": "심사·준수·경영검토"
  },
  {
    "id": "improvement",
    "label": "방침·개선"
  }
] as const;

export const researchCatalog = [
  {
    "code": "AIDU-AIP-04-01-F01",
    "classification": "A",
    "research": "기술·사고·시장·경쟁·사회·기후·공급망 변화 조사, 사실/가정·출처·확인일 정리, 영향·조치 후보 작성",
    "internalInputs": "실제 사업·시스템·의존성·노출, 중요성·조치 책임·기한 결정",
    "sourcesAndTriggers": "L/T/V/R; 정기 감시·중대 변경·연간 검토"
  },
  {
    "code": "AIDU-AIP-04-01-F02",
    "classification": "A",
    "research": "규제·공급자·공개 고객 요구, 관할·의무 유형·기산점·통지 요건 조사 및 변경 대비",
    "internalInputs": "실제 고객·계약·피영향자, 적용 여부·충족 증거·책임 지정",
    "sourcesAndTriggers": "L/V/R; 요구 변경·신규 서비스·작성 시"
  },
  {
    "code": "AIDU-AIP-04-01-F03",
    "classification": "B",
    "research": "관할·서비스 역할·외부 인터페이스 제약 조사, 기존 범위 변경 필요성 설명",
    "internalInputs": "실제 활동·조직·장소·통제 경계, 포함·제외와 범위 승인",
    "sourcesAndTriggers": "L/V; 사업·국가·서비스 변경"
  },
  {
    "code": "AIDU-AIP-04-01-F04",
    "classification": "B",
    "research": "외부 위탁 인터페이스·공급자 책임·법정 입력/출력 변경 조사",
    "internalInputs": "실제 프로세스·책임자·인계·성과 측정, 회사 내부 연결",
    "sourcesAndTriggers": "L/V; 위탁·연동·의무 변경"
  },
  {
    "code": "AIDU-AIP-04-01-F05",
    "classification": "A",
    "research": "공식 법령의 판본·시행일·경과조치·적용 조건, 분류별 대조표·확인 질의·제출자료 목록 초안",
    "internalInputs": "실제 목적·고객 사용·개발/제공 행위·모델 정보, 최종 법적 판정·공식 질의 제출/회신",
    "sourcesAndTriggers": "L/V; 도입·용도·관할·법령 변경"
  },
  {
    "code": "AIDU-AIP-05-01-F01",
    "classification": "B",
    "research": "책임 있는 AI 원칙·분야별 기대·적용 요구 조사, 방침 문구와 근거 제안",
    "internalInputs": "회사 목적·경영진 약속·다른 방침, 방침 채택·발행",
    "sourcesAndTriggers": "L/S/R; 최초 작성·중대 변경"
  },
  {
    "code": "AIDU-AIP-05-01-F02",
    "classification": "B",
    "research": "법령·사회적 기대·주요 위험 변화와 현행 방침의 차이 조사",
    "internalInputs": "현행 방침·실적·이해관계자 의견, 유지/개정 판단",
    "sourcesAndTriggers": "L/T/R; 연간 검토·중대 변화"
  },
  {
    "code": "AIDU-AIP-05-01-F03",
    "classification": "B",
    "research": "관련 외부 동향·자원 대안·위험 근거를 보고 안건에 요약",
    "internalInputs": "내부 성과·사건·자원, 실제 경영진 지시·결정·이행",
    "sourcesAndTriggers": "L/T/V/R; 보고 준비·주요 사건"
  },
  {
    "code": "AIDU-AIP-05-02-F01",
    "classification": "B",
    "research": "법정 역할·요구 역량·감독 권한 기준 조사",
    "internalInputs": "실제 직원·역량·업무량·지정/해제·수령, 권한 부여",
    "sourcesAndTriggers": "L/S; 법정 역할 변경·지정 준비"
  },
  {
    "code": "AIDU-AIP-05-02-F02",
    "classification": "B",
    "research": "외부 검토 요건·회사/공급자/고객 책임 경계 조사, 직무 분리 검토항목 제안",
    "internalInputs": "실제 관여·겸임·이해충돌·배정·독립성 판단",
    "sourcesAndTriggers": "L/V/S; 조직·책무·공급 관계 변경"
  },
  {
    "code": "AIDU-AIP-05-02-F03",
    "classification": "B",
    "research": "법정 의무·공급자 변경 조사를 인계 항목에 연결하고, 지정된 공개 감독자·연락처 페이지의 갱신 여부·잔존 구버전을 관찰",
    "internalInputs": "실제 인계·인수·키 회수·권한 변경·지정 효력. 공개 페이지 관찰은 게시 상태만 증명",
    "sourcesAndTriggers": "L/V/P; 인사·담당 변경"
  },
  {
    "code": "AIDU-AIP-05-02-F04",
    "classification": "B",
    "research": "접수된 우려의 유사 사례·보호 원칙·처리 기준·대안 조사",
    "internalInputs": "실제 제보·접수시각·보호·회신·종결. 뉴스만으로 회사 제보를 생성하지 않음",
    "sourcesAndTriggers": "L/T/R; 실제 접수 후 조사"
  },
  {
    "code": "AIDU-AIP-06-01-F01",
    "classification": "A",
    "research": "사고·연구·공급자 변경에서 원인→사건→결과 시나리오와 개선 기회 식별",
    "internalInputs": "실제 시스템·자산·노출·기존 통제, 회사 발생 사실",
    "sourcesAndTriggers": "T/V/R/L; 감시 결과·평가 개시"
  },
  {
    "code": "AIDU-AIP-06-01-F02",
    "classification": "B",
    "research": "발생 조건·피해·불확실성·반대 근거 조사, 승인 기준에 따른 평가 의견 초안",
    "internalInputs": "실제 노출·빈도·통제 효과·승인 평가 기준. 기사 수로 발생확률·점수 확정 금지",
    "sourcesAndTriggers": "T/R/L; 관련 위험 신규·변경"
  },
  {
    "code": "AIDU-AIP-06-01-F03",
    "classification": "A",
    "research": "완화 기술·수동/비AI 대안·비용·효과 연구·검증 방법 비교",
    "internalInputs": "가용 자원·실현 가능성·담당·예산·실행 승인",
    "sourcesAndTriggers": "T/V/R; 처리안 작성·대안 재검토"
  },
  {
    "code": "AIDU-AIP-06-01-F04",
    "classification": "B",
    "research": "새 요구·위협에 대응하는 관리 후보와 포함/제외 검토 근거 조사",
    "internalInputs": "확정 리스크·회사 수행 범위·구현 증거, SoA 적용/제외·구현 상태",
    "sourcesAndTriggers": "L/S/T; 요구·리스크·통제 변경"
  },
  {
    "code": "AIDU-AIP-06-01-F05",
    "classification": "B",
    "research": "통제의 새로운 우회·한계·지원 종료 조사, 기존 수용의 재검토 계기 제안",
    "internalInputs": "실제 시험·통제 효과·잔여 위험·경영진 수용·조건·만료",
    "sourcesAndTriggers": "T/V/R; 수용 재검토·새로운 반증"
  },
  {
    "code": "AIDU-AIP-06-01-F06",
    "classification": "A",
    "research": "분야별 위험 평가 방법·통계·비AI 기준선·이해관계자 범주 조사",
    "internalInputs": "실제 사용 맥락·노출 단위·평가자·자원, 기준과 협의 계획 승인",
    "sourcesAndTriggers": "R/L/S; 신규 도메인·별도 기준 필요 시"
  },
  {
    "code": "AIDU-AIP-06-02-F01",
    "classification": "B",
    "research": "분야·피영향자·취약성·법적 기준·평가 방법·공급자 명세 조사",
    "internalInputs": "실제 목적·작동원리·이용 빈도·인간 개입·고객 사용, 범위와 계획 승인",
    "sourcesAndTriggers": "L/V/R; 신규·변경·재평가"
  },
  {
    "code": "AIDU-AIP-06-02-F02",
    "classification": "A",
    "research": "유사 사례·원 논문·권리/사회/환경 영향·취약 집단·대안·반대 근거 조사, 인과 시나리오 초안",
    "internalInputs": "실제 기능·피영향자·운영/시험·현행 통제 효과, 영향 수준·잔여 영향 확정",
    "sourcesAndTriggers": "R/L/T; 평가 개시·새 연구·사건"
  },
  {
    "code": "AIDU-AIP-06-02-F03",
    "classification": "B",
    "research": "제공 의무·수신자별 설명·접근성·재통지 조건 조사, 제공용 요약 초안",
    "internalInputs": "승인 영향평가·실제 수신자·전달·후속 문의·반영 확인",
    "sourcesAndTriggers": "L/S; 평가 갱신·의무 변경"
  },
  {
    "code": "AIDU-AIP-06-02-F04",
    "classification": "A",
    "research": "윤리 쟁점·가치 충돌·비AI 대안·피영향자 관련 연구와 협의 질문 조사",
    "internalInputs": "실제 협의·대표성·참여/미참여·이견·선택 결정. 공개 연구는 실제 의견으로 표기하지 않음",
    "sourcesAndTriggers": "R/L/S; 중대한 쟁점·별도 협의 필요 시"
  },
  {
    "code": "AIDU-AIP-06-03-F01",
    "classification": "B",
    "research": "비교 가능한 외부 지표·측정 방법·분야 목표 사례 조사",
    "internalInputs": "회사 기준선·사업 목표·자원·목표값 결정. 외부 평균을 회사 실적으로 사용하지 않음",
    "sourcesAndTriggers": "R/S/V; 연간 계획·목표 변경"
  },
  {
    "code": "AIDU-AIP-06-03-F02",
    "classification": "B",
    "research": "일정 제약·법령 시행·조달/교육 대안·효과성 측정 방법 조사",
    "internalInputs": "실제 작업·담당·예산·진행·편차·실적·효과성",
    "sourcesAndTriggers": "L/V/E/R; 계획·갱신 시"
  },
  {
    "code": "AIDU-AIP-06-03-F03",
    "classification": "B",
    "research": "변경 동인·공급자 전환 지침·법령 영향·교육/통지/복구 기준 조사",
    "internalInputs": "실제 전후 상태·완전성·자원·승인·실행·완료 검증",
    "sourcesAndTriggers": "L/V/T; 변경안 준비"
  },
  {
    "code": "AIDU-AIP-07-01-F01",
    "classification": "A",
    "research": "연산·API·도구·전문지원의 기능·가격·제약·지원·에너지 대안 비교",
    "internalInputs": "실제 사용량·현재량·부족분·예산·조달·인수 결과",
    "sourcesAndTriggers": "V/R/E; 소요 산정·갱신"
  },
  {
    "code": "AIDU-AIP-07-01-F02",
    "classification": "B",
    "research": "실제 등록 자원의 지원 종료·버전·라이선스·권리·보안 공지 감시",
    "internalInputs": "실제 보유·사용 버전·상태·용량·담당·점검 실적",
    "sourcesAndTriggers": "V/T; 주기 점검·지원/정책 변경"
  },
  {
    "code": "AIDU-AIP-07-01-F03",
    "classification": "B",
    "research": "공급자 공식 IAM 역할·권한 범위·만료/회수 방법 조사, 실제 업무 목적에 맞는 최소 권한 신청안",
    "internalInputs": "신청자·실제 업무·계정·승인·부여/회수·검증 증거. 검색으로 계정 권한을 변경하지 않음",
    "sourcesAndTriggers": "V/T; 권한 신청·변경·회수 준비"
  },
  {
    "code": "AIDU-AIP-07-01-F04",
    "classification": "B",
    "research": "공급자 반환·삭제·해지·키 회수 방법 및 잔여 보유 조건 조사",
    "internalInputs": "실제 이전·반납·삭제·회수·공급자 확인·종료 결과",
    "sourcesAndTriggers": "V/L/T; 변경·종료 계획"
  },
  {
    "code": "AIDU-AIP-07-02-F01",
    "classification": "B",
    "research": "역할별 법령·기술·윤리 역량과 자격/교육 요건 조사, 평가 기준 제안",
    "internalInputs": "실제 직원 학력·경험·실무 증거·평가·수행 허용 결정",
    "sourcesAndTriggers": "L/E/S/T; 역할·기술·의무 변경"
  },
  {
    "code": "AIDU-AIP-07-02-F02",
    "classification": "A",
    "research": "역량 부족에 맞는 과정·일정·비용·강사·교재·선수지식 비교, 교육/실습안 작성",
    "internalInputs": "실제 부족 역량·대상자·가용 일정·예산·계획 승인",
    "sourcesAndTriggers": "E/T/L; 연간 계획·역량 부족·주요 변경"
  },
  {
    "code": "AIDU-AIP-07-02-F03",
    "classification": "B",
    "research": "교육 내용의 최신성·사례·실습 문제·평가 방법 조사",
    "internalInputs": "실제 참석·이수·실습·답안·평가자·효과·제한 해제",
    "sourcesAndTriggers": "E/T; 교육 준비·효과성 평가 준비"
  },
  {
    "code": "AIDU-AIP-07-02-F04",
    "classification": "B",
    "research": "최신 사건·고지 변경을 설명 자료·대상별 사례·이해 확인 문항으로 변환",
    "internalInputs": "실제 전달 대상·전달·답변·오해·보완·완료",
    "sourcesAndTriggers": "T/L/E; 연간 전달·중요 변경"
  },
  {
    "code": "AIDU-AIP-07-03-F01",
    "classification": "C",
    "research": "별도 검색 없음. ERP의 실제 문서·버전·승인·보유 기준을 집계",
    "internalInputs": "실제 소유·저장·승인·시행·배포·회수 상태",
    "sourcesAndTriggers": "ERP 내부 이력; 등록·개정"
  },
  {
    "code": "AIDU-AIP-07-03-F02",
    "classification": "B",
    "research": "외부 요구 변경과 사내 문서의 차이·영향 조사, 개정 이유·문안 제안",
    "internalInputs": "현행 규정·작성/검토 의견·승인·시행·교육·회수 사실",
    "sourcesAndTriggers": "L/V/S; 외부 요구·규정 변경"
  },
  {
    "code": "AIDU-AIP-07-03-F03",
    "classification": "A",
    "research": "공식 출처·발행자·버전·효력일·확인일·변경·다음 확인 후보를 자동 정리",
    "internalInputs": "회사 적용 범위·담당·후속 반영 판단. 수집 로그와 공식 기록 구분",
    "sourcesAndTriggers": "L/T/V/R/E/S; 모든 채택 가능한 외부 조사"
  },
  {
    "code": "AIDU-AIP-07-03-F04",
    "classification": "B",
    "research": "보유 의무·기산점·계약/공급자 사본·삭제 방식·예외 조건 조사",
    "internalInputs": "실제 정보 유형·목적·저장/복제·설정·삭제 실행·검증",
    "sourcesAndTriggers": "L/V/T; 도입·규정/공급자 변경·폐기 준비"
  },
  {
    "code": "AIDU-AIP-07-03-F05",
    "classification": "B",
    "research": "제공/통지 조건·공식 전달 방법·접근성·기한 근거 조사,통지 문안·계획 초안",
    "internalInputs": "실제 계약·발생/인지시각·대상·발송·수령·이해·미도달",
    "sourcesAndTriggers": "L/V/S; 통지 계획·의무 변경"
  },
  {
    "code": "AIDU-AIP-08-01-F01",
    "classification": "B",
    "research": "모델 카드·기능·한계·의존성·지원/변경 정보·문서화 기준 조사",
    "internalInputs": "실제 아키텍처·설정·목적·업무 흐름·사용 모델·단계 책임",
    "sourcesAndTriggers": "V/T/S; 도입·모델·설계 변경"
  },
  {
    "code": "AIDU-AIP-08-01-F02",
    "classification": "B",
    "research": "데이터셋 출처·라이선스·제한·공급자 보관/학습/지역 정책·품질 방법 조사",
    "internalInputs": "실제 데이터·전송 필드·계정/플랜·설정·가명처리·삭제 검증",
    "sourcesAndTriggers": "V/L/R/T; 데이터·정책·용도 변경"
  },
  {
    "code": "AIDU-AIP-08-01-F03",
    "classification": "B",
    "research": "공격·편향·실패 사례, 벤치마크·지표·시험 방법·표본 설계 조사, 시험 시나리오 초안",
    "internalInputs": "실제 환경·데이터·사전 합격 기준·실행 결과·독립 검토·승인",
    "sourcesAndTriggers": "T/R/S; 시험 계획·새 위협·변경"
  },
  {
    "code": "AIDU-AIP-08-01-F04",
    "classification": "A",
    "research": "공급자 약관·DPA·보관/학습·SLA·인증·지원·해지 조건 비교와 변경 감시, 정보 요청안",
    "internalInputs": "실제 계약·계정·플랜·지역·설정·고객 사용·통합 시험, 최종 충족/계약 판단",
    "sourcesAndTriggers": "V/L/T; 도입·갱신·정책 변경·중대 사고"
  },
  {
    "code": "AIDU-AIP-08-01-F05",
    "classification": "B",
    "research": "릴리스 노트·호환성·이전/복구 권고·공급자 변경 위험 조사",
    "internalInputs": "실제 버전·시험·수용·교육·배포·복구·인수·승인",
    "sourcesAndTriggers": "V/T; 배포·변경 준비"
  },
  {
    "code": "AIDU-AIP-08-01-F06",
    "classification": "B",
    "research": "실제 사건에 관련된 공급자 장애·취약점·대응 권고·보고 의무 조사",
    "internalInputs": "실제 탐지·영향·로그·발생/인지·통지·복구·재개 승인. 외부 사고를 회사 사고로 등록하지 않음",
    "sourcesAndTriggers": "T/V/L; 실제 경보·사건 후 조사"
  },
  {
    "code": "AIDU-AIP-08-01-F07",
    "classification": "B",
    "research": "권리·처리 기한·유사 분쟁·설명/정정/구제 방법 조사, 답변안",
    "internalInputs": "실제 접수·당사자 권한·개별 결과·사람의 재검토·회신·구제",
    "sourcesAndTriggers": "L/R; 실제 접수 후 조사"
  },
  {
    "code": "AIDU-AIP-08-01-F08",
    "classification": "B",
    "research": "공급자 종료·반환·삭제·기록 보유·대체/전환·이용자 보호 기준 조사",
    "internalInputs": "실제 사본·미처리 의무·통지·이전·삭제·검증·종료 승인",
    "sourcesAndTriggers": "V/L/T; 종료 계획"
  },
  {
    "code": "AIDU-AIP-08-01-F09",
    "classification": "B",
    "research": "고지·표시·설명·접근성·감독 기준과 공급자 설명 한계 조사, 채널별 문안/시험안",
    "internalInputs": "실제 출력 채널·사용자·게시 화면·감독자·개입 시험·배포 확인",
    "sourcesAndTriggers": "L/V/S/P; 도입·출력/법령 변경"
  },
  {
    "code": "AIDU-AIP-08-01-F10",
    "classification": "B",
    "research": "적용 법령·고시·서식·제출방법·게시/보유 기준·공급자 선행 자료 조사",
    "internalInputs": "확정 적용 분류·실제 이행/게시/보관/제출·공급자 범위 일치, 이행 간주·충족 판정",
    "sourcesAndTriggers": "L/V/P; 해당 시스템 도입·의무 변경"
  },
  {
    "code": "AIDU-AIP-09-01-F01",
    "classification": "B",
    "research": "지표·산식·표본·통계적 한계·분야 기준·경보 방법 조사",
    "internalInputs": "실제 목표·데이터 접근성·기준선·허용치·담당·주기 승인",
    "sourcesAndTriggers": "R/S/T; 계획·지표 변경"
  },
  {
    "code": "AIDU-AIP-09-01-F02",
    "classification": "B",
    "research": "비교 가능한 외부 기준·변화·연구를 내부 결과와 대조, 비교 한계 설명",
    "internalInputs": "실제 측정·표본·추세·원인·효과성 판단",
    "sourcesAndTriggers": "R/T; 정기 평가·이상 분석"
  },
  {
    "code": "AIDU-AIP-09-01-F03",
    "classification": "B",
    "research": "요구의 최신 버전·효력·적용 조건 확인, 내부 증거 대비 부족 항목과 확인 방법 초안",
    "internalInputs": "실제 이행 증거·적용 사실·평가자·준수/미준수/보류/비해당 결정",
    "sourcesAndTriggers": "L/V/S/P; 정기 평가·의무 변경"
  },
  {
    "code": "AIDU-AIP-09-02-F01",
    "classification": "B",
    "research": "외부 사건·법령·분야 위험으로 심사 우선순위·표본 후보 보강",
    "internalInputs": "실제 범위·이전 심사·SoA·인력·일정·프로그램 승인",
    "sourcesAndTriggers": "L/T/R/S; 연간 계획·중대 변화"
  },
  {
    "code": "AIDU-AIP-09-02-F02",
    "classification": "B",
    "research": "최신 기준·분야 확인 질문·추적 사례·외부 전문가 자격요건 조사",
    "internalInputs": "실제 심사원 역량·관여 이력·독립성·배정·면담 일정",
    "sourcesAndTriggers": "L/S/T/E; 심사 준비"
  },
  {
    "code": "AIDU-AIP-09-02-F03",
    "classification": "B",
    "research": "발견사항과 대조할 공식 요구·해석·전문 확인 필요 쟁점 조사",
    "internalInputs": "실제 면담·표본·객관적 증거·심사원 판단·이견·보고",
    "sourcesAndTriggers": "L/S; 실제 발견사항 검토"
  },
  {
    "code": "AIDU-AIP-09-02-F04",
    "classification": "B",
    "research": "공개 고지·연락처·구제 창구가 시정 대상이면 지정 URL의 변경·접근 가능성을 재관찰하고 출처·관찰일·표본 한계를 정리",
    "internalInputs": "내부 구현·재시험·운영 표본·독립 검증·효과성·종결 판단. 공개 관찰로 확인 가능한 항목에 한정",
    "sourcesAndTriggers": "P 및 기존 조사; 후속 확인"
  },
  {
    "code": "AIDU-AIP-09-03-F01",
    "classification": "A",
    "research": "기간별 외부 이슈·요구·사고·공급자·법령·환경 변화와 미처리 조사를 모아 안건·권고안 작성",
    "internalInputs": "내부 성과·심사·시정·이전 조치·실제 참석/검토 계획",
    "sourcesAndTriggers": "기존 조사+L/T/V/R; 연간·수시 경영검토 준비"
  },
  {
    "code": "AIDU-AIP-09-03-F02",
    "classification": "C",
    "research": "별도 검색 없음. 승인된 입력자료·대안 조사 연결, 결정할 항목의 빈 틀만 준비",
    "internalInputs": "실제 대표이사 검토·질문·판단·결정·승인·자원·후속 이행",
    "sourcesAndTriggers": "기존 조사 재사용; 실제 경영검토"
  },
  {
    "code": "AIDU-AIP-10-01-F01",
    "classification": "B",
    "research": "외부 사고·연구의 회사 적용성·유사 위험·개선 후보 조사",
    "internalInputs": "실제 요구 위반·통제 실패·피해 증거. 외부 뉴스만 있으면 개선/추가 확인 후보",
    "sourcesAndTriggers": "T/R/L; 외부 발견·내부 접수"
  },
  {
    "code": "AIDU-AIP-10-01-F02",
    "classification": "B",
    "research": "유사 원인·미탐지 요인·패치/대안·검증 방법 조사, 원인 가설과 조치안",
    "internalInputs": "회사 로그·변경·원인 조사·실제 조치·독립 효과성·종결",
    "sourcesAndTriggers": "T/V/R; 부적합 조사·재발"
  },
  {
    "code": "AIDU-AIP-10-01-F03",
    "classification": "A",
    "research": "신기술·비AI/단순화·비용/에너지 절감·품질 개선 대안 비교",
    "internalInputs": "내부 기준선·실행 가능성·채택·전후 성과·부작용·재사용 판단",
    "sourcesAndTriggers": "T/V/R; 정기 개선·주요 사건 후"
  }
] as const;
