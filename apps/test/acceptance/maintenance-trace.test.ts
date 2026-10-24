import {expect,it} from 'vitest';
import type {GraphResult,Relation} from '../../packages/contracts/src/index';
import {verifyMaintenanceTrace} from './maintenance-rehearsal';

const hierarchy:Relation={id:'hierarchy',subjectId:'procedure',objectId:'manual',type:'subordinate_to',origin:'regulation',releaseId:'synthetic',reviewStatus:'validated',evidenceStatus:'verified',evidenceRefs:[{revisionId:'index',sourceSha256:'a'.repeat(64),lineStart:1,lineEnd:1,quote:'Synthetic procedure belongs to manual.'}]};
const conditional:Relation={...hierarchy,id:'conditional',subjectId:'activity',objectId:'record-type',type:'requires_record_type',condition:'If the synthetic service needs an external review.',conditionStatus:'unknown'};
function trace():Pick<GraphResult,'relations'|'excluded'|'unknown'>{return {relations:[hierarchy],excluded:[{id:'conditional',reason:'CONDITION_UNKNOWN'}],unknown:[{id:'conditional',reason:conditional.condition!}]};}

it('verifies hierarchy while preserving explicitly unresolved record applicability',()=>{
 const result=trace();
 expect(verifyMaintenanceTrace(result,[hierarchy,conditional])).toBe(true);
 expect(result.excluded).toEqual([{id:'conditional',reason:'CONDITION_UNKNOWN'}]);
 expect(result.unknown).toEqual([{id:'conditional',reason:'If the synthetic service needs an external review.'}]);
});
it.each(['SOURCE_UNAVAILABLE','SOURCE_CHANGED','RELATION_NOT_VALIDATED'])('rejects %s even on an optional record relation',reason=>{
 const result=trace();result.excluded[0].reason=reason;
 expect(()=>verifyMaintenanceTrace(result,[hierarchy,conditional])).toThrow();
});
it('rejects an unresolved hierarchy and missing hierarchy results',()=>{
 const result=trace();result.excluded=[{id:'hierarchy',reason:'CONDITION_UNKNOWN'}];result.unknown=[{id:'hierarchy',reason:'Unknown hierarchy'}];
 expect(()=>verifyMaintenanceTrace(result,[hierarchy,conditional])).toThrow();
 expect(()=>verifyMaintenanceTrace({...trace(),relations:[],excluded:[],unknown:[]},[hierarchy])).toThrow();
 expect(()=>verifyMaintenanceTrace(undefined,[hierarchy])).toThrow();
 expect(verifyMaintenanceTrace(undefined,[])).toBe(false);
});
it('only permits a declared, validated record applicability condition with matching unknown evidence',()=>{
 for(const change of [{type:'references' as const},{reviewStatus:'candidate' as const},{conditionStatus:'met' as const},{condition:undefined}])
  expect(()=>verifyMaintenanceTrace(trace(),[hierarchy,{...conditional,...change}])).toThrow();
 expect(()=>verifyMaintenanceTrace(trace(),[hierarchy])).toThrow();
 expect(()=>verifyMaintenanceTrace({...trace(),unknown:[]},[hierarchy,conditional])).toThrow();
 expect(()=>verifyMaintenanceTrace({...trace(),unknown:[{id:'conditional',reason:'Different condition'}]},[hierarchy,conditional])).toThrow();
});
