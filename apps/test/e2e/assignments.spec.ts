import {test,expect} from '@playwright/test';

test('assigned non-administrator opens the ERP page and applies only source-matched roles',async({page})=>{
 await page.goto('/#/home');
 const selected=page.waitForResponse(response=>response.url().endsWith('/api/session')&&response.request().method()==='POST');
 await page.getByRole('combobox',{name:'직원 선택',exact:true}).selectOption('director');
 const session=await selected;expect(session.status()).toBe(200);expect((await session.json()).actor.isAdmin).toBe(false);
 await page.locator('.sidebar').getByRole('link',{name:'역할 지정·적용',exact:true}).click();
 await expect(page).toHaveURL(/#\/assignments$/);
 expect((await (await page.request.get('/api/me')).json()).actor.isAdmin).toBe(false);
 await page.getByRole('button',{name:/지정 기록.*appointment-v1/}).click();
 await expect(page.getByText('후보 지정 또는 미충족 조건이 있어 적용할 수 없습니다.',{exact:true})).toBeVisible();
 const form=page.getByRole('form',{name:'R-01 한글 지정 대조'});
 await expect(form.getByText('2026. 4. 27. 지정 / 해제일 없음',{exact:true})).toBeVisible();
 await form.getByLabel('대상 직원',{exact:true}).selectOption('appointment-reader');
 await form.getByLabel('기능상 역할',{exact:true}).selectOption(['approver']);
 await form.getByLabel('역할·범위 대응 사유',{exact:true}).fill('합성 원문의 전사 검토·승인 업무를 승인 역할로 대조했습니다.');
 await expect(form.getByRole('button',{name:'대조한 지정 적용'})).toBeDisabled();
 await form.getByLabel('원문과 직원·역할·기간·범위를 대조했습니다.').check();
 await form.getByRole('button',{name:'대조한 지정 적용'}).click();
 await expect(page.getByText('역할 지정 적용 결과가 반영되었습니다.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:/지정 기록.*appointment-v1/}).click();
 await form.getByLabel('대상 직원',{exact:true}).selectOption('appointment-reader');
 await form.getByLabel('기능상 역할',{exact:true}).selectOption(['approver']);
 await expect(form.getByText('이미 유효 — 적용 생략',{exact:true})).toBeVisible();
 await expect(form.getByRole('button',{name:'대조한 지정 적용'})).toBeDisabled();
});

test('global readers and an administrator without the apply role see sources with disabled application',async({page})=>{
 for(const person of ['reader','admin']){
  await page.goto('/#/home');const selected=page.waitForResponse(response=>response.url().endsWith('/api/session')&&response.request().method()==='POST');await page.getByRole('combobox',{name:'직원 선택',exact:true}).selectOption(person);expect((await selected).status()).toBe(200);
  await page.goto('/#/admin/assignments');await expect(page).toHaveURL(/#\/assignments$/);
  await page.getByRole('button',{name:/지정 기록.*appointment-v1/}).click();
  const data=await (await page.request.get('/api/admin/role-assignments')).json(),authorization=data.candidates[0].authorization;expect(authorization.allowed).toBe(false);
  await expect(page.getByText(authorization.reason,{exact:true}).first()).toBeVisible();
  const form=page.getByRole('form',{name:'R-01 한글 지정 대조'});await form.getByLabel('대상 직원',{exact:true}).selectOption('appointment-reader');await form.getByLabel('기능상 역할',{exact:true}).selectOption(['reviewer']);await form.getByLabel('역할·범위 대응 사유',{exact:true}).fill('Synthetic denied actor must not apply source mappings');await form.getByLabel('원문과 직원·역할·기간·범위를 대조했습니다.').check();await expect(form.getByRole('button',{name:'대조한 지정 적용'})).toBeDisabled();
 }
});
