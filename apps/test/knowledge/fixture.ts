import type { ActionPolicy, BuildInput, EvidenceRef } from "../../packages/contracts/src/index";

export async function corpus(): Promise<BuildInput> {
  const markdown = "# 1 Example procedure\nThe coordinator writes the register.\nThe reviewer reviews the exact version.\n";
  const bytes = new TextEncoder().encode(markdown);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(n => n.toString(16).padStart(2, "0")).join("");
  const evidence: EvidenceRef = { revisionId: "example-revision", sourceSha256: hash, lineStart: 2, lineEnd: 2, quote: "The coordinator writes the register." };
  const policy: ActionPolicy = { id: "policy-create", resourceTypeId: "record-type", action: "create", roleId: "coordinator", scopeCondition: { kind: "all" }, stateCondition: ["new"], separationCondition: "none", decisionKind: "registration", evidenceRefs: [evidence], effectiveReleaseId: "", origin: "regulation", conditions: [], requiresExactRevision: false, reviewStatus: "validated" };
  const source = { artifactId: "example-procedure", revisionId: "example-revision", path: "synthetic/procedure.md", code: "EXAMPLE-P", title: "Example procedure", kind: "procedure" as const, bytes, sha256: hash };
  const templateBytes = new TextEncoder().encode("# Example form\nBlank register\n");
  const templateHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", templateBytes))).map(n => n.toString(16).padStart(2, "0")).join("");
  return {
    sourceMode: "synthetic", sources: [source, { artifactId: "example-template", revisionId: "template-revision", path: "synthetic/form.md", code: "EXAMPLE-F01", title: "Blank register", kind: "template", bytes: templateBytes, sha256: templateHash }],
    mappings: { version: "1", reviewedBy: "synthetic test author", reviewedAt: "2026-01-01", reviewScope: "Synthetic fixture only", sources: [{ sourceCode: source.code, sourceSha256: hash, reviewStatus: "validated", reviewedBy: "synthetic test author", reviewedAt: "2026-01-01", clauses: [{ clause: "1", lineStart: 1, lineEnd: 3, treatment: "defined", reason: "Synthetic policy clause" }] }, { sourceCode: "EXAMPLE-F01", sourceSha256: templateHash, reviewStatus: "validated", reviewedBy: "synthetic test author", reviewedAt: "2026-01-01", clauses: [] }],
      roles: [{ id: "coordinator", name: "Coordinator", evidenceRefs: [evidence] }], policies: [policy], productPolicies: [], recordTypes: [{ id: "record-type", code: "EXAMPLE-F01", name: "Register", templateArtifactId: "example-template", templateRevisionId: "template-revision", procedureCode: "EXAMPLE-P", reviewRequired: false, approvalRequired: false, applicability: "All example registrations", evidenceRefs: [evidence], reviewStatus: "validated", actionCoverage: ["create", "revise", "review", "approve", "circulate"].map(action => ({ action: action as "create", status: action === "create" ? "defined" : "not_applicable", reason: action === "create" ? "Assigned coordinator" : "No such operation in the synthetic procedure", evidenceRefs: [evidence], policyIds: action === "create" ? [policy.id] : [] })) }] },
    rules: new TextEncoder().encode("synthetic_rules"), schema: new TextEncoder().encode("synthetic_schema"), schemaVersion: "1",
  };
}
