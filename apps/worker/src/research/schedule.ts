import {ApiError, requireValue, stringList, textField} from '../lib/errors';
import {researchInstructions} from './catalog';
import type {ResearchDefinition,ResearchTiming} from './types';

const dayMs=86400000, offset=9*3600000;
function date(value:unknown,name:string,optional=false):string {
 if(optional&&value==='')return '';
 const s=textField(value,name,10);
 requireValue(/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s,422,'INVALID_INPUT',`${name} 날짜를 확인해 주세요.`);
 return s;
}
function list(value:unknown,name:string,min=0,max=100) {
 requireValue(Array.isArray(value)&&value.length<=max,422,'INVALID_INPUT',`${name}은 최대 ${max}개입니다.`);
 const items=stringList(value,name).map(item=>textField(item,name,200));
 requireValue(items.length>=min,422,'INVALID_INPUT',`${name}을 선택해 주세요.`);return [...new Set(items)];
}
export function publicSourceUrl(input:unknown):string {
 const value=textField(input,'출처 URL',2000);let url:URL;
 try{url=new URL(value)}catch{throw new ApiError(422,'INVALID_INPUT','올바른 출처 URL이 필요합니다.')}
 requireValue(url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&url.hostname.includes('.')&&!/^[\d.]+$/.test(url.hostname)&&!url.hostname.includes(':')&&!/(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname),422,'INVALID_INPUT','공개 HTTPS 출처 URL을 사용해 주세요.');
 return url.href;
}
export function parseResearchDefinition(input:unknown):ResearchDefinition {
 requireValue(input&&typeof input==='object'&&!Array.isArray(input),422,'INVALID_INPUT','조사 설정 객체가 필요합니다.');
 const v=input as Record<string,unknown>, raw=v.timing as Record<string,unknown>;
 requireValue(raw&&['manual','daily','weekly','monthly'].includes(String(raw.kind)),422,'INVALID_INPUT','실행 주기를 선택해 주세요.');
 let timing:ResearchTiming={kind:'manual'};
 if(raw.kind!=='manual'){
  const time=textField(raw.time,'실행 시각',5),startDate=date(raw.startDate,'시작일'),endDate=date(raw.endDate??'','종료일',true);
  requireValue(/^([01]\d|2[0-3]):[0-5]\d$/.test(time)&&(!endDate||endDate>=startDate),422,'INVALID_INPUT','실행 시각과 시작·종료일을 확인해 주세요.');
  timing={kind:raw.kind as 'daily'|'weekly'|'monthly',time,startDate,endDate};
  if(raw.kind==='weekly'){requireValue(Number.isInteger(raw.weekday)&&Number(raw.weekday)>=0&&Number(raw.weekday)<=6,422,'INVALID_INPUT','요일을 선택해 주세요.');timing.weekday=Number(raw.weekday)}
  if(raw.kind==='monthly'){requireValue(Number.isInteger(raw.day)&&Number(raw.day)>=1&&Number(raw.day)<=31,422,'INVALID_INPUT','월별 날짜는 1~31일입니다.');timing.day=Number(raw.day)}
 }
 const instruction=textField(v.instruction,'조사 지침',80);
 requireValue(researchInstructions.some(item=>item.id===instruction),422,'INVALID_INPUT','등록된 조사 지침을 선택해 주세요.');
 const periodStart=date(v.periodStart,'조사 시작일'),periodEnd=date(v.periodEnd,'조사 종료일');
 requireValue(periodEnd>=periodStart,422,'INVALID_INPUT','조사 종료일은 시작일 이후여야 합니다.');
 requireValue(Number.isInteger(v.maxSources)&&Number(v.maxSources)>=1&&Number(v.maxSources)<=100,422,'INVALID_INPUT','출처 한도는 1~100개입니다.');
 requireValue(Array.isArray(v.sources)&&v.sources.length<=50,422,'INVALID_INPUT','출처는 최대 50개입니다.');
 return {title:textField(v.title,'업무명',200),purpose:textField(v.purpose,'조사 목적',4000),instruction,
  targets:textField(v.targets,'조사 대상',2000),jurisdiction:textField(v.jurisdiction,'국가·적용 범위',200),
  keywords:list(v.keywords,'검색어'),sources:[...new Set(v.sources.map(publicSourceUrl))],recordTypeIds:list(v.recordTypeIds,'기록 유형',1,60),
  fields:list(v.fields,'조사 항목',1,60),systemId:typeof v.systemId==='string'?v.systemId:'',assigneeId:typeof v.assigneeId==='string'?v.assigneeId:'',
  periodStart,periodEnd,maxSources:Number(v.maxSources),timing};
}
/** Korea has no DST; compute local calendar dates with UTC accessors, then subtract UTC+09. */
export function nextOccurrence(timing:ResearchTiming,after:string):string|null {
 if(timing.kind==='manual')return null;
 const instant=Date.parse(after);requireValue(Number.isFinite(instant),422,'INVALID_INPUT','기준 시각을 확인해 주세요.');
 const [hour,minute]=timing.time.split(':').map(Number), time=(hour*60+minute)*60000;
 let local=new Date(Math.max(instant+offset,Date.parse(timing.startDate)));
 local=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()));
 for(let i=0;i<370;i++){
  const dateKey=local.toISOString().slice(0,10);if(timing.endDate&&dateKey>timing.endDate)return null;
  const lastDay=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth()+1,0)).getUTCDate();
  const matches=timing.kind==='daily'||timing.kind==='weekly'&&local.getUTCDay()===timing.weekday||timing.kind==='monthly'&&local.getUTCDate()===Math.min(timing.day!,lastDay);
  const candidate=local.getTime()+time-offset;
  if(matches&&candidate>instant)return new Date(candidate).toISOString();
  local=new Date(local.getTime()+dayMs);
 }
 return null;
}
