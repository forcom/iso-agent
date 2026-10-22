#!/usr/bin/env node
/** Compile reviewed source summaries and exact excerpts into the existing seed. */
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFile(resolve(root, p), 'utf8');
const hash = (text) => createHash('sha256').update(text).digest('hex');
const seed = JSON.parse(await read('seed/example-persons-roles.json'));
const curation = JSON.parse(await read('seed/wiki-curation.json'));
const entities = new Map(seed.entities.map(e => [e.id, e]));
const facts = new Map(seed.facts.map(f => [f.id, f]));
const approvedFacts = seed.facts.filter(f => f.status === 'approved' || f.status === 'auto_approved');
const approvedFactIds = new Set(approvedFacts.map(f => f.id));
const documents = new Map();
const wikiId = id => `wiki:doc:${id}`;
const topics = [
  ['document-hierarchy', '문서 체계와 규범·기록의 구분', ['AIDU-AIM-01-01','AIDU-AIP-00','AIDU-AIG-00']],
  ['context-leadership', '조직상황·리더십·역할', ['AIDU-AIM-01-03','AIDU-AIM-01-04','AIDU-AIP-04-01','AIDU-AIP-05-01','AIDU-AIP-05-02']],
  ['risk-impact', '리스크·영향평가·잔여 리스크 수용', ['AIDU-AIM-01-05','AIDU-AIP-06-01','AIDU-AIP-06-02','AIDU-AIG-08-01']],
  ['planning-resources', '목표·변경 기획·자원·역량', ['AIDU-AIM-01-05','AIDU-AIM-01-06','AIDU-AIP-06-03','AIDU-AIP-07-01','AIDU-AIP-07-02']],
  ['document-evidence', '문서·양식·운영 증거 관리', ['AIDU-AIM-01-06','AIDU-AIP-07-03','AIDU-AIG-08-01']],
  ['lifecycle-data', 'AI 수명주기·데이터·검증·운영', ['AIDU-AIM-01-07','AIDU-AIP-08-01','AIDU-AIG-08-02']],
  ['performance-improvement', '성과평가·심사·경영검토·개선', ['AIDU-AIM-01-08','AIDU-AIP-09-01','AIDU-AIP-09-02','AIDU-AIP-09-03','AIDU-AIP-10-01']],
];
const expectedPaths = [];
for (const dir of ['manual','procedure','guide']) {
  for (const name of (await readdir(resolve(root, 'docs', dir))).filter(n => n.endsWith('.md'))) expectedPaths.push(`docs/${dir}/${name}`);
}
assert.deepEqual(curation.documents.map(d => d.path).sort(), expectedPaths.sort(), 'curation must cover all source documents');
for (const doc of curation.documents) {
  const text = await read(doc.path);
  assert.equal(hash(text), doc.source_sha, `${doc.path}: source changed; review its summary and mappings before re-ingest`);
  documents.set(doc.id, { ...doc, text, lines: text.split('\n') });
}
function cite(doc, quote, text, heading, factIds = []) {
  const at = doc.text.indexOf(quote);
  assert(at >= 0 && quote.length, `quote not found in ${doc.id}`);
  return { heading, text, quote, source_document_id: doc.id,
    source_ref: `${doc.path}#L${doc.text.slice(0, at).split('\n').length}`,
    source_sha: doc.source_sha, fact_ids: [...new Set(factIds)] };
}
function excerpt(doc, start) {
  // Descend into the first child clause, but stop before a sibling/parent clause.
  let depth = doc.lines[start].match(/^#+/)[0].length;
  let i = start + 1;
  while (i < doc.lines.length) {
    if (!doc.lines[i].trim()) { i++; continue; }
    const next = doc.lines[i].match(/^(#+) /);
    if (!next) break;
    if (next[1].length <= depth) return doc.lines.slice(start,i).join('\n').trim();
    depth = next[1].length;
    i++;
  }
  while (i < doc.lines.length && !/^#+ /.test(doc.lines[i])) i++;
  return doc.lines.slice(start, i).join('\n').trim();
}
function overview(doc) {
  let start;
  if (doc.id === 'AIDU-AIM-01-01') start = doc.lines.findIndex(l => l === '### 문서 계층');
  else if (doc.id.startsWith('AIDU-AIM-') && doc.id !== 'AIDU-AIM-01-02') start = doc.lines.findIndex(l => /^### \d+\.0\.1 /.test(l));
  else start = doc.lines.findIndex(l => /^#{2,3} 1\.1(?:\.1)? /.test(l));
  assert(start >= 0, `overview missing: ${doc.id}`);
  return cite(doc, excerpt(doc,start), doc.summary, '문서의 역할과 적용');
}
const pages = [];
for (const doc of documents.values()) {
  const outgoing = approvedFacts.filter(f => f.subject === `doc:${doc.id}`);
  const claims = [overview(doc)];
  // Whole section titles provide navigation; excerpts illustrate actual operative requirements.
  let sectionStarts = doc.lines.flatMap((line,i) => /^## /.test(line) && (
    doc.id.startsWith('AIDU-AIM-') ? /^## (?:[4-9]|10)\.[1-9] /.test(line) && !/관련\s*문서/.test(line) : /^## 4\./.test(line)
  ) ? [i] : []);
  if (doc.id.endsWith('-00')) sectionStarts = doc.lines.flatMap((l,i) => /^## 1\.[2-5] /.test(l) ? [i] : []);
  const headings = sectionStarts.map(i => doc.lines[i].replace(/^## /,''));
  for (const i of sectionStarts) {
    const heading = doc.lines[i].replace(/^## /,'');
    claims.push(cite(doc, excerpt(doc,i), `이 절은 ${heading.replace(/^\d+(?:\.\d+)* /,'')}의 실행 기준을 다룬다. 아래 인용은 해당 절의 첫 기준이며 세부 조건은 원문에서 확인한다.`, heading));
  }
  if (doc.id === 'AIDU-AIG-08-02') {
    const i = doc.lines.findIndex(l => l.startsWith('### 4.3.3 '));
    claims.push(cite(doc, excerpt(doc,i), '외부 API 전송 전 가명처리의 구체적 수행 순서와 확인 기준을 적용한다.', '외부 API 전송 전 가명처리'));
  }
  if (outgoing.length) {
    const supported = outgoing.find(f => f.quote && documents.has(f.source_document_id));
    if (supported) {
      const source = documents.get(supported.source_document_id);
      claims.push(cite(source, supported.quote, outgoing.map(f => `- ${f.subject} → ${f.predicate} → ${f.object}`).join('\n'),
        '온톨로지 연결 (문서 관계·증거 후보)', outgoing.map(f => f.id)));
    }
  }
  const topicIds = topics.filter(t => t[2].includes(doc.id)).map(t => `wiki:aims:${t[0]}`);
  const relatedDocs = new Set(outgoing.filter(f => f.object.startsWith('doc:')).map(f => f.object.slice(4)));
  for (const other of approvedFacts.filter(f => f.object === `doc:${doc.id}` && f.subject.startsWith('doc:'))) relatedDocs.add(other.subject.slice(4));
  pages.push({ id: wikiId(doc.id), title: entities.get(`doc:${doc.id}`).name, status: 'approved', claims,
    links: [...new Set(['wiki:aims:index', ...topicIds, 'wiki:aims:document-hierarchy', ...[...relatedDocs].filter(id => documents.has(id)).map(wikiId), `doc:${doc.id}`])],
    source_document_ids: [...new Set(claims.map(c => c.source_document_id))] });
}
for (const [slug,title,ids] of topics) {
  pages.push({ id: `wiki:aims:${slug}`, title, status: 'approved',
    claims: ids.map(id => ({ ...overview(documents.get(id)), heading: entities.get(`doc:${id}`).name,
      fact_ids: approvedFacts.filter(f => f.subject === `doc:${id}`).map(f => f.id) })),
    links: ['wiki:aims:index', ...ids.map(wikiId)], source_document_ids: ids });
}
const indexSource = documents.get('AIDU-AIM-01-01');
pages.unshift({ id: 'wiki:aims:index', title: 'AIMS LLM Wiki — 매뉴얼·절차서·지침서 색인', status: 'approved',
  claims: [{ ...overview(indexSource), heading: '지식의 범위', text: `${curation.scope}\n\n26개 문서의 검토 요약·절별 대표 인용·온톨로지 연결을 수록한다. 조건·예외의 전체 내용은 연결된 원문을 적용한다.` },
    cite(indexSource, overview(indexSource).quote, [...topics.map(t => `- [[wiki:aims:${t[0]}]] — ${t[1]}`), ...[...documents.values()].map(d => `- [[${wikiId(d.id)}]] — ${entities.get(`doc:${d.id}`).name}`)].join('\n'), '주제별·문서별 탐색')],
  links: [...topics.map(t => `wiki:aims:${t[0]}`), ...[...documents.keys()].map(wikiId)], source_document_ids: [indexSource.id] });
const kept = (seed.wiki_pages ?? []).filter(p => !p.id.startsWith('wiki:doc:') && !p.id.startsWith('wiki:aims:'));
const legacyImpact = kept.find(p => p.id === 'wiki:edu-score-impact');
if (legacyImpact) {
  const doc = documents.get('AIDU-AIP-06-02');
  const start = doc.text.indexOf('| [F01]');
  const end = doc.text.indexOf('\n| [F04]', start);
  assert(start >= 0 && end > start, 'impact form table changed; review legacy claim');
  legacyImpact.claims = legacyImpact.claims.map(c => cite(doc, doc.text.slice(start,end), c.text, c.heading, c.fact_ids ?? []));
  legacyImpact.links = [...new Set([...(legacyImpact.links ?? []), wikiId(doc.id), 'wiki:aims:risk-impact'])];
}
seed.wiki_pages = [...pages, ...kept];
for (const page of seed.wiki_pages.filter(p => p.status === 'approved')) {
  for (const claim of page.claims ?? []) {
    for (const id of claim.fact_ids ?? []) assert(approvedFactIds.has(id), `unapproved fact: ${id}; review approved page ${page.id}`);
  }
}
const pageIds = new Set(seed.wiki_pages.map(p => p.id));
for (const page of pages) {
  assert(page.links.filter(id => pageIds.has(id)).length >= 2, `missing wiki cross-links: ${page.id}`);
  for (const id of page.links) assert(pageIds.has(id) || entities.has(id), `broken link: ${id}`);
  for (const claim of page.claims) {
    assert(documents.get(claim.source_document_id).text.includes(claim.quote));
    for (const id of claim.fact_ids) assert(facts.has(id), `unknown fact: ${id}`);
  }
}
for (const fact of seed.facts.filter(f => f.id.startsWith('fact:seed:iso:') || (f.source_document_id && f.quote))) {
  if (documents.has(fact.source_document_id)) assert(documents.get(fact.source_document_id).text.includes(fact.quote), `stale fact quote: ${fact.id}`);
}
// Preserve compact entity/fact formatting; only Wiki claims need multiline JSON.
const compact = value => `{ ${Object.entries(value).map(([k,v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }`;
const output = '{\n  "meta": ' + JSON.stringify(seed.meta,null,2).replace(/\n/g,'\n  ') + ',\n' +
  ['entities','facts'].map(key => `  "${key}": [\n${seed[key].map(v => '    '+compact(v)).join(',\n')}\n  ],\n`).join('') +
  '  "wiki_pages": ' + JSON.stringify(seed.wiki_pages,null,2).replace(/\n/g,'\n  ') + '\n}\n';
const manifest = { schema_version: 1, reviewed_on: curation.reviewed_on,
  sources: curation.documents.map(({id,path,source_sha}) => ({id,path,sha256:source_sha})),
  wiki_pages: pages.map(p => p.id), source_count: documents.size, generated_page_count: pages.length,
  total_wiki_pages: seed.wiki_pages.length, claim_count: pages.reduce((n,p)=>n+p.claims.length,0),
  seed_sha256: hash(output), rules_sha256: hash(await read('packages/ontology/rules.dl')) };
if (process.argv.includes('--check')) {
  assert.equal(await read('seed/example-persons-roles.json'),output,'wiki seed is stale; run pnpm wiki:ingest');
  assert.deepEqual(JSON.parse(await read('seed/wiki-ingest-manifest.json')),manifest,'ingest manifest is stale');
} else {
  await writeFile(resolve(root,'seed/example-persons-roles.json'),output);
  await writeFile(resolve(root,'seed/wiki-ingest-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
}
console.log(JSON.stringify({sources:documents.size,generated_pages:pages.length,total_pages:seed.wiki_pages.length,claims:manifest.claim_count,check:process.argv.includes('--check')}));
