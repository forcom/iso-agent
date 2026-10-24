import {test,expect,type Page} from '@playwright/test';
async function person(page:Page,id:string){await page.getByRole('combobox',{name:'직원 선택',exact:true}).selectOption(id);await expect(page.getByRole('combobox',{name:'직원 선택',exact:true})).toHaveValue(id)}
async function decisions(page:Page){const tab=page.getByRole('tab',{name:'판단·이력',exact:true});if(await tab.isVisible())await tab.click()}
test.beforeEach(async({page})=>{page.on('dialog',d=>void d.accept());await page.goto('/#/home');await person(page,'admin')});
test.afterEach(async({page})=>{await page.unrouteAll({behavior:'ignoreErrors'})});
for(const width of [1440,390])test(`ERP research schedules and handoff at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto('/#/research');
 await expect(page.getByRole('heading',{name:'외부 조사',exact:true})).toBeVisible();
 await expect(page.getByText('Dots 연결 필요',{exact:true}).first()).toBeVisible();
 await page.getByRole('button',{name:'새 일정',exact:true}).click();const form=page.getByRole('dialog');
 const title=`합성 월간 조사 ${width}-${Date.now()}`;
 await form.getByLabel('업무명',{exact:true}).fill(title);
 await form.getByLabel('조사 목적',{exact:true}).fill('합성 외부 이슈 초안 준비');
 await form.getByLabel('조사 대상',{exact:true}).fill('합성 AI 서비스');
 await form.getByLabel('기록 유형',{exact:true}).selectOption('test-F01');
 await form.getByLabel('조사할 항목',{exact:true}).fill('외부 이슈');
 await form.getByLabel('업무 담당자',{exact:true}).selectOption('author');
 await form.getByLabel('실행 주기',{exact:true}).selectOption('monthly');
 await form.getByLabel('매월 날짜',{exact:true}).fill('31');
 await form.getByLabel('일정 시작일',{exact:true}).fill('2030-01-01');
 await expect(form.getByText(/다음 실행.*2030/)).toBeVisible();
 await form.getByRole('button',{name:'일정 저장',exact:true}).click();await expect(form).not.toBeVisible();
 const card=page.getByRole('article',{name:title});await card.getByRole('button',{name:'지금 실행',exact:true}).click();
 await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
 await page.getByLabel('현재 담당자',{exact:true}).selectOption('reader');
 await page.getByRole('button',{name:'담당 변경',exact:true}).click();
 await expect(page.getByText('요청자: 시험 admin',{exact:true})).toBeVisible();
 await expect(page.getByLabel('현재 담당자',{exact:true})).toHaveValue('reader');
 await page.getByRole('link',{name:'외부 조사 목록',exact:true}).click();
 await page.getByRole('article',{name:title}).getByRole('button',{name:'예약 중지',exact:true}).click();
 await expect(page.getByRole('article',{name:title})).toContainText('예약 중지됨');
 await person(page,'reader');await expect(page.getByRole('button',{name:'새 일정',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'일정 삭제',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await person(page,'admin');await card.getByRole('button',{name:'일정 삭제',exact:true}).click();
 await expect(card).toHaveCount(0);
 await page.locator('.item-list').getByRole('link').filter({hasText:title}).click();
 await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
});
test('schedule controls check the assignee permissions before allowing run or edits',async({page})=>{
 await page.goto('/#/research');await page.getByRole('button',{name:'새 일정',exact:true}).click();const form=page.getByRole('dialog');
 const title=`합성 공통 감시 ${Date.now()}`;
 await form.getByLabel('업무명',{exact:true}).fill(title);
 await form.getByLabel('조사 목적',{exact:true}).fill('합성 다중 유형 일정의 권한 대조');
 await form.getByLabel('조사 대상',{exact:true}).fill('합성 서비스');
 await form.getByLabel('기록 유형',{exact:true}).selectOption(['test-F01','test-F02']);
 await form.getByLabel('조사할 항목',{exact:true}).fill('합성 외부 변경');
 await form.getByLabel('업무 담당자',{exact:true}).selectOption('reader');
 await form.getByRole('button',{name:'일정 저장',exact:true}).click();await expect(form).not.toBeVisible();
 const card=page.getByRole('article',{name:title});
 await person(page,'reader');
 for(const name of ['지금 실행','일정 수정','예약 중지'])await expect(card.getByRole('button',{name,exact:true})).toBeDisabled();
 await expect(card).toContainText('이 일정에 포함된 모든 기록 유형의 작성 권한이 필요합니다.');
 await expect(card).toContainText('운영 관리자');
 await person(page,'author');await expect(card.getByRole('button',{name:'지금 실행',exact:true})).toHaveCount(0);
 await person(page,'admin');await expect(card.getByRole('button',{name:'지금 실행',exact:true})).toBeEnabled();
 await card.getByRole('button',{name:'지금 실행',exact:true}).click();
 await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
 await expect(page.getByText('요청자: 시험 admin',{exact:true})).toBeVisible();
 await expect(page.getByRole('combobox',{name:'현재 담당자',exact:true})).toHaveValue('reader');
 await expect(page.getByRole('alert')).toHaveCount(0);
});

test('research proposals remain drafts and use the normal upload permission flow',async({page})=>{
 const response=await page.request.post('/api/test/research/fixture');expect(response.ok()).toBe(true);const {jobId}=await response.json();
 await person(page,'author');await page.goto(`/#/research/jobs/${jobId}`);
 await expect(page.getByRole('heading',{name:'합성 결과 확인용 조사',exact:true})).toBeVisible();
 await expect(page.getByText(/ERP에서 원문을 독립적으로 확보/)).toBeVisible();
 await expect(page.locator('.evidence-list').getByRole('heading',{name:'시험 절차',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'기록으로 채택',exact:true}).click();const form=page.getByRole('dialog');
 await form.getByLabel('문서번호',{exact:true}).fill(`TEST-RESEARCH-${Date.now()}`);
 await form.getByLabel('기록명',{exact:true}).fill('사람이 검토한 조사 기록');
 await form.getByLabel('Markdown 파일',{exact:true}).setInputFiles({name:'reviewed.md',mimeType:'text/markdown',buffer:Buffer.from('# 사람이 검토한 초안\n실제 수행은 미확인\n')});
 await form.getByRole('button',{name:'파일 등록',exact:true}).click();await expect(form).not.toBeVisible();
 await expect(page.locator('.page-title').getByRole('heading',{name:'사람이 검토한 조사 기록',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'조사 제안·근거 보기',exact:true})).toBeVisible();
  await decisions(page);
  await expect(page.locator('.workbench-decision .status').first()).toHaveText('초안');
  await page.getByRole('button',{name:'검토 요청',exact:true}).click();
  await expect(page.getByText('검토 요청 처리되었습니다.',{exact:true})).toBeVisible();
  await person(page,'reviewer');
  await decisions(page);
  await page.getByLabel('검토 의견',{exact:true}).fill('합성 시험에서 채택된 원문과 외부 출처의 한계를 검토함.');
  await page.getByRole('button',{name:'검토 완료',exact:true}).click();
  await expect(page.getByText('검토 완료 처리되었습니다.',{exact:true})).toBeVisible();
  await person(page,'approver');
  await decisions(page);
  await page.getByRole('button',{name:'승인',exact:true}).click();
  await expect(page.locator('.workbench-decision .status').first()).toHaveText('승인');
  await page.getByRole('link',{name:'조사 제안·근거 보기',exact:true}).click();
  await expect(page.getByRole('link',{name:'채택한 기록 보기',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'기록으로 채택',exact:true})).toHaveCount(0);
});

