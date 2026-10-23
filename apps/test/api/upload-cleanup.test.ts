import {afterEach,expect,it} from 'vitest';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {registerRecord} from '../../worker/src/lib/artifacts';
import {createRegulationChange,addRegulationFile} from '../../worker/src/lib/releases';
import {getKnowledgeContext} from '../../worker/src/lib/storage';

let env:TestEnvironment;
afterEach(async()=>env?.cleanup());
it.each(['record','regulation'])('%s upload removes its raw object when extracted-text storage fails',async kind=>{
 env=await createTestEnvironment();
 const actor=await env.select(kind==='record'?'author':'admin');
 const change=kind==='regulation'?await createRegulationChange(env.bindings,actor,{title:'합성 변경',requestKey:'open',expectedContext:await getKnowledgeContext(env.bindings)}) as any:undefined;
 const context=await getKnowledgeContext(env.bindings);
 const objects=(await env.bindings.SOURCES.list()).objects.map(object=>object.key).sort();
 const events=await env.bindings.DB.prepare('SELECT COUNT(*) n FROM events').first('n');
 const sources=env.bindings.SOURCES;
 env.bindings.SOURCES=new Proxy(sources,{get(target,property){
  if(property==='put')return async(key:string,...args:any[])=>{
   if(key.startsWith('text/'))throw new Error('INJECTED_TEXT_WRITE_FAILURE');
   return (target.put as any)(key,...args);
  };
  const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
 }});
 const common={file:new TextEncoder().encode('# 합성 업로드\n시험용 원문'),filename:'synthetic.md',documentCode:'TEST-CLEANUP',title:'합성 시험',requestKey:'upload',expectedContext:context};
 const upload=kind==='record'?registerRecord(env.bindings,actor,{...common,recordTypeIds:['test-F01'],scope:'',templateRevisionIds:['test-tpl-rev-1']}):addRegulationFile(env.bindings,actor,change.changeId,{...common,kind:'guide'});
 await expect(upload).rejects.toThrow('INJECTED_TEXT_WRITE_FAILURE');
 expect((await sources.list()).objects.map(object=>object.key).sort()).toEqual(objects);
 expect(await env.bindings.DB.prepare("SELECT COUNT(*) n FROM artifacts WHERE document_code='TEST-CLEANUP'").first('n')).toBe(0);
 expect(await env.bindings.DB.prepare('SELECT COUNT(*) n FROM events').first('n')).toBe(events);
 expect(await getKnowledgeContext(env.bindings)).toEqual(context);
});
