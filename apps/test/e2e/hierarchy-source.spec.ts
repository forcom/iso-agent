import { test, expect } from '@playwright/test';

test('document types use the ontology labels and retain their filter after reload', async ({ page }) => {
  await page.goto('/#/documents');
  await page.getByRole('combobox', { name: '직원 선택', exact: true }).selectOption('reader');
  const types = page.getByRole('combobox', { name: '문서 유형', exact: true });
  await expect(types.locator('option')).toHaveText(['전체', '매뉴얼', '절차서', '지침서', '빈 양식']);
  await types.selectOption('procedure');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr td').nth(2)).toHaveText('절차서');
  await page.reload();
  await expect(types).toHaveValue('procedure');
  await expect(page.locator('tbody tr td').nth(2)).toHaveText('절차서');
  await page.getByRole('link', { name: '시험 절차', exact: true }).click();
  await expect(page.getByText('TEST-PROC · 절차서', { exact: true })).toBeVisible();
  await page.goto('/#/documents?kind=template');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.locator('tbody tr td:nth-child(3)')).toHaveText(['빈 양식', '빈 양식']);
  await types.selectOption('guide');
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await page.getByRole('button', { name: '초기화', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(3);
});

test('index citations open a read-only source without an ERP artifact', async ({ page }) => {
  await page.route('**/api/source-index/synthetic-index-rev', route => route.fulfill({ json: {
    source: { revisionId: 'synthetic-index-rev', title: '합성 문서체계', code: 'SYNTHETIC-INDEX', kind: 'index', sha256: 'a'.repeat(64) },
    markdown: '# 합성 문서체계\n매뉴얼 → 절차서 → 지침서\n', evidenceStatus: 'verified',
  } }));
  await page.goto('/#/home');
  await page.getByRole('combobox', { name: '직원 선택', exact: true }).selectOption('reader');
  await page.goto('/#/sources/synthetic-index-rev');
  await expect(page.getByRole('heading', { name: '합성 문서체계', exact: true }).first()).toBeVisible();
  await expect(page.getByText('매뉴얼 → 절차서 → 지침서', { exact: true })).toBeVisible();
  await expect(page.getByText('SYNTHETIC-INDEX · 문서체계·목차 원문')).toBeVisible();
  await expect(page.getByRole('button', { name: '승인', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '새 버전 업로드', exact: true })).toHaveCount(0);
});
