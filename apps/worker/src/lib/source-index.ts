import type {SourceRevision} from '../../../packages/contracts/src/index';
import type {Env} from '../types';
import {requireValue} from './errors';
import {parseMarkdown,sha256} from './markdown';

/** Index originals belong to the effective release and have no artifact/revision DB row. */
export async function readIndexSource(env:Env,source:SourceRevision) {
 requireValue(source.kind==='index',404,'NOT_FOUND','목차 원문을 찾을 수 없습니다.');
 const object=await env.SOURCES.get(`sources/${source.revisionId}/${source.sha256}.md`);
 requireValue(object,422,'SOURCE_UNAVAILABLE','원본을 확보할 수 없습니다.');
 const bytes=new Uint8Array(await object.arrayBuffer());requireValue(await sha256(bytes)===source.sha256,422,'SOURCE_CHANGED','원본 해시가 일치하지 않습니다.');
 const parsed=await parseMarkdown('index.md',bytes);requireValue(parsed.textSha256===source.textSha256,422,'SOURCE_CHANGED','추출 텍스트 해시가 일치하지 않습니다.');
 return {bytes,markdown:parsed.markdown};
}
