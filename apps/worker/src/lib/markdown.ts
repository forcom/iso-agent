import { ApiError, requireValue } from './errors';
export function markdownDownload(bytes:Uint8Array,filename:string) {
  return new Response(bytes as BodyInit,{headers:{'Content-Type':'text/markdown;charset=utf-8','Content-Disposition':`attachment; filename="source.md"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g,char=>`%${char.charCodeAt(0).toString(16)}`)}`,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}});
}
export async function sha256(value:Uint8Array|string):Promise<string> {
  const bytes=typeof value==='string'?new TextEncoder().encode(value):value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export async function parseMarkdown(name:string,bytes:Uint8Array) {
  requireValue(/\.md$/i.test(name),415,'UNSUPPORTED_FILE_TYPE','UTF-8 Markdown(.md)만 지원합니다.');
  requireValue(bytes.byteLength<=10*1024*1024,413,'FILE_TOO_LARGE','파일은 최대 10 MiB입니다.');
  let markdown:string;
  try { markdown=new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes).replace(/\r\n?/g,'\n'); }
  catch { throw new ApiError(422,'INVALID_UTF8','UTF-8 파일을 사용해 주세요.'); }
  requireValue(markdown.trim() && !markdown.includes('\0'),422,'INVALID_MARKDOWN','파일이 비어 있거나 텍스트가 아닙니다.');
  return {markdown,sha256:await sha256(bytes),textSha256:await sha256(markdown)};
}
