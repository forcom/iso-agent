import {describe, expect, it} from 'vitest';
import {nextOccurrence, parseResearchDefinition} from '../../worker/src/research/schedule';

const definition = {
 title:'합성 AI 공격 동향', purpose:'합성 시스템의 외부 이슈 초안', instruction:'environment',
 targets:'합성 AI 서비스', jurisdiction:'KR', keywords:['AI 공격'], sources:['https://example.org/advisories'],
 recordTypeIds:['test-F01'], fields:['외부 이슈'], systemId:'', assigneeId:'author',
 periodStart:'2026-01-01', periodEnd:'2026-01-31', maxSources:10,
 timing:{kind:'daily',time:'09:00',startDate:'2026-01-01',endDate:''},
};
describe('ERP research timing',()=>{
 it.each([
  [{kind:'daily',time:'09:00',startDate:'2026-01-01',endDate:''},'2026-01-01T00:00:00.000Z','2026-01-02T00:00:00.000Z'],
  [{kind:'weekly',time:'08:30',weekday:1,startDate:'2026-01-01',endDate:''},'2026-01-04T23:30:00.000Z','2026-01-11T23:30:00.000Z'],
  [{kind:'monthly',time:'09:00',day:31,startDate:'2026-01-01',endDate:''},'2026-01-31T00:00:00.000Z','2026-02-28T00:00:00.000Z'],
  [{kind:'monthly',time:'09:00',day:31,startDate:'2028-01-01',endDate:''},'2028-01-31T00:00:00.000Z','2028-02-29T00:00:00.000Z'],
  [{kind:'daily',time:'00:00',startDate:'2026-02-01',endDate:'2026-02-01'},'2026-01-01T00:00:00.000Z','2026-01-31T15:00:00.000Z'],
  [{kind:'daily',time:'00:00',startDate:'2026-02-01',endDate:'2026-02-01'},'2026-01-31T15:00:00.000Z',null],
  [{kind:'manual'},'2026-01-01T00:00:00.000Z',null],
  [{kind:'three_hourly',time:'00:00',startDate:'2026-01-01',endDate:''},'2025-12-31T14:59:59.000Z','2025-12-31T15:00:00.000Z'],
  [{kind:'three_hourly',time:'00:00',startDate:'2026-01-01',endDate:''},'2025-12-31T15:00:00.000Z','2025-12-31T18:00:00.000Z'],
  [{kind:'three_hourly',time:'09:30',startDate:'2026-01-01',endDate:''},'2026-01-01T14:31:00.000Z','2026-01-01T15:30:00.000Z'],
  [{kind:'three_hourly',time:'00:00',startDate:'2026-01-01',endDate:''},'2030-01-01T02:30:00.000Z','2030-01-01T03:00:00.000Z'],
  [{kind:'three_hourly',time:'00:00',startDate:'2026-01-01',endDate:'2026-01-01'},'2026-01-01T11:59:59.000Z','2026-01-01T12:00:00.000Z'],
  [{kind:'three_hourly',time:'00:00',startDate:'2026-01-01',endDate:'2026-01-01'},'2026-01-01T12:00:00.000Z',null],
 ] as const)('calculates the next slot without repeating the current one (%j)',(timing,after,want)=>{
  expect(nextOccurrence(timing,after)).toBe(want);
 });
 it('validates actual dates, bounds, known instructions, and public HTTPS sources',()=>{
  expect(parseResearchDefinition(definition).title).toBe('합성 AI 공격 동향');
  for(const change of [{timing:{...definition.timing,time:'24:00'}},{timing:{...definition.timing,startDate:'2026-02-30'}},{timing:{...definition.timing,endDate:'2025-01-01'}},{maxSources:0},{maxSources:101},{instruction:'invented'},{sources:['http://127.0.0.1/private']},{sources:['https://user:password@example.org/']},{periodEnd:'2025-01-01'},{recordTypeIds:[]},{fields:[]}]) {
   expect(()=>parseResearchDefinition({...definition,...change})).toThrow();
  }
 });
 it('accepts only bounded lists and normalized independent input',()=>{
  const value=parseResearchDefinition({...definition,title:'  조사  ',recordTypeIds:['test-F01','test-F01']});
  expect(value.title).toBe('조사');expect(value.recordTypeIds).toEqual(['test-F01']);
  expect(()=>parseResearchDefinition({...definition,keywords:Array(101).fill('x')})).toThrow();
 });
 it('accepts a three-hour schedule and rejects an invalid anchor',()=>{
  const timing={kind:'three_hourly',time:'06:15',startDate:'2026-01-01',endDate:''};
  expect(parseResearchDefinition({...definition,timing}).timing).toEqual(timing);
  expect(()=>parseResearchDefinition({...definition,timing:{...timing,time:'24:00'}})).toThrow();
 });
});
