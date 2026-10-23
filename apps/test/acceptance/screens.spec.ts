import {test,expect,type Page} from '@playwright/test';
import {appendFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash,type Inventory} from './inventory';
import {saveJson} from './client';

const root=fileURLToPath(new URL('../../../',import.meta.url));
test('AT-04/12/13/16 representative upload, decisions, V2 and personal receipts at five viewports',async({page})=>{
 const plan=JSON.parse(await readFile(process.env.ACCEPTANCE_PLAN!,'utf8')) as Inventory;
 const row=plan.rows.find(row=>row.informationId===process.env.ACCEPTANCE_SAMPLE_CODE)!;
 const directory=resolve(root,'output/test/acceptance',process.env.ACCEPTANCE_RUN_ID!,plan.target,'screens');await mkdir(directory,{recursive:true});
 const original=await readFile(resolve(root,row.sourcePath));expect(hash(original)).toBe(row.sourceSha256);
 const evidence:any[]=[];let artifactId='',lastRevisionId='',status='failed';
 page.on('dialog',dialog=>void dialog.accept());
 const actor=async(personId:string)=>{
  await page.getByRole('combobox',{name:'직원 선택',exact:true}).selectOption(personId);
  await expect(page.getByRole('combobox',{name:'직원 선택',exact:true})).toHaveValue(personId);
  await expect(page.getByText('자료를 불러오는 중입니다…',{exact:true})).toHaveCount(0);
 };
 const decisions=async()=>{const tab=page.getByRole('tab',{name:'판단·이력',exact:true});if(await tab.isVisible())await tab.click();};
 const postClick=async(name:string,path:string)=>{
  const started=Date.now(),response=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===path);
  await page.getByRole('button',{name,exact:true}).click();const result=await response;expect(result.ok()).toBe(true);
  const body=await result.json();evidence.push({method:'POST',path,status:result.status(),durationMs:Date.now()-started,revisionId:body.revisionId,decisionId:body.decisionId,context:body.context});return body;
 };
 const upload=async(bytes:Buffer,name:string)=>{
  await actor(row.actors.author);
  if(artifactId){await page.goto(`/#/records/${artifactId}`);await page.getByRole('button',{name:'새 버전 업로드',exact:true}).click();}
  else{await page.goto('/#/records');await page.getByRole('button',{name:'기록 업로드',exact:true}).click();}
  const dialog=page.getByRole('dialog');
  if(!artifactId){await dialog.getByLabel('문서번호',{exact:true}).fill(row.informationId);await dialog.getByLabel('기록명',{exact:true}).fill(row.title);await dialog.getByLabel('기록 유형',{exact:true}).selectOption(row.recordTypeId);}
  await dialog.getByLabel('대상 시스템',{exact:true}).selectOption(row.targetSystemId);
  await dialog.getByLabel('Markdown 파일',{exact:true}).setInputFiles({name,mimeType:'text/markdown',buffer:bytes});
  const path=artifactId?`/api/records/${artifactId}/revisions`:'/api/records',started=Date.now();
  const pending=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===path);
  await dialog.getByRole('button',{name:'파일 등록',exact:true}).click();const response=await pending;expect(response.status()).toBe(201);const result=await response.json();
  artifactId=result.artifactId;lastRevisionId=result.revisionId;await expect(dialog).not.toBeVisible();await expect(page.getByLabel('Markdown 원문').first()).toBeVisible();
  evidence.push({operation:'upload',kind:path==='/api/records'?'new-record':'new-revision',path,status:201,durationMs:Date.now()-started,artifactId,revisionId:lastRevisionId,sourceSha256:hash(bytes),context:result.context});return result;
 };
 const approve=async()=>{
  await actor(row.actors.submitter);await decisions();await postClick('검토 요청',`/api/records/${artifactId}/submit`);
  for(const personId of row.actors.reviewers){await actor(personId);await decisions();const button=page.getByRole('button',{name:'검토 완료',exact:true});if(await button.isVisible()&&await button.isEnabled()){await page.getByLabel('검토 의견',{exact:true}).fill('인수시험: 이 버전 원문 확인');await postClick('검토 완료',`/api/revisions/${lastRevisionId}/decisions`);}}
  for(const personId of row.actors.approvers){await actor(personId);await decisions();const button=page.getByRole('button',{name:'승인',exact:true});if(await button.isVisible()&&await button.isEnabled())await postClick('승인',`/api/revisions/${lastRevisionId}/decisions`);}
  const detail=await (await page.request.get(`/api/artifacts/${artifactId}`)).json();expect(detail.artifact.effectiveRevisionId).toBe(lastRevisionId);expect(detail.revisions.find((revision:any)=>revision.id===lastRevisionId).state).toBe('approved');
 };
 const circulate=async()=>{
  await actor(row.actors.circulator);await decisions();await page.getByRole('button',{name:'회람 개시',exact:true}).click();
  const dialog=page.getByRole('dialog'),purpose=`인수시험 ${process.env.ACCEPTANCE_RUN_ID} ${lastRevisionId}`;await dialog.getByLabel('전달 목적').fill(purpose);
  for(const id of row.actors.recipients)await dialog.locator(`input[type="checkbox"][value="${id}"]`).check();
  const pending=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/api/revisions/${lastRevisionId}/circulations`);
  await dialog.getByRole('button',{name:'회람 개시',exact:true}).click();const response=await pending;expect(response.status()).toBe(201);const circulation=await response.json();await expect(dialog).not.toBeVisible();
  for(const id of row.actors.recipients){
   await actor(id);await page.goto('/#/reviews');await page.locator('.row-button').filter({hasText:lastRevisionId}).click();
   await page.getByRole('dialog').getByLabel('이 버전의 자료를 수령했습니다.').check();await page.getByRole('dialog').getByLabel('전달 내용을 이해했습니다.').check();
   await page.getByRole('button',{name:'본인 확인 제출',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
   const list=await (await page.request.get('/api/circulations')).json();const saved=list.items.find((item:any)=>item.id===circulation.circulationId);for(const kind of ['received','understood'])expect(saved.receipts.some((item:any)=>item.personId===id&&item.kind===kind)).toBe(true);
  }
  evidence.push({operation:'circulate-and-personal-receipts',revisionId:lastRevisionId,circulationId:circulation.circulationId,recipients:row.actors.recipients});
 };
 try{
  await page.goto('/#/home');await actor(row.actors.author);
  const existing=await (await page.request.get('/api/artifacts?category=records')).json();const match=existing.items.find((item:any)=>item.documentCode===row.informationId);artifactId=match?.id??'';
  for(const viewport of [{width:1440,height:900},{width:1920,height:1080},{width:1280,height:800},{width:1024,height:768},{width:390,height:844}]){
   await page.setViewportSize(viewport);await page.goto('/#/home');await upload(original,basename(row.sourcePath));await approve();await circulate();
   const previous=lastRevisionId,derived=Buffer.concat([original,Buffer.from(`\n\n인수시험용 파생 V2 (${viewport.width}): 원본 ${row.sourcePath}, SHA-256 ${row.sourceSha256}. 실제 업무 사실이 아닌 화면 검증용 추가 문장.\n`)]);
   await writeFile(resolve(directory,`derived-v2-${viewport.width}.md`),derived,{mode:0o600});
   await saveJson(resolve(directory,`derivation-${viewport.width}.json`),{sourcePath:row.sourcePath,sourceSha256:row.sourceSha256,derivedSha256:hash(derived),reason:'AT-12 separate working/effective revisions'});
   await upload(derived,`acceptance-v2-${viewport.width}.md`);
   const pending=await (await page.request.get(`/api/artifacts/${artifactId}`)).json();expect(pending.artifact.effectiveRevisionId).toBe(previous);expect(pending.artifact.workingRevisionId).toBe(lastRevisionId);
   const working=pending.revisions.find((revision:any)=>revision.id===lastRevisionId);expect(working.state).toBe('draft');expect(working.reviewedBy??[]).toEqual([]);expect(working.approvedBy??[]).toEqual([]);
   await page.getByLabel('비교 버전',{exact:true}).selectOption(previous);await expect(page.getByLabel('Markdown 원문')).toHaveCount(2);await page.screenshot({path:resolve(directory,`AT12-${viewport.width}.png`),fullPage:true});
   await approve();await page.goto('/#/search');await page.getByLabel('검색어',{exact:true}).fill(row.informationId);await page.getByRole('button',{name:'검색',exact:true}).click();await page.locator(`.item-list a[href*="/records/${artifactId}"]`).first().click();
   await expect(page.getByLabel('Markdown 원문').first()).toBeVisible();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
   expect(await page.evaluate(()=>Object.keys(localStorage).concat(Object.keys(sessionStorage)))).toEqual([]);await page.screenshot({path:resolve(directory,`AT16-${viewport.width}.png`),fullPage:true});
  }
  await upload(original,basename(row.sourcePath));await approve();
  const restored=await (await page.request.get(`/api/artifacts/${artifactId}`)).json();expect(restored.revisions.find((revision:any)=>revision.id===lastRevisionId).sourceSha256).toBe(row.sourceSha256);
  expect(hash(await readFile(resolve(root,row.sourcePath)))).toBe(row.sourceSha256);
  evidence.push({operation:'original-content-restored-as-new-approved-revision',artifactId,revisionId:lastRevisionId,sourceSha256:row.sourceSha256});
  status='passed';
 }finally{
  await appendFile(resolve(directory,'results.jsonl'),evidence.map(item=>JSON.stringify(item)).join('\n')+'\n',{mode:0o600});
  await saveJson(resolve(directory,'sample-report.json'),{kind:'acceptance-ui-sample',status,artifactId,lastRevisionId,sourcePath:row.sourcePath,sourceSha256:row.sourceSha256,coverage:'Representative UI positive flows; complete AT scenario verdicts require separate negative/evidence checks',evidence});
 }
});
