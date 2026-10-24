import type { ActionPolicy, RecordType } from '../../packages/contracts/src/index';
import type { PermissionOracle } from './permissions';

export interface AuditableMapping {
  roles: { id: string; name: string }[];
  recordTypes: RecordType[];
  policies: ActionPolicy[];
}
export interface PolicyAuditIssue { formCode: string; action: string; facet: string; expected: unknown; actual: unknown }
export interface AuditPersonnel { persons: { personaId: string; roles: { name: string; scope: string }[] }[] }
const unique = (values: string[]) => [...new Set(values)].sort();
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
};
const same = (left: unknown, right: unknown) => stable(left) === stable(right);
const baseScope = (scope: Record<string, unknown> | undefined | null) => {
  if (!scope) return null;
  const { conditions: _conditions, ...base } = scope;
  return base;
};

/** Pure structural audit. Prose conditions are reported for review, never erased or
 * declared equivalent to machine guards. Real inputs are read only by the explicit CLI. */
export function auditPermissionPolicies(oracle: PermissionOracle, mapping: AuditableMapping, personnel?: AuditPersonnel) {
  const issues: PolicyAuditIssue[] = [];
  const roleNames = new Map(mapping.roles.map(role => [role.id, role.name]));
  const binding = (name: string) => oracle.roleBindings?.find(item => item.sourceRole === name)?.installedRole ?? name;
  const policiesById = new Map(mapping.policies.map(policy => [policy.id, policy]));
  const facts = [];
  const representationDetails = [];
  for (const row of oracle.rows) {
    const type = mapping.recordTypes.find(item => item.code === row.formCode);
    const allPolicies = mapping.policies.filter(policy => policy.resourceTypeId === type?.id && policy.action === row.action);
    const approvalScope = type?.recordApproval ? 'record' : 'outcome';
    const policies = allPolicies.filter(policy => policy.approvalScope ? policy.approvalScope === approvalScope : row.action !== 'approve' || approvalScope === 'outcome');
    const issue = (facet: string, expected: unknown, actual: unknown) => { if (!same(expected, actual)) issues.push({ formCode: row.formCode, action: row.action, facet, expected, actual }); };
    issue('approved_expectation', 'approved', row.status);
    if (!type) { issue('record_type', row.formCode, null); continue; }
    const expectedRoles = unique(row.allowedRoles.map(binding));
    if (row.action === 'review' && type.recordApproval) {
      // General document review authority also applies before an outcome decision.
      // Specialist completion requirements are checked separately and stay intact.
      const outcomeRoles = new Set(allPolicies.filter(policy => !policy.approvalScope || policy.approvalScope === 'outcome')
        .map(policy => roleNames.get(policy.roleId)));
      issue('missing_outcome_formal_review_role', [], expectedRoles.filter(role => !outcomeRoles.has(role)));
    }
    const supplementalRoles = new Set<string>();
    for (const roleId of type.requiredReviewRoleIds ?? []) {
      const name = roleNames.get(roleId);
      if (row.action !== 'review' || approvalScope !== 'outcome' || !name || expectedRoles.includes(name)) continue;
      const holders = personnel?.persons.filter(person => person.roles.some(role => role.name === name)) ?? [];
      // Preserve an explicit required specialist review only when its installed
      // holders are already approved candidates. This never invents a role alias.
      if (holders.length && holders.every(person => row.allowedPersons.some(candidate => candidate.personaId === person.personaId))) {
        supplementalRoles.add(name);
        representationDetails.push({ formCode: row.formCode, action: row.action, roleId, role: name,
          allowedPersonaIds: holders.map(person => person.personaId).sort(),
          reason: 'Existing source-grounded mandatory review; every installed holder is already an approved candidate. The original role and mandatory completion gate remain explicit.' });
      }
    }
    issue('roles', expectedRoles, unique(policies.map(policy => roleNames.get(policy.roleId) ?? `unknown:${policy.roleId}`).filter(role => !supplementalRoles.has(role))));
    issue('states', unique(row.states ?? []), unique(policies.flatMap(policy => policy.stateCondition)));
    for (const role of unique(row.allowedRoles.map(binding))) {
      const expectedScopes = unique((row.policyScopes ?? []).filter(item => binding(item.role) === role).map(item => stable({ scopeCondition: baseScope(item.scopeCondition), adminRequired: item.adminRequired })));
      const actualScopes = unique(policies.filter(policy => roleNames.get(policy.roleId) === role).map(policy => stable({ scopeCondition: baseScope(policy.scopeCondition), adminRequired: policy.adminRequired ?? false })));
      if (expectedScopes.length) issue(`scope:${role}`, expectedScopes, actualScopes);
    }
    const coverage = type.actionCoverage.find(item => item.action === row.action);
    issue('coverage_policy_ids', unique(allPolicies.map(policy => policy.id)), unique(coverage?.policyIds ?? []));
    issue('coverage_defined', 'defined', coverage?.status ?? null);
    if (row.action === 'review') issue('review_required', true, type.reviewRequired);
    if (row.action === 'approve') issue('approval_required', true, type.approvalRequired);
    for (const policy of allPolicies) {
      if (['review', 'approve', 'reject', 'apply_assignment'].includes(row.action)) issue(`exact_revision:${policy.id}`, true, policy.requiresExactRevision);
      const compiled = Object.fromEntries(policy.conditions.map(condition => [condition.field, condition.equals]));
      issue(`condition_compilation:${policy.id}`, compiled, policy.scopeCondition.conditions ?? {});
      if (row.recordCases) issue(`record_designation:${policy.id}`, true, policy.requiresRecordDesignation ?? false);
    }
    facts.push({ formCode: row.formCode, action: row.action, condition: row.condition, separation: row.separation,
      requiredReviewRoleIds: type.requiredReviewRoleIds ?? [], approvalCondition: type.approvalCondition ?? null,
      applicabilityCondition: type.applicabilityCondition ?? null, recordCases: row.recordCases ?? [],
      approvalScope, policies: allPolicies.map(policy => ({ id: policy.id, role: roleNames.get(policy.roleId), scopeCondition: policy.scopeCondition,
        states: policy.stateCondition, approvalScope: policy.approvalScope ?? null, separation: policy.separationCondition, conditions: policy.conditions, evidenceRefs: policy.evidenceRefs })) });
  }
  for (const type of mapping.recordTypes) {
    for (const coverage of type.actionCoverage) for (const id of coverage.policyIds) {
      const policy = policiesById.get(id);
      if (!policy || policy.resourceTypeId !== type.id || policy.action !== coverage.action) issues.push({ formCode: type.code, action: coverage.action, facet: 'invalid_coverage_reference', expected: { resourceTypeId: type.id, action: coverage.action }, actual: policy ?? id });
    }
    for (const roleId of type.requiredReviewRoleIds ?? []) if (!mapping.policies.some(policy => policy.resourceTypeId === type.id && policy.action === 'review' && policy.roleId === roleId)) {
      issues.push({ formCode: type.code, action: 'review', facet: 'missing_required_review_policy', expected: roleId, actual: null });
    }
  }
  return { rowCount: oracle.rows.length, formCount: new Set(oracle.rows.map(row => row.formCode)).size,
    policyCount: mapping.policies.length, structuralMatch: issues.length === 0, issues,
    semanticGuardsRequireReview: true, representationDetails, facts,
    formsWithoutOracle: mapping.recordTypes.filter(type => !oracle.formCodes.includes(type.code)).map(type => ({ code: type.code, name: type.name,
      requiredReviewRoleIds: type.requiredReviewRoleIds ?? [], policies: mapping.policies.filter(policy => policy.resourceTypeId === type.id) })) };
}
