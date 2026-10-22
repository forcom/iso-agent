import {it,expect,afterEach} from 'vitest';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {provisionFictionalPersonnel,type FictionalPersonnelInput} from '../../worker/src/lib/personnel';
import {all,getKnowledgeContext} from '../../worker/src/lib/storage';
import {authorize,snapshot} from '../../worker/src/lib/engine';
import {resolveActor,sessionView} from '../../worker/src/routes/session';
import {selectGrounding} from '../../worker/src/lib/llm';
import {canonical,sha256} from '../../packages/knowledge/src/index';
let test:TestEnvironment;afterEach(async()=>test?.cleanup());
const text='# Fictional test setup\n| P01 | Synthetic Person | Synthetic team | Synthetic role | 없음 | 시험 author | 예 | Synthetic source |\n';
function input():FictionalPersonnelInput{return {fictional:true,configurationId:'synthetic-personnel',authorizedAt:'2026-01-01T00:00:00Z',authorizationReference:'https://github.com/example/example/issues/2',persons:[{personaId:'P01',name:'Synthetic Person',department:'Synthetic team',jobTitle:'Synthetic role',reportsTo:null,admin:true,roles:[{name:'시험 author',scope:'all'}]}],sources:['company_profile','personas','assignment_configuration'].map(kind=>({kind:kind as FictionalPersonnelInput['sources'][0]['kind'],path:`synthetic/${kind}.md`,title:'Synthetic source',markdown:text}))}}
async function emptyPeople(){test=await createTestEnvironment();await test.bindings.DB.prepare('DELETE FROM assignments').run();await test.bindings.DB.prepare('DELETE FROM persons').run();test.bindings.ALLOW_FICTIONAL_PERSONNEL='true'}
it('adds explicit fictional personnel once, keeps knowledge and decisions, verifies role through the actual engine',async()=>{
 await emptyPeople();const before=await getKnowledgeContext(test.bindings),result=await provisionFictionalPersonnel(test.bindings,input());expect(result.personCount).toBe(1);expect(result.assignmentCount).toBe(1);
 expect(result.context.releaseId).toBe(before.releaseId);expect(result.context.authorityRevision).toBe(before.authorityRevision+1);
 expect((await all(test.bindings,'decisions')).length).toBe(0);
 const person=(await all<any>(test.bindings,'persons'))[0],selected=await test.select(person.id),actor=await resolveActor(test.bindings,selected.sessionId);expect(actor.isAdmin).toBe(true);
 const view=await sessionView(test.bindings,actor);expect(view.actor.fictional).toBe(true);expect(view.roles[0].roleName).toBe('시험 author');
 expect((await authorize(test.bindings,actor,'create',{typeIds:['test-F01'],state:'new'},await getKnowledgeContext(test.bindings))).allowed).toBe(true);
 expect((await snapshot(test.bindings,await getKnowledgeContext(test.bindings))).assignments[0].status).toBe('active');
 expect((await selectGrounding(test.bindings,await getKnowledgeContext(test.bindings))).excluded).toHaveLength(3);
 expect((await provisionFictionalPersonnel(test.bindings,input())).alreadyApplied).toBe(true);expect(await getKnowledgeContext(test.bindings)).toEqual(result.context);
 const changed=input();changed.persons[0].name='Changed';await expect(provisionFictionalPersonnel(test.bindings,changed)).rejects.toMatchObject({status:409});
});
it('rejects flag-off and source mismatch before writes and rolls back a D1 failure',async()=>{
 await emptyPeople();test.bindings.ALLOW_FICTIONAL_PERSONNEL='false';await expect(provisionFictionalPersonnel(test.bindings,input())).rejects.toMatchObject({status:403});test.bindings.ALLOW_FICTIONAL_PERSONNEL='true';
 const wrong=input();wrong.persons[0].roles[0].name='unknown';await expect(provisionFictionalPersonnel(test.bindings,wrong)).rejects.toMatchObject({status:422});
 const before=await getKnowledgeContext(test.bindings);await test.bindings.DB.prepare("CREATE TRIGGER personnel_failure BEFORE INSERT ON assignments BEGIN SELECT RAISE(ABORT,'INJECTED_PERSONNEL_FAILURE'); END").run();
 await expect(provisionFictionalPersonnel(test.bindings,input())).rejects.toThrow('INJECTED_PERSONNEL_FAILURE');expect(await all(test.bindings,'persons')).toHaveLength(0);expect(await getKnowledgeContext(test.bindings)).toEqual(before);expect(await all(test.bindings,'decisions')).toHaveLength(0);
});
it.each([
 ['scope','| 시험 author |','| 시험 author(Edu Score) |'],
 ['administrator','| 예 |','| 아니오 |'],
 ['department','| Synthetic team |','| Other team |'],
 ['job title','| Synthetic role |','| Other role |'],
 ['reporting line','| 없음 |','| P02 Other Person |'],
])('rejects a configuration table with mismatched %s without installing personnel',async(_field,before,after)=>{
 await emptyPeople();const beforeContext=await getKnowledgeContext(test.bindings),value=input();
 value.sources.find(source=>source.kind==='assignment_configuration')!.markdown=text.replace(before,after);
 await expect(provisionFictionalPersonnel(test.bindings,value)).rejects.toMatchObject({status:422,code:'PERSONNEL_SOURCE_MISMATCH'});
 expect(await all(test.bindings,'persons')).toHaveLength(0);expect(await all(test.bindings,'assignments')).toHaveLength(0);expect(await getKnowledgeContext(test.bindings)).toEqual(beforeContext);
});
it('accepts exact organization rows with reporting lines, multiple roles and an Edu Score scope',async()=>{
 await emptyPeople();test.bundle.entities.push({id:'synthetic-edu-score',type:'AISystem',label:'Edu Score',evidenceRefs:[],metadata:{synthetic:true,actualOperation:false}});
 test.bundle.manifest.manifestHash='';test.bundle.manifest.manifestHash=await sha256(canonical(test.bundle));
 await test.bindings.SOURCES.put('releases/test-release.json',JSON.stringify(test.bundle));
 await test.bindings.DB.prepare('UPDATE releases SET body=? WHERE id=?').bind(JSON.stringify(test.bundle.manifest),test.bundle.manifest.releaseId).run();
 const value=input();value.persons=[{personaId:'P01',name:'Synthetic Leader',department:'Synthetic management',jobTitle:'Lead / coordinator',reportsTo:null,admin:false,roles:[{name:'시험 author',scope:'all'}]},{personaId:'P02',name:'Synthetic Person',department:'Synthetic operations',jobTitle:'Coordinator / reviewer',reportsTo:'P01',admin:true,roles:[{name:'시험 author',scope:'all'},{name:'시험 reviewer',scope:'edu-score'}]}];
 const rows='# Fictional test setup\n| P01 | Synthetic Leader | Synthetic management | Lead / coordinator | 없음 | 시험 author | 아니오 | Synthetic source |\n| P02 | Synthetic Person | Synthetic operations | Coordinator / reviewer | P01 Synthetic Leader | 시험 author, 시험 reviewer(Edu Score) | 예 | Synthetic source |\n';
 value.sources=value.sources.map(source=>({...source,markdown:rows}));
 const result=await provisionFictionalPersonnel(test.bindings,value);expect(result.personCount).toBe(2);expect(result.assignmentCount).toBe(3);
 const people=await all<any>(test.bindings,'persons'),leader=people.find(person=>person.personaId==='P01'),reviewer=people.find(person=>person.personaId==='P02');
 expect(reviewer.reportsToId).toBe(leader.id);expect(reviewer.isAdmin).toBe(true);
 expect((await all<any>(test.bindings,'assignments')).find(assignment=>assignment.roleId==='reviewer')?.scope).toEqual({kind:'system',ids:['synthetic-edu-score']});
});
