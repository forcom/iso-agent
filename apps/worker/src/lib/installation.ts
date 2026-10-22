import type { DeploymentPreparation, InstallReport, InstallTarget, KnowledgeBundle } from "../../../packages/contracts/src/index";
import { sha256, sourcePathAllowed, validateDeploymentPreparation, verifyBundle } from "../../../packages/knowledge/src/index";
import type { Artifact, Env, Revision } from "../types";
import { ApiError, requireValue } from "./errors";

export async function installRelease(env: Env, bundle: KnowledgeBundle, target: InstallTarget): Promise<InstallReport> {
  requireValue(target.environment === "local" || target.environment === "demo" || target.environment.startsWith("iso-test-"), 422, "INSTALL_TARGET", "설치 환경은 명시적인 새 local·demo 또는 격리 시험 환경이어야 합니다.");
  requireValue(target.environment !== "demo" || env.ALLOW_FICTIONAL_PERSONNEL === "true", 422, "DEMO_DISABLED", "가상 구성 사용이 명시적으로 허용된 데모 환경이어야 합니다.");
  const occupied = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM context)+(SELECT COUNT(*) FROM artifacts)+(SELECT COUNT(*) FROM persons)+(SELECT COUNT(*) FROM releases)+(SELECT COUNT(*) FROM assignments) AS n").first<number>("n");
  requireValue(occupied === 0, 409, "ALREADY_INSTALLED", "기존 데이터가 있는 환경은 초기 설치로 교체할 수 없습니다. already installed");
  const validation = await verifyBundle(bundle);
  requireValue(validation.valid, 422, "INVALID_BUNDLE", `지식 bundle 검증 실패: ${validation.errors.map(issue => issue.code).join(", ")}`);
  requireValue(bundle.sources.every(source => sourcePathAllowed(source.path, target.environment.startsWith("iso-test-") ? "synthetic" : "production")), 422, "SOURCE_ISOLATION", "설치 환경과 지식 원문의 격리 범위가 일치하지 않습니다.");
  requireValue(target.ruleBytes && target.schemaBytes, 422, "DEFINITIONS_REQUIRED", "재구축에 사용할 검증된 규칙·스키마 원본이 필요합니다.");
  requireValue(await sha256(target.ruleBytes) === bundle.manifest.rulesHash && await sha256(target.schemaBytes) === bundle.manifest.schemaHash, 422, "DEFINITION_HASH", "규칙·스키마 해시가 지식 릴리스와 일치하지 않습니다.");
  const preparation: DeploymentPreparation = target.preparation ?? { environment: target.environment, persons: [], assignments: [], operatorDesignation: null };
  requireValue(preparation.environment === target.environment, 422, "PREPARATION_TARGET", "운영 준비 자료의 대상 환경이 다릅니다.");
  const preparationCheck = validateDeploymentPreparation(preparation);
  requireValue(!preparationCheck.errors.some(issue => issue.code !== "operator_unassigned"), 422, "PREPARATION_INVALID", "직원·역할 지정 준비 자료의 실제 근거·기간·범위를 확인해 주세요.");
  const warnings = preparationCheck.errors.filter(issue => issue.code === "operator_unassigned").map(issue => issue.message);
  const at = new Date().toISOString(); const statements: D1PreparedStatement[] = [];
  const objects: Array<{ key: string; content: Uint8Array | string }> = [];
  const addSource = (artifact: Artifact, revision: Revision, markdown: string) => {
    objects.push({ key: revision.objectKey, content: markdown }, { key: revision.textKey, content: markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n") });
    statements.push(env.DB.prepare("INSERT INTO artifacts(id,document_code,kind,body) VALUES(?,?,?,?)").bind(artifact.id, artifact.documentCode, artifact.kind, JSON.stringify(artifact)), env.DB.prepare("INSERT INTO revisions(id,artifact_id,body) VALUES(?,?,?)").bind(revision.id, artifact.id, JSON.stringify(revision)));
  };
  for (const source of bundle.sources) {
    if (source.kind === "index") continue;
    const kind = source.kind === "template" ? "template" : "regulation";
    const artifact: Artifact = { id: source.artifactId, documentCode: source.code, title: source.title, kind, regulationType: source.kind, recordTypeIds: [], workingRevisionId: source.revisionId, effectiveRevisionId: source.revisionId, systemIds: [] };
    const revision: Revision = { id: source.revisionId, artifactId: source.artifactId, filename: source.path.split("/").at(-1)!, sourceSha256: source.sha256, textSha256: source.textSha256, objectKey: `sources/${source.revisionId}/${source.sha256}.md`, textKey: `text/${source.revisionId}/${source.textSha256}.txt`, state: "registered", createdAt: at, createdBy: "deployment", previousRevisionId: null, templateRevisionIds: [], systemIds: [], conditions: {}, fieldMappings: {}, evidenceStatus: "verified" };
    addSource(artifact, revision, source.markdown);
  }
  const operator = preparation.operatorDesignation;
  for (const person of preparation.persons) statements.push(env.DB.prepare("INSERT INTO persons(id,body) VALUES(?,?)").bind(person.id, JSON.stringify({ ...person, isAdmin: operator?.personId === person.id, ...(operator?.personId === person.id ? { operatorDesignation: operator } : {}) })));
  for (const source of preparation.designationSources ?? []) {
    requireValue(preparation.persons.some(person => person.id === source.confirmedBy) && source.approvalEvidenceId && Number.isFinite(Date.parse(source.confirmedAt)), 422, "DESIGNATION_CONFIRMATION", "초기 지정 기록은 실제 확인자·시점·승인 증거 ID가 필요합니다.");
    requireValue(await sha256(source.markdown) === source.sha256, 422, "DESIGNATION_SOURCE_HASH", "역할 지정 원문 해시가 일치하지 않습니다.");
    const textSha256 = await sha256(source.markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"));
    const artifact: Artifact = { id: source.artifactId, documentCode: source.documentCode, title: source.title, kind: "record", recordTypeIds: bundle.recordTypes.filter(type => type.roleAssignment).map(type => type.id), workingRevisionId: source.revisionId, effectiveRevisionId: source.revisionId, systemIds: [] };
    const revision: Revision = { id: source.revisionId, artifactId: source.artifactId, filename: `${source.documentCode}.md`, sourceSha256: source.sha256, textSha256, objectKey: `sources/${source.revisionId}/${source.sha256}.md`, textKey: `text/${source.revisionId}/${textSha256}.txt`, state: "approved", createdAt: source.confirmedAt, createdBy: source.confirmedBy, previousRevisionId: null, templateRevisionIds: bundle.recordTypes.filter(type => type.roleAssignment).map(type => type.templateRevisionId), systemIds: [], conditions: {}, fieldMappings: {}, evidenceStatus: "verified" };
    revision.externalDesignation={confirmedBy:source.confirmedBy,confirmedAt:source.confirmedAt,approvalEvidenceId:source.approvalEvidenceId,sourceSha256:source.sha256};
    addSource(artifact, revision, source.markdown);
    statements.push(env.DB.prepare("INSERT INTO events(id,artifact_id,body) VALUES(?,?,?)").bind(crypto.randomUUID(), source.artifactId, JSON.stringify({ kind: "external_designation_confirmed", revisionId: source.revisionId, confirmedBy: source.confirmedBy, confirmedAt: source.confirmedAt, approvalEvidenceId: source.approvalEvidenceId, sourceSha256: source.sha256 })));
  }
  for (const assignment of preparation.assignments) {
    const source = preparation.designationSources?.find(item => item.revisionId === assignment.approvedRevisionId);
    requireValue(source && bundle.roles.some(role => role.id === assignment.roleId), 422, "ASSIGNMENT_SOURCE_REQUIRED", "초기 역할 지정에는 실제 승인된 지정 원문과 등록된 기능상 역할이 필요합니다.");
    requireValue(["all", "system", "resource"].includes(assignment.scope.kind) && Array.isArray(assignment.scope.ids) && assignment.scope.ids.every(id => typeof id === "string" && id.length > 0), 422, "ASSIGNMENT_SCOPE", "역할 지정 범위를 확인해 주세요.");
    for (const evidence of assignment.evidenceRefs) requireValue(evidence.revisionId === source.revisionId && evidence.sourceSha256 === source.sha256 && Number.isInteger(evidence.lineStart) && evidence.lineStart > 0 && Number.isInteger(evidence.lineEnd) && evidence.lineEnd >= evidence.lineStart && source.markdown.split("\n").slice(evidence.lineStart - 1, evidence.lineEnd).join("\n") === evidence.quote && evidence.quote.length > 0, 422, "ASSIGNMENT_QUOTE", "역할 지정 근거가 확인된 원문 인용과 다릅니다.");
    statements.push(env.DB.prepare("INSERT INTO assignments(id,body) VALUES(?,?)").bind(assignment.id, JSON.stringify(assignment)));
  }
  const releaseKey = `releases/${bundle.manifest.releaseId}/${bundle.manifest.manifestHash}.json`;
  objects.push({ key: `definitions/rules/${bundle.manifest.rulesHash}`, content: target.ruleBytes }, { key: `definitions/schema/${bundle.manifest.schemaHash}`, content: target.schemaBytes }, { key: releaseKey, content: JSON.stringify(bundle) });
  for (const object of objects) {
    const existing = await env.SOURCES.get(object.key);
    if (existing) requireValue(await sha256(new Uint8Array(await existing.arrayBuffer())) === await sha256(object.content), 409, "IMMUTABLE_OBJECT_CONFLICT", "동일한 불변 객체 키의 내용이 다릅니다.");
    else await env.SOURCES.put(object.key, typeof object.content === "string" ? object.content : new Uint8Array(object.content), { customMetadata: { installedAt: at, releaseId: bundle.manifest.releaseId } });
  }
  statements.push(env.DB.prepare("INSERT INTO releases(id,object_key,body) VALUES(?,?,?)").bind(bundle.manifest.releaseId, releaseKey, JSON.stringify(bundle.manifest)), env.DB.prepare("INSERT INTO events(id,artifact_id,body) VALUES(?,?,?)").bind(crypto.randomUUID(), null, JSON.stringify({ kind: "knowledge_installed", at, releaseId: bundle.manifest.releaseId, manifestHash: bundle.manifest.manifestHash, reviewedBy: bundle.mappings.reviewedBy, reviewScope: bundle.mappings.reviewScope, companyApprovalCreated: false, environment: target.environment })));
  // The initial context primary key fences concurrent installers; the complete D1 batch rolls back together.
  const results = await env.DB.batch([env.DB.prepare("INSERT INTO context(id,release_id,rules_hash,data_revision,authority_revision) VALUES(1,?,?,0,0)").bind(bundle.manifest.releaseId, bundle.manifest.rulesHash), ...statements]);
  if (results.some(result => !result.success) || results[0].meta.changes !== 1) throw new ApiError(500, "INSTALL_FAILED", "초기 설치 트랜잭션이 완료되지 않았습니다.");
  const unassignedRoleIds = bundle.roles.filter(role => !preparation.assignments.some(assignment => assignment.roleId === role.id && assignment.status === "active")).map(role => role.id);
  if (unassignedRoleIds.length) warnings.push(`${unassignedRoleIds.length} functional roles remain unassigned; no fictional employees or approvals were created.`);
  return { releaseId: bundle.manifest.releaseId, installed: true, unassignedRoleIds, warnings };
}
