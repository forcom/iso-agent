import {test,expect,type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

const screenshots=resolve(import.meta.dirname,'../../../output/test/screenshots');
async function selectPerson(page:Page,id:string){
 await page.getByRole('combobox',{name:'직원 선택',exact:true}).selectOption(id);
 await expect(page.getByRole('combobox',{name:'직원 선택',exact:true})).toHaveValue(id);
}
async function decisions(page:Page){
 if((page.viewportSize()?.width??1440)>=900)return;
 const tab=page.getByRole('tab',{name:'판단·이력'});await expect(tab).toBeVisible();await tab.click();
 await expect(tab).toHaveAttribute('aria-selected','true');
}

for(const viewport of [{width:1440,height:900},{width:390,height:844}])test(`plan approval remains explicitly scoped through circulation at ${viewport.width}`,async({page})=>{
 await page.setViewportSize(viewport);const errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/#/home');await selectPerson(page,'author');
 page.on('console',message=>{if(['error','warning'].includes(message.type()))errors.push(message.text());});
 await expect(page).toHaveTitle('iso-agent · AI 경영시스템');
 await expect(page.getByRole('heading',{name:'업무 홈',exact:true})).toBeVisible();
 await expect(page.locator('vite-error-overlay')).toHaveCount(0);
 await page.goto('/#/records');await page.getByRole('button',{name:'기록 업로드',exact:true}).click();
 const title=`합성 계획 승인 ${viewport.width}-${Date.now()}`,uploadDialog=page.getByRole('dialog');
 await uploadDialog.getByLabel('문서번호',{exact:true}).fill(`PLAN-${viewport.width}-${Date.now()}`);
 await uploadDialog.getByLabel('기록명',{exact:true}).fill(title);
 await uploadDialog.getByLabel('기록 유형',{exact:true}).selectOption('test-F01');
 await uploadDialog.getByLabel('Markdown 파일',{exact:true}).setInputFiles({name:'scoped-plan.md',mimeType:'text/markdown',buffer:Buffer.from(`# ${title}\n\n합성 계획 문서이며 실제 운영 승인이 아닙니다.\n`)});
 const uploaded=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/records');
 await uploadDialog.getByRole('button',{name:'파일 등록',exact:true}).click();
 const uploadResponse=await uploaded;expect(uploadResponse.status()).toBe(201);const record=await uploadResponse.json();
 await expect(uploadDialog).not.toBeVisible();await expect(page).toHaveURL(new RegExp(`/#/records/${record.artifactId}$`));
 await decisions(page);
 const scope=page.getByRole('combobox',{name:'요청할 승인 범위',exact:true});
 await expect(scope).toHaveValue('outcome');await scope.selectOption('record');
 const submitted=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith(`/api/records/${record.artifactId}/submit`));
 await page.getByRole('button',{name:'검토 요청',exact:true}).click();
 const submitResponse=await submitted;expect(submitResponse.status()).toBe(200);
 expect(submitResponse.request().postDataJSON()).toMatchObject({revisionId:record.revisionId,approvalScope:'record'});
 await expect(page.getByText('검토 요청 처리되었습니다.',{exact:true})).toBeVisible();
 await selectPerson(page,'reviewer');await decisions(page);
 await page.getByRole('button',{name:'검토 완료',exact:true}).click();
 await expect(page.getByText('검토 완료 처리되었습니다.',{exact:true})).toBeVisible();
 await selectPerson(page,'approver');await decisions(page);
 await expect(page.getByRole('button',{name:'계획 승인',exact:true})).toBeEnabled();
 await expect(page.getByRole('button',{name:'승인',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'계획 승인',exact:true}).click();
 await expect(page.getByText('계획 승인 처리되었습니다.',{exact:true})).toBeVisible();
 const detail=await (await page.request.get(`/api/artifacts/${record.artifactId}`)).json();
 expect(detail.revisions.find((revision:any)=>revision.id===record.revisionId)).toMatchObject({state:'approved',approvalScope:'record',approvedBy:['approver']});
 await expect(page.getByText('계획 문서만 승인합니다. 실제 운영·잔여 리스크 수용·시정조치 종결을 승인하지 않습니다.',{exact:false}).first()).toBeVisible();
 await mkdir(screenshots,{recursive:true});await page.screenshot({path:resolve(screenshots,`approval-scope-${viewport.width}.png`),fullPage:true});
 await selectPerson(page,'author');await decisions(page);
 await page.getByRole('button',{name:'회람 개시',exact:true}).click();
 const circulation=page.getByRole('dialog');await circulation.getByLabel('전달 목적').fill('계획 승인 범위와 한계를 알립니다.');
 await circulation.getByLabel('시험 reader',{exact:true}).check();await circulation.getByRole('button',{name:'회람 개시',exact:true}).click();
 await expect(circulation).not.toBeVisible();await selectPerson(page,'reader');await page.goto('/#/reviews');
 await page.locator('.row-button').filter({hasText:title}).click();
 const receipt=page.getByRole('dialog');
 await expect(receipt.getByText('문서·계획 승인본입니다. 후속 조치 완료나 실제 운영·종결 승인을 뜻하지 않습니다.',{exact:true})).toBeVisible();
 await page.screenshot({path:resolve(screenshots,`approval-scope-receipt-${viewport.width}.png`),fullPage:true});
 await expect(page.locator('vite-error-overlay')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 expect(errors).toEqual([]);
});