test('research results refresh automatically but preserve an unsaved supplement',async({page})=>{
 const response=await page.request.post('/api/test/research/fixture');expect(response.ok()).toBe(true);const {jobId}=await response.json();
 await person(page,'author');
 let deliver=false,unavailable=false;
 await page.route(`**/api/research/jobs/${jobId}`,async route=>{
  if(unavailable){await route.fulfill({status:503,json:{error:{code:'ENGINE_UNAVAILABLE',message:'합성 일시 장애'}}});return}
  const upstream=await route.fetch(),body=await upstream.json();
  if(!deliver){body.job.state='partial';body.job.message='합성 보완 대기';body.results=[];body.proposals=[]}
  await route.fulfill({response:upstream,json:body});
 });
 await page.goto(`/#/research/jobs/${jobId}`);
 await expect(page.getByText('합성 보완 대기',{exact:true})).toBeVisible();
 await page.getByRole('textbox',{name:'보완 내용',exact:true}).fill('아직 전송하지 않은 보완');deliver=true;
 await page.waitForTimeout(11000);
 await expect(page.getByRole('textbox',{name:'보완 내용',exact:true})).toHaveValue('아직 전송하지 않은 보완');
 await expect(page.getByRole('heading',{name:'합성 제안 기록',exact:true})).toHaveCount(0);
 await page.getByRole('textbox',{name:'보완 내용',exact:true}).fill('');
 await expect(page.getByRole('heading',{name:'합성 제안 기록',exact:true})).toBeVisible({timeout:15000});
 unavailable=true;
 await expect(page.getByRole('alert')).toContainText('합성 일시 장애',{timeout:15000});
 await expect(page.getByRole('heading',{name:'합성 제안 기록',exact:true})).toBeVisible();
 unavailable=false;
 await expect(page.getByRole('alert')).toHaveCount(0,{timeout:15000});
});

