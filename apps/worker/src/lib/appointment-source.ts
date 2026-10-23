import type { AppointmentSourceCandidate, Person } from '../../../packages/contracts/src/index';
import type { Revision } from '../types';
import { sha256 } from './markdown';

export async function candidateId(revisionId:string,line:number,quote:string) {
 const hash=await sha256(`${revisionId}\n${line}\n${quote}`);
 return `${hash.slice(0,8)}-${hash.slice(8,12)}-8${hash.slice(13,16)}-${((parseInt(hash[16],16)&3)|8).toString(16)}${hash.slice(17,20)}-${hash.slice(20,32)}`;
}
const cells=(line:string)=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(value=>value.trim());
function koreanDate(value:string):string|undefined {
 const match=value.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./);if(!match)return;
 const [,year,month,day]=match,iso=`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}T00:00:00+09:00`;
 if(Number(month)<1||Number(month)>12||Number(day)<1||Number(day)>new Date(Date.UTC(Number(year),Number(month),0)).getUTCDate())return;
 return iso;
}
function hasName(text:string,name:string) {
 const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`,'u').test(text);
}

export async function appointmentSourceCandidates(markdown:string,revision:Revision,persons:Person[]):Promise<AppointmentSourceCandidate[]> {
 const lines=markdown.split('\n'),visible:string[]=[],summary=new Map<string,{line:number;text:string}>();let fence='';
 for(const line of lines){const delimiter=line.trim().match(/^(`{3,}|~{3,})/)?.[1];if(delimiter){if(!fence)fence=delimiter;else if(fence[0]===delimiter[0]&&delimiter.length>=fence.length)fence='';visible.push('')}else visible.push(fence?'':line)}
 for(let i=0;i<visible.length;i++){const row=cells(visible[i]);if(/^R-\d+$/.test(row[0])&&/지정 불요|비해당/.test(row[2]??''))summary.set(row[0],{line:i,text:lines[i]})}
 const candidates:AppointmentSourceCandidate[]=[];
 for(let start=0;start<visible.length;start++){
  const heading=visible[start].match(/^###\s+(R-\d+)\s+(.+)$/);if(!heading)continue;
  let end=start+1;while(end<visible.length&&!/^#{1,3}\s/.test(visible[end]))end++;
  const fields=new Map<string,string>();let duplicate=false;
  for(const line of visible.slice(start+1,end)){if(!line.trim().startsWith('|'))continue;const [name,value,...extra]=cells(line);if(!name||name==='항목'||/^[-:]+$/.test(name))continue;if(fields.has(name)||extra.length)duplicate=true;fields.set(name,value??'')}
  const personText=fields.get('담당자·부서')??'',roleText=fields.get('역할·담당 업무')??'',scopeText=fields.get('위임·승인·접근 범위')??'',periodText=fields.get('지정·해제일')??'';
  const excluded=summary.get(heading[1]);
  const quote=lines.slice(start,end).join('\n'),evidenceRefs=[{revisionId:revision.id,sourceSha256:revision.sourceSha256,lineStart:start+1,lineEnd:end,quote}];
  if(excluded)evidenceRefs.push({revisionId:revision.id,sourceSha256:revision.sourceSha256,lineStart:excluded.line+1,lineEnd:excluded.line+1,quote:excluded.text});
  const holderText=personText.split(/(?:\s*\/\s*|\s*\(\s*|\s*[,;]\s*)(?:팀장|보고\s*대상)/)[0];
  const personIds=persons.filter(person=>person.active&&hasName(holderText,person.name)).map(person=>person.id);
  const dates=[...periodText.matchAll(/\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\./g)].map(match=>koreanDate(match[0]));
  const definitePeriod=/^\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*지정(?:\s*\/\s*(?:해제일 없음|\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*해제))?$/.test(periodText);
  const validFrom=dates[0],validUntil=dates.length===2&&/해제/.test(periodText)?dates[1]:undefined;
  const blockedReason=excluded?'요약표에 지정 불요·비해당으로 기재되어 있습니다.':duplicate?'상세표의 중복 항목·열을 확인해야 합니다.':!personIds.length?'담당자 이름과 일치하는 활성 직원이 없습니다.':/후보 지정|미충족|교육 이수 후|교육 이수 확인|완료 시|확인 후|충족 시/.test([roleText,scopeText,periodText,fields.get('요구 역량·충족 증거')].join(' '))?'후보 지정 또는 미충족 조건이 있어 적용할 수 없습니다.':/지정 보류|미확정|해당 없음/.test(personText+' '+scopeText)?'지정 여부·범위가 확정되지 않았습니다.':!roleText||!scopeText||!definitePeriod||!validFrom||dates.some(date=>!date)||dates.length>2||(dates.length===2&&!validUntil)||(/해제/.test(periodText)&&!validUntil&&!/해제일 없음/.test(periodText))?'명확한 역할·범위·지정 기간이 필요합니다.':undefined;
  const base={sectionId:heading[1],label:heading[2],personText,roleText,scopeText,periodText,personIds,validFrom,validUntil,evidenceRefs};
  candidates.push({...base,id:await candidateId(revision.id,start+1,quote),kind:'appointment',...(blockedReason?{blockedReason}:{})});
  // shortcut: 한글 대리는 별도 검증한 지정 기록으로 적용; 명시적 위임 기간·범위가 있는 문서 지원 시 확장한다.
  const deputy=fields.get('↳ 대리자·역할');
  if(deputy&&!/해당 없음|대리 불가/.test(deputy))candidates.push({...base,id:await candidateId(revision.id,start+1,quote+'\ndelegation'),kind:'delegation',personText:deputy,periodText:fields.get('↳ 대리 시작일·종료일·범위')??'',personIds:persons.filter(person=>person.active&&hasName(deputy,person.name)).map(person=>person.id),blockedReason:'대리의 정확한 기간·범위와 기존 위임 근거를 확인한 별도 지정 기록이 필요합니다.'});
  start=end-1;
 }
 return candidates;
}
