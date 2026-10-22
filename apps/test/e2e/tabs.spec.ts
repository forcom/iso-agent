import {test,expect,type Page} from '@playwright/test';

async function selectPerson(page:Page,id:string){
  await page.getByRole('combobox',{name:'직원 선택',exact:true}).selectOption(id);
  await expect(page.getByRole('combobox',{name:'직원 선택',exact:true})).toHaveValue(id);
}

test('workspace tabs name documents and reuse the same artifact across source and review routes',async({page})=>{
  await page.goto('/#/home');await selectPerson(page,'author');
  const tabs=page.getByRole('navigation',{name:'열린 화면',exact:true});
  const documents=page.locator('.sidebar').getByRole('link',{name:'규정·양식',exact:true});
  await documents.click();
  await page.getByRole('table').getByRole('link',{name:'시험 절차',exact:true}).click();
  await expect(tabs.getByRole('link',{name:'시험 절차',exact:true})).toHaveCount(1);
  await documents.click();
  await page.getByRole('table').getByRole('link',{name:'시험 기록 1',exact:true}).click();
  await expect(tabs.getByRole('link',{name:'시험 기록 1',exact:true})).toHaveCount(1);
  await documents.click();await documents.click();
  await expect(tabs.getByRole('link',{name:'규정·양식',exact:true})).toHaveCount(1);
  await expect(tabs.getByRole('link')).toHaveCount(4);

  for(const path of ['/sources/test-reg-rev?revision=test-reg-rev&citation=synthetic-tab-citation','/reviews/records/test-reg-rev?revision=test-reg-rev','/documents/test-reg?revision=test-reg-rev']){
    await page.goto(`/#${path}`);
    await expect(page.getByRole('heading',{name:'시험 절차',exact:true})).toBeVisible();
    await expect(tabs.getByRole('link',{name:'시험 절차',exact:true})).toHaveAttribute('href',`#${path}`);
    await expect(tabs.getByRole('link')).toHaveCount(4);
    await expect(tabs.locator('.workspace-tab.active').getByRole('link')).toHaveText('시험 절차');
  }
  await tabs.getByRole('button',{name:'시험 기록 1 탭 닫기',exact:true}).click();
  await expect(page).toHaveURL(/#\/documents\/test-reg\?revision=test-reg-rev$/);
  await tabs.getByRole('button',{name:'시험 절차 탭 닫기',exact:true}).click();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(tabs.getByRole('link',{name:'시험 절차',exact:true})).toHaveCount(0);
  await expect(tabs.getByRole('button',{name:'업무 홈 탭 닫기',exact:true})).toHaveCount(0);
  await selectPerson(page,'reader');
  await expect(tabs.getByRole('link')).toHaveCount(1);
  await expect(tabs.getByRole('link')).toHaveText('업무 홈');
});

test('workspace tabs keep distinct records with the same title and protect unsaved input',async({page})=>{
  await page.goto('/#/home');await selectPerson(page,'author');
  const title='같은 제목의 합성 기록',urls:string[]=[];
  const tabs=page.getByRole('navigation',{name:'열린 화면',exact:true});
  for(let i=0;i<2;i++){
    await page.locator('.sidebar').getByRole('link',{name:'기록관리',exact:true}).click();
    await page.getByRole('button',{name:'기록 업로드',exact:true}).click();
    const dialog=page.getByRole('dialog');
    await dialog.getByLabel('문서번호',{exact:true}).fill(`TAB-${i}-${Date.now()}`);
    await dialog.getByLabel('기록명',{exact:true}).fill(title);
    await dialog.getByLabel('기록 유형',{exact:true}).selectOption('test-F01');
    await dialog.getByLabel('Markdown 파일',{exact:true}).setInputFiles({name:'synthetic-tab.md',mimeType:'text/markdown',buffer:Buffer.from('# 같은 제목의 합성 기록\n탭 식별용 합성 자료입니다.\n')});
    await dialog.getByRole('button',{name:'파일 등록',exact:true}).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
    urls.push(page.url());
    await expect(tabs.getByRole('link',{name:title,exact:true})).toHaveCount(i+1);
  }
  expect(urls[0]).not.toBe(urls[1]);
  await page.getByRole('textbox',{name:'검토 의견',exact:true}).fill('보존해야 하는 미제출 의견');
  page.once('dialog',dialog=>void dialog.dismiss());
  await tabs.getByRole('button',{name:`${title} 탭 닫기`,exact:true}).last().click();
  await expect(page).toHaveURL(urls[1]);
  await expect(page.getByRole('textbox',{name:'검토 의견',exact:true})).toHaveValue('보존해야 하는 미제출 의견');
  await expect(tabs.getByRole('link',{name:title,exact:true})).toHaveCount(2);
  page.once('dialog',dialog=>void dialog.accept());
  await tabs.getByRole('button',{name:`${title} 탭 닫기`,exact:true}).last().click();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(tabs.getByRole('link',{name:title,exact:true})).toHaveCount(1);
  await tabs.getByRole('link',{name:title,exact:true}).click();
  await expect(page).toHaveURL(urls[0]);
});

test('closing a document tab while its source route loads does not reopen it',async({page})=>{
  await page.goto('/#/home');await selectPerson(page,'reader');
  const tabs=page.getByRole('navigation',{name:'열린 화면',exact:true});
  await page.goto('/#/documents/test-reg');
  await expect(tabs.getByRole('link',{name:'시험 절차',exact:true})).toHaveCount(1);
  await tabs.getByRole('link',{name:'업무 홈',exact:true}).click();
  await expect(page.getByRole('heading',{name:'업무 홈',exact:true})).toBeVisible();
  let release!:()=>void,started!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve}),requestStarted=new Promise<void>(resolve=>{started=resolve});
  await page.route('**/api/artifacts/by-revision/test-reg-rev',async route=>{started();await gate;await route.continue().catch(()=>{})});
  try{
    await page.goto('/#/sources/test-reg-rev');await requestStarted;
    await tabs.getByRole('button',{name:'시험 절차 탭 닫기',exact:true}).click();
    await expect(page).toHaveURL(/#\/home$/);
    release();
    await page.unrouteAll({behavior:'wait'});
    await expect(tabs.getByRole('link',{name:'시험 절차',exact:true})).toHaveCount(0);
    await expect(page.getByRole('heading',{name:'업무 홈',exact:true})).toBeVisible();
  }finally{release()}
});

