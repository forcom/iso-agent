import {test,expect} from '@playwright/test';

test('administrator compares a Korean source and applies only selected roles',async({page})=>{
 await page.goto('/#/home');
 await page.getByRole('combobox',{name:'직원 선택',exact:true}).selectOption('admin');
 await page.goto('/#/admin/assignments');
 await page.getByRole('button',{name:/지정 기록.*appointment-v1/}).click();
 await expect(page.getByText('후보 지정 또는 미충족 조건이 있어 적용할 수 없습니다.',{exact:true})).toBeVisible();
 const form=page.getByRole('form',{name:'R-01 한글 지정 대조'});
 await expect(form.getByRole('definition').filter({hasText:'2026. 4. 27. 지정 / 해제일 없음'})).toBeVisible();
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
