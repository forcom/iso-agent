import {useState} from 'react';
import type {AppointmentSourceCandidate,AssignmentMapping,FunctionalRole,Person,RoleAssignment} from '../../../packages/contracts/src/index';
import {useDirty} from '../session';
import type {Evidence} from '../api';
import {EvidenceList} from './ui';

export interface AssignmentOptions {persons:Person[];roles:FunctionalRole[];systems:{id:string;label:string}[];resources:{id:string;title:string}[];items:RoleAssignment[]}
export function AssignmentMappingForm({candidate,options,busy,disabled=false,onApply}:{candidate:AppointmentSourceCandidate;options:AssignmentOptions;busy:boolean;disabled?:boolean;onApply:(mapping:AssignmentMapping)=>Promise<void>}) {
 const [personId,setPerson]=useState(''),[roleIds,setRoles]=useState<string[]>([]),[scope,setScope]=useState<RoleAssignment['scope']>({kind:'all',ids:[]});
 const [reason,setReason]=useState(''),[checked,setChecked]=useState(false),[replacements,setReplacements]=useState<Record<string,string>>({});
 useDirty(Boolean(personId||reason));
 const existing=options.items.filter(item=>item.personId===personId&&item.status==='active');
 const sameScope=(item:RoleAssignment)=>item.scope.kind===scope.kind&&[...item.scope.ids].sort().join('\n')===[...scope.ids].sort().join('\n');
 const duplicates=existing.filter(item=>roleIds.includes(item.roleId)&&sameScope(item)&&replacements[item.roleId]!==item.id);
 const invalid=Boolean(candidate.blockedReason)||!personId||!roleIds.length||!reason.trim()||!checked||(scope.kind!=='all'&&!scope.ids.length)||duplicates.length>0;
 return <form aria-label={`${candidate.sectionId} ${candidate.kind==='delegation'?'대리 지정 근거':'한글 지정 대조'}`} className="stack" onSubmit={async event=>{event.preventDefault();if(invalid||busy||disabled)return;await onApply({candidateId:candidate.id,personId,roleIds,validFrom:candidate.validFrom!,...(candidate.validUntil?{validUntil:candidate.validUntil}:{}),scope,reason,replacesAssignmentIds:Object.fromEntries(Object.entries(replacements).filter(([role,id])=>roleIds.includes(role)&&id))})}}>
  <h3>{candidate.sectionId} · {candidate.label}{candidate.kind==='delegation'?' · 대리 후보':''}</h3>
  <dl className="metadata"><dt>원문 담당자</dt><dd>{candidate.personText}</dd><dt>업무</dt><dd>{candidate.roleText}</dd><dt>범위</dt><dd>{candidate.scopeText}</dd><dt>지정 기간</dt><dd>{candidate.periodText}</dd></dl>
  <details><summary>원문 행과 인용 대조</summary><EvidenceList items={candidate.evidenceRefs as Evidence[]}/></details>
  {candidate.blockedReason?<p className="notice" role="status">{candidate.blockedReason}</p>:<>
   <label>대상 직원<select aria-label="대상 직원" required value={personId} onChange={event=>{setPerson(event.target.value);setRoles([]);setReplacements({});setChecked(false)}}><option value="">원문 담당자와 대조할 직원 선택</option>{options.persons.filter(person=>candidate.personIds.includes(person.id)).map(person=><option key={person.id} value={person.id}>{person.name} · {person.department??person.id}</option>)}</select></label>
   <label>기능상 역할<select aria-label="기능상 역할" multiple required value={roleIds} onChange={event=>{setRoles(Array.from(event.target.selectedOptions,option=>option.value));setChecked(false)}}>{options.roles.map(role=><option key={role.id} value={role.id}>{role.name} · {role.id}</option>)}</select><small>원문 업무가 여러 기능상 역할에 해당하면 함께 선택하세요.</small></label>
   <div className="form-grid"><label>지정 시작 시각<input readOnly value={candidate.validFrom??''}/></label><label>지정 종료 시각<input readOnly value={candidate.validUntil??'종료일 없음'}/></label></div>
   <label>적용 범위<select aria-label="적용 범위" value={scope.kind} onChange={event=>{setScope({kind:event.target.value as RoleAssignment['scope']['kind'],ids:[]});setChecked(false)}}><option value="all">전체</option><option value="system">AI 시스템</option><option value="resource">자료</option></select></label>
   {scope.kind!=='all'&&<label>범위 대상<select aria-label="범위 대상" multiple required value={scope.ids} onChange={event=>{setScope({...scope,ids:Array.from(event.target.selectedOptions,option=>option.value)});setChecked(false)}}>{(scope.kind==='system'?options.systems.map(item=>({id:item.id,title:item.label})):options.resources).map(item=><option key={item.id} value={item.id}>{item.title} · {item.id}</option>)}</select></label>}
   {roleIds.map(roleId=>{const prior=existing.filter(item=>item.roleId===roleId);return prior.length?<section key={roleId}><strong>{options.roles.find(role=>role.id===roleId)?.name}</strong>{prior.some(sameScope)&&<p className="notice">이미 유효 — 적용 생략</p>}<label>교체할 기존 지정<select aria-label={`${roleId} 교체 대상`} value={replacements[roleId]??''} onChange={event=>{setReplacements({...replacements,[roleId]:event.target.value});setChecked(false)}}><option value="">교체하지 않음</option>{prior.filter(item=>!item.grantsAdmin).map(item=><option key={item.id} value={item.id}>{item.id} · {item.scope.kind}</option>)}</select></label><details><summary>기존 지정 근거</summary>{prior.map(item=><EvidenceList key={item.id} items={item.evidenceRefs as Evidence[]}/>)}</details></section>:null})}
   <label>역할·범위 대응 사유<textarea required rows={3} maxLength={2000} value={reason} onChange={event=>{setReason(event.target.value);setChecked(false)}}/></label>
   <label className="checkbox"><input type="checkbox" checked={checked} onChange={event=>setChecked(event.target.checked)}/>원문과 직원·역할·기간·범위를 대조했습니다.</label>
   <button className="primary" disabled={invalid||busy||disabled}>대조한 지정 적용</button>
  </>}
 </form>;
}
