import { test, expect, type Page } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const markdown = '# 렌더링 시험\n\n## 검토 항목\n\n**중요한 내용**과 `표시 코드`\n\n| 항목 | 결과 |\n| --- | --- |\n| 원문 보존 | 확인 |\n\n- [x] 검토 완료\n- [ ] 후속 확인\n\n> 합성 인용문\n\n```json\n{"count":0}\n```\n\n[시험 절차](../procedure/TEST-PROC.md)\n\n[미등록 문서](./UNKNOWN.md)\n\n[위험 링크](javascript:alert(1))\n\n![외부 이미지](https://example.invalid/tracker.png)\n\n<script>window.renderingUnsafe = true</script>\n';
async function login(page: Page) {
  await page.goto('/#/home');
  await page.getByRole('combobox', { name: '직원 선택', exact: true }).selectOption('author');
  await expect(page.getByLabel('질문', { exact: true })).toBeVisible();
}

test('documents render safely and preserve exact uploaded bytes when downloaded', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('example.invalid')) external.push(request.url()); });
  await login(page);
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await expect(page).toHaveTitle('iso-agent · AI 경영시스템');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await page.getByRole('button', { name: '기록 업로드', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('문서번호', { exact: true }).fill(`RENDER-${Date.now()}`);
  await dialog.getByLabel('기록명', { exact: true }).fill('렌더링 합성 기록');
  await dialog.getByLabel('기록 유형', { exact: true }).selectOption('test-F01');
  const original = Buffer.from('\uFEFF' + markdown.replace(/\n/g, '\r\n'));
  await dialog.getByLabel('Markdown 파일', { exact: true }).setInputFiles({ name: 'rendering.md', mimeType: 'text/markdown', buffer: original });
  await dialog.getByRole('button', { name: '파일 등록', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const viewer = page.locator('.workbench-source');
  await expect(viewer.getByRole('heading', { name: '검토 항목', exact: true })).toBeVisible();
  await expect(viewer.getByRole('cell', { name: '원문 보존', exact: true })).toBeVisible();
  await expect(viewer.locator('strong')).toHaveText('중요한 내용');
  await expect(viewer.getByRole('checkbox')).toHaveCount(2);
  await expect(viewer.getByRole('checkbox').first()).toBeChecked();
  await expect(viewer.getByRole('checkbox').first()).toBeDisabled();
  await expect(viewer.getByRole('link', { name: '시험 절차', exact: true })).toHaveAttribute('href', '#/documents/test-reg');
  await expect(viewer.getByRole('link', { name: '미등록 문서', exact: true })).toHaveCount(0);
  await expect(viewer.locator('a[href^="javascript:"], img, script, iframe')).toHaveCount(0);
  expect(external).toEqual([]);
  expect(await page.evaluate(() => (window as any).renderingUnsafe)).toBeUndefined();
  const screenshots = resolve('../../output/test/screenshots');
  await mkdir(screenshots, { recursive: true });
  await expect(page.getByText('자료를 불러오는 중입니다…', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: resolve(screenshots, 'rendered-document.png'), fullPage: true });
  await viewer.getByRole('button', { name: '원문 보기', exact: true }).click();
  await expect(viewer.locator('.source-line')).toContainText(markdown.split('\n'));
  const download = page.waitForEvent('download');
  await viewer.getByRole('button', { name: 'Markdown 다운로드', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.md$/);
  expect(await readFile((await file.path())!)).toEqual(original);
  await viewer.getByRole('button', { name: '읽기 보기', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(viewer.getByRole('cell', { name: '원문 보존', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(screenshots, 'rendered-document-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
  await page.route('**/content?download=1', route => route.fulfill({ status: 422, json: { error: { code: 'SOURCE_CHANGED', message: '원본 해시가 일치하지 않습니다.' } } }));
  await viewer.getByRole('button', { name: 'Markdown 다운로드', exact: true }).click();
  await expect(viewer.getByRole('alert')).toHaveText('원본 해시가 일치하지 않습니다.');
});

test('answers show structured results, retain empty and false values, and export JSON', async ({ page }) => {
  await login(page);
  const result = { markdown: '# 합성 답변\n\n**근거를 확인하세요.**', computed: { totalEntities: 0, excluded: [], unknown: [{ id: 'pending', reason: '확인 필요' }], allowed: false, optional: null }, context: { releaseId: 'synthetic-release', dataRevision: 0 } };
  await page.route('**/api/ask', route => route.fulfill({ json: result }));
  await page.getByLabel('질문', { exact: true }).fill('합성 응답 표시 시험');
  await page.getByRole('button', { name: '질문하기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '합성 답변', exact: true })).toBeVisible();
  const computed = page.locator('details').filter({ has: page.locator(':scope > summary', { hasText: /^계산 결과$/ }) });
  await expect(computed.getByText('확인 필요', { exact: true })).toBeVisible();
  await expect(computed.getByText('아니요', { exact: true })).toBeVisible();
  await expect(computed.getByText('미제공', { exact: true })).toBeVisible();
  await expect(computed.getByText('0', { exact: true })).toBeVisible();
  await expect(computed.getByText('항목 없음', { exact: true })).toBeVisible();
  await expect(computed.locator('pre')).toHaveCount(0);
  const screenshots = resolve('../../output/test/screenshots');
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: resolve(screenshots, 'rendered-answer.png'), fullPage: true });
  await computed.getByRole('button', { name: 'JSON 원문 보기', exact: true }).click();
  expect(JSON.parse(await computed.locator('pre').innerText())).toEqual(result.computed);
  const download = page.waitForEvent('download');
  await computed.getByRole('button', { name: 'JSON 다운로드', exact: true }).click();
  expect(JSON.parse(await readFile((await (await download).path())!, 'utf8'))).toEqual(result.computed);
  await computed.getByRole('button', { name: '정리된 보기', exact: true }).click();
  const full = page.locator('details').filter({ has: page.locator(':scope > summary', { hasText: /^응답 전체$/ }) });
  await full.locator(':scope > summary').click();
  await full.getByRole('button', { name: 'JSON 원문 보기', exact: true }).click();
  expect(JSON.parse(await full.locator('pre').innerText())).toEqual(result);
  await full.locator(':scope > summary').click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('citation highlighting requires the original source hash and keeps raw syntax visible', async ({ page }) => {
  await login(page);
  await page.route('**/api/artifacts/test-reg/revisions/test-reg-rev/content', async route => {
    const response = await route.fetch();
    const content = await response.json();
    await route.fulfill({ json: { ...content, revision: { ...content.revision, sourceSha256: 'changed-hash' } } });
  });
  await page.getByRole('link', { name: /test-reg-rev · 2–2행/ }).first().click();
  await expect(page.getByText('인용과 원문·해시가 일치하지 않아 강조하지 않습니다.', { exact: true })).toBeVisible();
  await expect(page.locator('.source-line.highlighted')).toHaveCount(0);
  await expect(page.locator('.source-line').first()).toContainText('# 시험 절차');
});

test('leading document properties do not become a large Markdown heading', async ({ page }) => {
  await login(page);
  await page.route('**/api/source-index/rendering-index', route => route.fulfill({ json: {
    source: { title: '합성 속성 시험', code: 'RENDER-INDEX', sha256: 'a'.repeat(64) },
    markdown: '---\ninformation_type: index\nauthor: "합성 작성자"\n---\n\n# 본문 제목\n\n본문 내용입니다.\n', evidenceStatus: 'verified',
  } }));
  await page.goto('/#/sources/rendering-index');
  await expect(page.getByRole('heading', { name: '본문 제목', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /information_type/ })).toHaveCount(0);
  await page.getByText('문서 속성', { exact: true }).click();
  await expect(page.locator('.document-properties')).toContainText('author: "합성 작성자"');
});

test('unknown JSON field names remain literal labels, including prototype names', async ({ page }) => {
  await login(page);
  await page.route('**/api/ask', route => route.fulfill({ json: {
    answer: '필드 이름 표시 시험', computed: JSON.parse('{"__proto__":"원문 필드","items":[{"constructor":"사용자 필드"},{"id":"별도 항목"}]}'),
  } }));
  await page.getByLabel('질문', { exact: true }).fill('합성 필드 표시');
  await page.getByRole('button', { name: '질문하기', exact: true }).click();
  await expect(page.getByText('원문 필드', { exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'constructor', exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: '별도 항목' }).getByRole('cell').first()).toHaveText('미제공');
});

test('installed release selection opens its structured manifest and JSON source', async ({ page }) => {
  await login(page);
  await page.goto('/#/admin/releases');
  const response = await page.request.get('/api/admin/releases');
  const { items } = await response.json();
  await page.locator('main .row-button').first().click();
  const detail = page.locator('details').filter({ has: page.locator(':scope > summary', { hasText: '원문·규칙·엔진·검토 manifest' }) });
  await expect(detail.locator(':scope > summary')).toBeVisible();
  await detail.locator(':scope > summary').click();
  await expect(detail.locator('.data-fields').first()).toBeVisible();
  await detail.getByRole('button', { name: 'JSON 원문 보기', exact: true }).click();
  expect(JSON.parse(await detail.locator('pre').innerText()).releaseId).toBe(items[0].releaseId);
});
