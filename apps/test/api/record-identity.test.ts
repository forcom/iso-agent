import {createHash} from 'node:crypto';
import {it,expect,afterEach} from 'vitest';
import app from '../../worker/src/index';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {all,getKnowledgeContext} from '../../worker/src/lib/storage';
import type {Relation} from '../../packages/contracts/src/index';
let env:TestEnvironment;afterEach(async()=>env?.cleanup());
async function upload(code:string,text:string){
 const author=await env.select('author'),data=new FormData();
 data.set('file',new File([text],`${code}.md`));data.set('documentCode',code);data.set('title',code);data.set('recordTypeId','test-F01');data.set('templateRevisionIds',JSON.stringify(['test-tpl-rev-1']));data.set('requestKey',crypto.randomUUID());data.set('expectedContext',JSON.stringify(await getKnowledgeContext(env.bindings)));
 return app.request('/api/records',{method:'POST',headers:{cookie:`iso_session=${author.sessionId}`,'X-Session-Version':'1'},body:data},env.bindings);
}
const frontmatter=(id:string,form='test-F01')=>`---\ninformation_id: "${id}"\nform_id: "${form}"\n---\n`;

it('checks the existing records’ information_id and form_id against the upload input',async()=>{
 env=await createTestEnvironment();
 const wrongCode=await upload('REC-A',`${frontmatter('REC-B')}# 기록\n`);
 expect(wrongCode.status).toBe(422);expect(await wrongCode.json()).toMatchObject({error:{code:'IDENTITY_CONFLICT'}});
 const wrongType=await upload('REC-A',`${frontmatter('REC-A','test-F02')}# 기록\n`);
 expect(wrongType.status).toBe(422);expect(await wrongType.json()).toMatchObject({error:{code:'TYPE_CONFLICT'}});
 expect((await upload('REC-A',`${frontmatter('REC-A')}# 기록\n`)).status).toBe(201);
});

it('links a record to records registered earlier that already cite its code',async()=>{
 env=await createTestEnvironment();
 const first=await upload('REC-A',`${frontmatter('REC-A')}# 기록 A\n연결 기록: REC-B\n`);expect(first.status).toBe(201);const a=await first.json() as any;
 const second=await upload('REC-B',`${frontmatter('REC-B')}# 기록 B\n상위 기록: REC-A\n`);expect(second.status).toBe(201);const b=await second.json() as any;
 const references=(await all<Relation>(env.bindings,'relations')).filter(r=>r.type==='references');
 expect(references).toContainEqual(expect.objectContaining({subjectId:a.revisionId,objectId:b.artifactId,origin:'reference_extraction',reviewStatus:'candidate',evidenceRefs:[expect.objectContaining({revisionId:a.revisionId,lineStart:6,quote:'연결 기록: REC-B'})]}));
 expect(references).toContainEqual(expect.objectContaining({subjectId:b.revisionId,objectId:a.artifactId}));
});

const abbreviationCases:Array<{line:string;codes:string[];excluded:string;otherExcluded?:string[]}>= [
 {line:'SYN-NUM-2031-004·007·009',codes:['SYN-NUM-2031-004','SYN-NUM-2031-007','SYN-NUM-2031-009'],excluded:'SYN-NUM-2031-005'},
 {line:'SYN-NUM-2031-003~005',codes:['SYN-NUM-2031-003','SYN-NUM-2031-004','SYN-NUM-2031-005'],excluded:'SYN-NUM-2031-006'},
 {line:'SYN-REC-F01·F03-2031-007',codes:['SYN-REC-F01-2031-007','SYN-REC-F03-2031-007'],excluded:'SYN-REC-F02-2031-007',otherExcluded:['SYN-REC-F01']},
 {line:'SYN-REC-F01~F03-2031-007',codes:['SYN-REC-F01-2031-007','SYN-REC-F02-2031-007','SYN-REC-F03-2031-007'],excluded:'SYN-REC-F04-2031-007',otherExcluded:['SYN-REC-F01']},
 {line:'SYN-FORM-F01·F03~F04',codes:['SYN-FORM-F01','SYN-FORM-F03','SYN-FORM-F04'],excluded:'SYN-FORM-F02'},
 {line:'FULL-CODE-A·FULL-CODE-B',codes:['FULL-CODE-A','FULL-CODE-B'],excluded:'FULL-CODE-C'},
 {line:'SYN-PROC-06-01·07-01~07-03',codes:['SYN-PROC-06-01','SYN-PROC-07-01','SYN-PROC-07-02','SYN-PROC-07-03'],excluded:'SYN-PROC-06-02'},
];
it.each(abbreviationCases.flatMap(item=>['before','after'].map(order=>({...item,order}))))('keeps $line as exact source candidates when targets are registered $order the source',async({line:expression,codes,excluded,otherExcluded=[],order})=>{
 env=await createTestEnvironment();
 const line=`연결 기록: ${expression}`,text=`${frontmatter('SYN-SOURCE')}# 합성 출처\n${line}\n`,sourceSha256=createHash('sha256').update(text).digest('hex');
 const targets=new Map<string,any>();let source:any;
 const registerTargets=async()=>{for(const code of [...codes,excluded,...otherExcluded]){
  const response=await upload(code,`${frontmatter(code)}# 합성 대상\n`);expect(response.status).toBe(201);targets.set(code,await response.json());
 }};
 if(order==='before')await registerTargets();
 const response=await upload('SYN-SOURCE',text);expect(response.status).toBe(201);source=await response.json();
 if(order==='after')await registerTargets();
 const targetIds=new Set([...targets.values()].map(target=>target.artifactId));
 const references=(await all<Relation>(env.bindings,'relations')).filter(relation=>relation.subjectId===source.revisionId&&relation.type==='references'&&targetIds.has(relation.objectId));
 expect(references).toHaveLength(codes.length);
 for(const code of codes)expect(references).toContainEqual(expect.objectContaining({objectId:targets.get(code).artifactId,origin:'reference_extraction',reviewStatus:'candidate',evidenceRefs:[expect.objectContaining({revisionId:source.revisionId,sourceSha256,lineStart:6,lineEnd:6,quote:line})]}));
 for(const code of [excluded,...otherExcluded])expect(references.some(relation=>relation.objectId===targets.get(code).artifactId)).toBe(false);
 expect((await all<Relation>(env.bindings,'relations')).filter(relation=>relation.subjectId===source.revisionId&&relation.type==='change_depends_on')).toEqual([]);
});
