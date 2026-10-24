import {expect,it} from 'vitest';
import {diffItems} from '../../worker/src/lib/releases';
import type {Relation} from '../../packages/contracts/src/index';

const evidence={revisionId:'source-one',sourceSha256:'a'.repeat(64),lineStart:2,lineEnd:2,quote:'Synthetic requirement.'};
const relation:Relation={id:'relation-old',subjectId:'child',objectId:'parent',type:'subordinate_to',origin:'regulation',releaseId:'release-old',reviewStatus:'validated',evidenceStatus:'verified',evidenceRefs:[evidence]};
const relationKey=(item:Relation)=>JSON.stringify([item.subjectId,item.type,item.objectId,item.origin]);
const claim={id:'claim-one',heading:'1',text:'Synthetic requirement.',reviewStatus:'validated',evidenceRefs:[evidence]};
const wiki={id:'wiki-one',title:'Synthetic document',releaseId:'release-old',claims:[claim]};
function frozen<T>(value:T):T {if(value&&typeof value==='object'){Object.values(value).forEach(frozen);Object.freeze(value)}return value}

it('does not report an automatic candidate relation state as a definition change',()=>{
 const before=frozen(structuredClone(relation)),after=frozen({...structuredClone(relation),id:'relation-new',releaseId:'release-new',reviewStatus:'candidate' as const});
 expect(diffItems([before],[after],relationKey,['id','releaseId'],'relation')).toEqual({beforeCount:1,afterCount:1,added:[],removed:[],changed:[],unchanged:1});
 expect(before.reviewStatus).toBe('validated');expect(after.reviewStatus).toBe('candidate');
 // The automatic-state exception is limited to this candidate comparison mode.
 expect(diffItems([before],[after],relationKey,['id','releaseId']).changed).toHaveLength(1);
});
it.each([
 ['source revision',{evidenceRefs:[{...evidence,revisionId:'source-two'}]}],
 ['source hash',{evidenceRefs:[{...evidence,sourceSha256:'b'.repeat(64)}]}],
 ['exact quote',{evidenceRefs:[{...evidence,quote:'Different synthetic requirement.'}]}],
 ['line range',{evidenceRefs:[{...evidence,lineStart:3,lineEnd:3}]}],
 ['condition',{condition:'Additional control',conditionStatus:'unknown'}],
 ['rejected state',{reviewStatus:'rejected'}],
] as const)('keeps a real %s relation difference with complete original rows',(_name,patch)=>{
 const before=frozen(structuredClone(relation)),after=frozen({...structuredClone(relation),id:'relation-new',releaseId:'release-new',reviewStatus:'candidate',...patch} as Relation);
 const result=diffItems([before],[after],relationKey,['id','releaseId'],'relation');
 expect(result.changed).toHaveLength(1);expect(result.unchanged).toBe(0);expect(result.changed[0].before).toBe(before);expect(result.changed[0].after).toBe(after);expect(result.changed[0].after.reviewStatus).toBe(after.reviewStatus);
});
it('does not hide a rejected relation becoming a candidate',()=>{
 const before={...relation,reviewStatus:'rejected' as const},after={...relation,reviewStatus:'candidate' as const};
 expect(diffItems([before],[after],relationKey,['id','releaseId'],'relation').changed).toHaveLength(1);
});
it('preserves duplicate relation occurrences and additions or removals',()=>{
 const second={...relation,id:'second',evidenceRefs:[{...evidence,quote:'Second assertion.'}]},removed={...relation,id:'removed',objectId:'removed-parent'};
 const firstCandidate={...relation,reviewStatus:'candidate' as const},secondCandidate={...second,reviewStatus:'candidate' as const,evidenceRefs:[{...evidence,quote:'Changed second assertion.'}]},added={...relation,id:'added',objectId:'added-parent',reviewStatus:'candidate' as const};
 const result=diffItems([relation,second,removed],[firstCandidate,secondCandidate,added],relationKey,['id','releaseId'],'relation');
 expect(result).toMatchObject({beforeCount:3,afterCount:3,added:[added],removed:[removed],unchanged:1});expect(result.changed).toEqual([{key:relationKey(second)+':1',before:second,after:secondCandidate}]);
});
it('does not report automatic Wiki claim candidate states as content changes',()=>{
 const before=frozen(structuredClone(wiki)),after=frozen({...structuredClone(wiki),releaseId:'release-new',claims:[{...structuredClone(claim),reviewStatus:'candidate'}]});
 expect(diffItems([before],[after],item=>item.id,['releaseId'],'wiki')).toEqual({beforeCount:1,afterCount:1,added:[],removed:[],changed:[],unchanged:1});
 expect(before.claims[0].reviewStatus).toBe('validated');expect(after.claims[0].reviewStatus).toBe('candidate');
});
it.each([
 ['text',{text:'Changed synthetic requirement.'}],
 ['claim identity',{id:'claim-two'}],
 ['source revision',{evidenceRefs:[{...evidence,revisionId:'source-two'}]}],
 ['source hash',{evidenceRefs:[{...evidence,sourceSha256:'b'.repeat(64)}]}],
 ['quote',{evidenceRefs:[{...evidence,quote:'Changed synthetic quotation.'}]}],
 ['rejected state',{reviewStatus:'rejected'}],
])('keeps a real Wiki claim %s change and the complete review states',(_name,patch)=>{
 const before=frozen(structuredClone(wiki)),after=frozen({...structuredClone(wiki),releaseId:'release-new',claims:[{...structuredClone(claim),reviewStatus:'candidate',...patch}]});
 const result=diffItems([before],[after],item=>item.id,['releaseId'],'wiki');expect(result.changed).toHaveLength(1);expect(result.changed[0].before).toBe(before);expect(result.changed[0].after).toBe(after);
});
it('keeps rejected-to-candidate Wiki review transitions and claim order changes',()=>{
 const rejected={...wiki,claims:[{...claim,reviewStatus:'rejected'}]},candidate={...wiki,claims:[{...claim,reviewStatus:'candidate'}]};
 expect(diffItems([rejected],[candidate],item=>item.id,['releaseId'],'wiki').changed).toHaveLength(1);
 const other={...claim,id:'claim-two'},before={...wiki,claims:[claim,other]},after={...wiki,claims:[{...other,reviewStatus:'candidate'},{...claim,reviewStatus:'candidate'}]};
 expect(diffItems([before],[after],item=>item.id,['releaseId'],'wiki').changed).toHaveLength(1);
});
