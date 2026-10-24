import { test, expect } from '@playwright/test';

function largeDiff() {
  const evidence = (quote: string) => [{revisionId:'synthetic-proof',sourceSha256:'a'.repeat(64),lineStart:2,lineEnd:2,quote}];
  const relation = (id: string, quote: string) => ({id,subjectId:`child-${id}`,objectId:'parent',type:'subordinate_to',reviewStatus:'candidate',evidenceRefs:evidence(quote)});
  const changed = Array.from({length:3100},(_,index)=>({key:`relation-${index}`,before:relation(`relation-${index}`,`Before ${index}: `+'Synthetic evidence. '.repeat(40)),after:relation(`relation-${index}`,`After ${index}: `+'Synthetic evidence. '.repeat(40))}));
  const source = (markdown: string) => ({id:'source',revisionId:'source-rev',artifactId:'source-artifact',title:'Synthetic source change',kind:'procedure',markdown});
  return {
    relations:{beforeCount:3101,afterCount:3101,added:[relation('new','Exact added hierarchy evidence.')],removed:[relation('old','Exact removed hierarchy evidence.')],changed,unchanged:0},
    sources:{beforeCount:1,afterCount:1,added:[],removed:[],changed:[{key:'source',before:source('# Before source\n\nOriginal source body.'),after:source('# After source\n\nChanged source body.')}],unchanged:0},
  };
}

test('large release differences mount only opened categories, rows and source bodies', async ({ page }) => {
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/#/home');await page.getByRole('combobox',{name:'직원 선택',exact:true}).selectOption('reader');
  await page.route('**/api/admin/regulation-changes/lazy-synthetic',route=>route.fulfill({json:{change:{id:'lazy-synthetic',title:'Large synthetic candidate',state:'built',candidateHash:'a'.repeat(64),diff:largeDiff()},revisions:[],decisions:[]}}));
  const started=Date.now();await page.goto('/#/admin/changes/lazy-synthetic');
  await expect(page.getByRole('table',{name:'재구축 변경 요약'})).toBeVisible();
  expect(await page.locator('summary').count()).toBeLessThan(20);
  await expect(page.locator('.evidence-list')).toHaveCount(0);
  const category=page.locator('summary').filter({hasText:/^관계 변경 항목 ·/});
  await expect(category).toBeVisible();await category.click();
  await expect(page.locator('summary').filter({hasText:'추가 · child-new → subordinate_to → parent'})).toHaveCount(1);
  await expect(page.locator('.evidence-list')).toHaveCount(0);
  const added=page.locator('summary').filter({hasText:'추가 · child-new → subordinate_to → parent'});await added.click();
  await expect(added.locator('..').getByText('Exact added hierarchy evidence.',{exact:true})).toBeVisible();
  const removed=page.locator('summary').filter({hasText:'삭제 · child-old → subordinate_to → parent'});await removed.click();
  await expect(removed.locator('..').getByText('Exact removed hierarchy evidence.',{exact:true})).toBeVisible();
  const changed=page.locator('summary').filter({hasText:'변경 · child-relation-3099 → subordinate_to → parent'});await changed.click();
  await expect(changed.locator('..').getByRole('heading',{name:'이전',exact:true})).toBeVisible();
  await expect(changed.locator('..').getByRole('heading',{name:'이후',exact:true})).toBeVisible();
  await expect(changed.locator('..').locator('blockquote').first()).toContainText('Before 3099:');
  await expect(changed.locator('..').locator('blockquote').last()).toContainText('After 3099:');
  await added.click();await expect(added.locator('..').locator('.evidence-list')).toHaveCount(0);await expect(removed.locator('..').getByText('Exact removed hierarchy evidence.',{exact:true})).toBeVisible();
  await category.click();await expect(page.locator('.evidence-list')).toHaveCount(0);await expect(added).toHaveCount(0);
  const sourceCategory=page.locator('summary').filter({hasText:/^원문 변경 항목 ·/});await sourceCategory.click();
  const source=page.locator('summary').filter({hasText:'변경 · Synthetic source change'});await source.click();
  await expect(source.locator('..').locator('.markdown-body')).toHaveCount(0);
  const sourceBody=source.locator('..').locator('summary').filter({hasText:/^원문 내용$/}).first();await sourceBody.focus();await page.keyboard.press('Enter');
  await expect(source.locator('..').getByRole('heading',{name:'Before source',exact:true})).toBeVisible();
  await expect(source.locator('..').getByRole('heading',{name:'After source',exact:true})).toHaveCount(0);
  await sourceBody.click();await expect(source.locator('..').locator('.markdown-body')).toHaveCount(0);
  expect(Date.now()-started).toBeLessThan(30_000);expect(errors).toEqual([]);
});
