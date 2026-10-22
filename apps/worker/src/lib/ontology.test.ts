import { OntologyEngine, type OntologyFact } from "./ontology";

const facts: OntologyFact[] = [
  {
    id: "f1",
    subject: "doc:A",
    predicate: "addresses",
    object: "req:1",
    knowledge_kind: "normative",
    status: "approved",
  },
  {
    id: "f2",
    subject: "doc:A",
    predicate: "requires_record",
    object: "tpl:T",
    knowledge_kind: "normative",
    status: "approved",
  },
  {
    id: "f3",
    subject: "record:R",
    predicate: "instance_of",
    object: "tpl:T",
    knowledge_kind: "record",
    status: "auto_approved",
  },
  {
    id: "f4",
    subject: "doc:A",
    predicate: "depends_on",
    object: "aisystem:S",
    knowledge_kind: "normative",
    status: "approved",
  },
  {
    id: "f5",
    subject: "person:P",
    predicate: "holds_role",
    object: "role:r",
    knowledge_kind: "normative",
    status: "approved",
  },
  {
    id: "f6",
    subject: "role:r",
    predicate: "grants",
    object: "perm:query.ask",
    knowledge_kind: "normative",
    status: "approved",
  },
];

const engine = new OntologyEngine(facts);
const ev = engine.evidenceCandidates("req:1");
if (ev.length !== 1 || ev[0].record !== "record:R") {
  throw new Error("evidenceCandidates failed");
}
const impact = engine.impactSet("aisystem:S");
if (!impact.some((i) => i.node === "doc:A")) {
  throw new Error("impactSet reverse depends_on failed");
}
if (!engine.hasPermission("person:P", "query.ask")) {
  throw new Error("hasPermission failed");
}
if (engine.hasPermission("person:P", "seed.import")) {
  throw new Error("unexpected permission");
}
console.log("ontology.test.ts OK");
