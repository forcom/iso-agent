import assert from "node:assert/strict";
import { pageToMarkdown } from "../packages/wiki/src/index.ts";
import { selectWikiContext } from "../apps/worker/src/lib/wiki.ts";
import { readFileSync } from "node:fs";
import * as wikiContext from "../apps/worker/src/lib/wiki.ts";
import type { OntologyFact } from "../packages/ontology/src/index.ts";

const body = pageToMarkdown({
  id: "wiki:test", title: "출처 있는 위키", status: "approved",
  claims: [{ heading: "조건", text: "조건에 따라 적용한다.",
    quote: "첫째 줄\n둘째 줄", fact_ids: ["fact:test"],
    source_document_id: "AIDU-AIP-06-02",
    source_ref: "docs/procedure/AIDU-AIP-06-02.md#L10",
    source_sha: "a".repeat(64),
  }], links: ["wiki:related", "doc:AIDU-AIP-06-02"],
});
assert(body.includes("> 첫째 줄\n> 둘째 줄"), "multiline source quote must stay a blockquote");
assert(body.includes("docs/procedure/AIDU-AIP-06-02.md#L10"), "source location must survive rendering");
assert(body.includes("a".repeat(64)), "source version must survive rendering");
assert(body.includes("fact:test"));
assert(body.includes("wiki:related"), "wiki links must survive rendering");
console.log("wiki provenance rendering OK");

const pages = Array.from({ length: 25 }, (_, i) => ({ id: `wiki:${i}`, title: `일반 문서 ${i}`, status: "approved", body_md: "일반 절차" }));
pages.push({ id: "wiki:late-guide", title: "데이터 관리지침서", status: "approved", body_md: "외부 API 가명처리 순서" });
pages.unshift({ id: "wiki:draft", title: "가명처리", status: "draft", body_md: "가명처리" });
const selected = selectWikiContext("외부 API 가명처리 방법은?", pages);
assert.equal(selected[0].id, "wiki:late-guide", "relevant pages beyond the old LIMIT 20 must be selected");
assert(!selected.some(p => p.id === "wiki:draft"), "draft knowledge must stay excluded");
console.log("wiki retrieval coverage OK");

const query = "시스템 수명 주기 데이터 관리지침서 외부 API 전송 가명처리 방법";
const noisyClaims = Array.from({length:5},(_,i) => ({heading:`개요 ${i}`,text:query,quote:query}));
const step = {heading:"외부 API 전송 전 가명처리",text:"전송 절차",quote:"4.3.3: 직접 식별자를 제거하고 전송 필드를 확인한다."};
const focused = selectWikiContext(query,[{id:"wiki:steps",title:"데이터 관리지침서",status:"approved",body_md:query,
  claims_json:JSON.stringify([...noisyClaims,step])}]);
assert(focused[0].claims.some(c=>c.heading===step.heading), "operative clause headings must outrank broad summaries");

const legacy = selectWikiContext("기존 설명", [{ id: "wiki:legacy", title: "기존 위키", status: "approved",
  body_md: "기존 설명", claims_json: JSON.stringify([{text:"기존 설명"}, null, {heading:12, text:"다른 설명", quote:3, fact_ids:"invalid"}]) }]);
assert(legacy[0].body_md.includes("## Claim\n\n기존 설명"), "legacy claims without headings must remain usable");
const invalid = selectWikiContext("원래 본문", [{ id:"wiki:invalid", title:"기존 위키", status:"approved", body_md:"원래 본문", claims_json:"{" }]);
assert.equal(invalid[0].body_md,"원래 본문", "malformed legacy claims must fall back to stored Markdown");
assert(pageToMarkdown({id:"wiki:legacy",title:"기존 위키",status:"approved",claims:[{text:"기존 설명"} as any]}).includes("## Claim"));
console.log("legacy wiki compatibility OK");

const seed = JSON.parse(readFileSync(new URL("../seed/example-persons-roles.json", import.meta.url),"utf8"));
const graphFacts: OntologyFact[] = seed.facts.map((f: OntologyFact) => ({...f,knowledge_kind:"normative"}));
graphFacts.push({id:"fact:draft-grant",subject:"role:cto",predicate:"grants",object:"perm:unapproved",status:"draft",knowledge_kind:"normative"});
assert.equal(typeof wikiContext.selectGraphFacts,"function", "graph retrieval must be independent of Wiki links");
for (const question of ["person:P03의 권한은 무엇인가요?", "기술책임자는 어떤 권한을 가지나요?"]) {
  const found = wikiContext.selectGraphFacts(question, seed.entities, graphFacts, []);
  assert(found.some(f => f.subject === "person:P03" && f.predicate === "holds_role" && f.object === "role:cto"), question);
  assert(found.some(f => f.subject === "role:cto" && f.predicate === "grants" && f.object === "perm:seed.import"), question);
  assert(!found.some(f => f.id === "fact:draft-grant"));
}
console.log("graph-only question retrieval OK");
