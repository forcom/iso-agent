import {test,expect} from '@playwright/test';

test('record decisions wait for the displayed revision source and send its review version',async({page})=>{
 await page.goto('/#/home');
 await page.getByRole('combobox',{name:'직원 선택',exact:true}).selectOption('author');
 await expect(page.getByRole('combobox',{name:'직원 선택',exact:true})).toHaveValue('author');
 const me=await (await page.request.get('/api/me')).json();
 const created=await page.request.post('/api/records',{headers:{'X-Session-Version':String(me.sessionVersion)},multipart:{
  file:{name:'delayed-source.md',mimeType:'text/markdown',buffer:Buffer.from('# Synthetic delayed source\nRead this revision before submitting.\n')},
  documentCode:`DELAYED-${Date.now()}`,title:'Synthetic delayed source',recordTypeIds:JSON.stringify(['test-F01']),templateRevisionIds:JSON.stringify(['test-tpl-rev-1']),requestKey:crypto.randomUUID(),expectedContext:JSON.stringify(me.context),
 }});
 expect(created.status()).toBe(201);const record=await created.json();
 let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve});
 await page.route(`**/api/artifacts/${record.artifactId}/revisions/${record.revisionId}/content`,async route=>{await gate;await route.continue().catch(()=>{});});
 const actionsPath=`/api/records/${record.artifactId}/actions?revisionId=${record.revisionId}`;
 const actionsResponse=page.waitForResponse(response=>new URL(response.url()).pathname+new URL(response.url()).search===actionsPath);
 try{
  await page.goto(`/#/records/${record.artifactId}`);
  const actions=await (await actionsResponse).json();expect(actions.actions.find((action:any)=>action.action==='submit').allowed).toBe(true);
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await expect(page.getByRole('button',{name:'검토 요청',exact:true})).toHaveCount(0);
  release();await expect(page.getByLabel('Markdown 원문')).toContainText('Read this revision before submitting.');
  const submitted=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith(`/api/records/${record.artifactId}/submit`));
  await page.getByRole('button',{name:'검토 요청',exact:true}).click();
  const response=await submitted;
  expect(response.request().postDataJSON()).toMatchObject({revisionId:record.revisionId,expectedRevisionVersion:actions.revisionVersion});
  expect(response.status()).toBe(200);
  await expect(page.getByText('검토 요청 처리되었습니다.',{exact:true})).toBeVisible();
 }finally{release();await page.unrouteAll({behavior:'wait'});}
});