test('research list discovers new results without reloading the page',async({page})=>{
 await page.goto('/#/research');await expect(page.getByRole('heading',{name:'외부 조사',exact:true})).toBeVisible();
 const response=await page.request.post('/api/test/research/fixture');expect(response.ok()).toBe(true);const {jobId}=await response.json();
 await expect(page.locator(`a[href="#/research/jobs/${jobId}"]`)).toBeVisible({timeout:15000});
});

test('an in-flight refresh cannot replace a form while it is being edited',async({page})=>{
 const response=await page.request.post('/api/test/research/fixture');expect(response.ok()).toBe(true);const {jobId}=await response.json();
 await person(page,'author');let ready=false,blocked=false,release!:()=>void,started!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve}),polling=new Promise<void>(resolve=>{started=resolve});
 await page.route(`**/api/research/jobs/${jobId}`,async route=>{
  const upstream=await route.fetch(),body=await upstream.json();
  if(!ready){body.job.state='partial';body.results=[];body.proposals=[]}
  else if(!blocked){blocked=true;started();await gate}
  await route.fulfill({response:upstream,json:body});
 });
 try{
  await page.goto(`/#/research/jobs/${jobId}`);
  await expect(page.getByRole('textbox',{name:'보완 내용',exact:true})).toBeVisible();ready=true;await polling;
  await page.getByRole('textbox',{name:'보완 내용',exact:true}).fill('조회 도중 입력한 내용');
  release();await page.waitForTimeout(1000);
  await expect(page.getByRole('textbox',{name:'보완 내용',exact:true})).toHaveValue('조회 도중 입력한 내용');
  await page.getByRole('textbox',{name:'보완 내용',exact:true}).fill('');
  await expect(page.getByRole('heading',{name:'합성 제안 기록',exact:true})).toBeVisible({timeout:15000});
 }finally{release()}
});