test('workspace tabs use wiki and regulation-change titles',async({page})=>{
  await page.goto('/#/home');await selectPerson(page,'admin');
  const tabs=page.getByRole('navigation',{name:'열린 화면',exact:true});
  await page.locator('.sidebar').getByRole('link',{name:'지식 위키',exact:true}).click();
  const firstWiki=page.locator('main .item-list a').first();
  const wikiTitle=(await firstWiki.locator('span').first().innerText()).split('\n')[0];
  await firstWiki.click();
  await expect(tabs.getByRole('link',{name:wikiTitle,exact:true})).toHaveCount(1);
  await expect(tabs.getByRole('link',{name:'지식 위키',exact:true})).toHaveCount(1);
  await page.goto('/#/admin/regulations');
  await page.getByRole('button',{name:'규정 변경 시작',exact:true}).click();
  const dialog=page.getByRole('dialog'),changeTitle=`탭 식별 검증 ${Date.now()}`;
  await dialog.getByLabel('변경 제목').fill(changeTitle);
  await dialog.getByLabel('변경 목적').fill('합성 변경 건의 탭 제목 확인');
  await dialog.getByRole('button',{name:'변경 건 등록',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  await page.locator('main').getByRole('link',{name:new RegExp(changeTitle)}).click();
  await expect(tabs.getByRole('link',{name:changeTitle,exact:true})).toHaveCount(1);
  await expect(tabs.locator('.workspace-tab.active').getByRole('link')).toHaveText(changeTitle);
});
