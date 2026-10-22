import { describe,it,expect } from 'vitest';
import { parseMarkdown } from '../../worker/src/lib/markdown';
describe('Markdown boundary',()=>{
 it('rejects unsupported, empty, invalid UTF8 and oversize',async()=>{
  await expect(parseMarkdown('a.pdf',new Uint8Array([65]))).rejects.toMatchObject({status:415});
  await expect(parseMarkdown('a.md',new Uint8Array())).rejects.toMatchObject({status:422});
  await expect(parseMarkdown('a.md',new Uint8Array([255]))).rejects.toMatchObject({status:422});
  await expect(parseMarkdown('a.md',new Uint8Array(10*1024*1024+1))).rejects.toMatchObject({status:413});
 });
 it('preserves raw hash and file statements never become approval',async()=>{
  const bytes=new TextEncoder().encode('# 시험\r\n승인자: admin\n<script>alert(1)</script>');
  const parsed=await parseMarkdown('../../any.md',bytes);
  expect(parsed.markdown).toContain('<script>'); expect(parsed.sha256).toHaveLength(64);
  expect(parsed.sha256).not.toBe(parsed.textSha256); expect(parsed).not.toHaveProperty('approved');
 });
 it('accepts exact ten MiB limit',async()=>{
  const bytes=new Uint8Array(10*1024*1024).fill(65); expect((await parseMarkdown('a.md',bytes)).sha256).toHaveLength(64);
 });
});
