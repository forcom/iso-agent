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