test('a conflict retry loads the current job and preserves the selected assignee',async({page})=>{
 const fixture=await page.request.post('/api/test/research/fixture');expect(fixture.ok()).toBe(true);const {jobId}=await fixture.json();
 await page.goto(`/#/research/jobs/${jobId}`);
 await expect(page.getByRole('button',{name:'기록으로 채택',exact:true})).toBeEnabled();
 await page.getByRole('combobox',{name:'현재 담당자',exact:true}).selectOption('reader');
 const detail=await (await page.request.get(`/api/research/jobs/${jobId}`)).json(),me=await (await page.request.get('/api/me')).json();
 const concurrent=await page.request.post(`/api/research/jobs/${jobId}`,{headers:{'X-Session-Version':String(me.sessionVersion)},data:{action:'assign',assigneeId:'reviewer',expectedVersion:detail.job.version,expectedContext:detail.context,requestKey:crypto.randomUUID()}});
 expect(concurrent.ok()).toBe(true);
 await page.getByRole('button',{name:'담당 변경',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('409');
 await page.getByRole('button',{name:'다시 조회',exact:true}).click();
 await expect(page.locator('.timeline strong').filter({hasText:'담당 변경'})).toHaveCount(1);
 await expect(page.getByRole('combobox',{name:'현재 담당자',exact:true})).toHaveValue('reader');
 await page.getByRole('button',{name:'담당 변경',exact:true}).click();
 await expect(page.locator('.timeline strong').filter({hasText:'담당 변경'})).toHaveCount(2);
 await expect(page.getByRole('alert')).toHaveCount(0);
 expect((await (await page.request.get(`/api/research/jobs/${jobId}`)).json()).job.assigneeId).toBe('reader');
});

test('a three-hour schedule is saved and can be edited without losing its cadence',async({page})=>{
 await page.goto('/#/research');await page.getByRole('button',{name:'새 일정',exact:true}).click();const form=page.getByRole('dialog');
 const title=`합성 3시간 조사 ${Date.now()}`;
 await form.getByLabel('업무명',{exact:true}).fill(title);
 await form.getByLabel('조사 목적',{exact:true}).fill('합성 외부 변경 감시');
 await form.getByLabel('조사 대상',{exact:true}).fill('합성 서비스');
 await form.getByLabel('기록 유형',{exact:true}).selectOption('test-F01');
 await form.getByLabel('조사할 항목',{exact:true}).fill('외부 변경과 근거');
 await expect(form.getByRole('option',{name:'3시간마다',exact:true})).toHaveCount(1);
 await form.getByLabel('실행 주기',{exact:true}).selectOption('three_hourly');
 await form.getByLabel('실행 시각',{exact:true}).fill('00:00');
 await form.getByLabel('일정 시작일',{exact:true}).fill('2030-01-01');
 await form.getByRole('button',{name:'일정 저장',exact:true}).click();await expect(form).not.toBeVisible();
 const card=page.getByRole('article',{name:title});await expect(card).toContainText('3시간마다');
 await card.getByRole('button',{name:'일정 수정',exact:true}).click();
 await expect(form.getByLabel('실행 주기',{exact:true})).toHaveValue('three_hourly');
 await expect(form.getByLabel('실행 시각',{exact:true})).toHaveValue('00:00');
 await form.getByRole('button',{name:'취소',exact:true}).click();
});
test('a writer can adopt their individual proposal from a multi-type research job',async({page})=>{
 const response=await page.request.post('/api/test/research/limited-fixture');expect(response.ok()).toBe(true);const {jobId}=await response.json();
 await page.reload();await person(page,'research-limited-author');await page.goto(`/#/research/jobs/${jobId}`);
 const first=page.getByRole('article').filter({has:page.getByRole('heading',{name:'합성 제안 기록',exact:true})});
 const second=page.getByRole('article').filter({has:page.getByRole('heading',{name:'두 번째 유형 제안',exact:true})});
 await expect(first.getByRole('button',{name:'기록으로 채택',exact:true})).toBeEnabled();
 await expect(second.getByRole('button',{name:'기록으로 채택',exact:true})).toBeDisabled();
});
