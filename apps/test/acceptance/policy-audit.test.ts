import { describe, expect, it } from 'vitest';
import { auditPermissionPolicies, type AuditableMapping } from './policy-audit';
import type { PermissionOracle } from './permissions';

function fixture() {
  const policy = { id: 'approval', resourceTypeId: 'form', action: 'approve', roleId: 'technical',
    scopeCondition: { kind: 'all', conditions: { verified: true } }, stateCondition: ['reviewed'], separationCondition: 'not_author',
    decisionKind: 'approval', evidenceRefs: [], effectiveReleaseId: '', origin: 'regulation',
    conditions: [{ field: 'verified', equals: true, reason: 'Synthetic required control', evidenceRefs: [] }], requiresExactRevision: true, reviewStatus: 'validated' };
  const mapping = { roles: [{ id: 'technical', name: 'Technical' }], policies: [policy],
    recordTypes: [{ id: 'form', code: 'SYNTHETIC-F01', name: 'Synthetic', reviewRequired: true, approvalRequired: true,
      actionCoverage: [{ action: 'approve', status: 'defined', policyIds: ['approval'] }] }] } as unknown as AuditableMapping;
  const oracle = { formCodes: ['SYNTHETIC-F01'], roleBindings: [], rows: [{ formCode: 'SYNTHETIC-F01', action: 'approve',
    status: 'approved', allowedRoles: ['Technical'], states: ['reviewed'], policyScopes: [{ role: 'Technical', scopeCondition: { kind: 'all' }, adminRequired: false }],
    condition: 'Required controls must pass', separation: 'Author cannot approve' }] } as unknown as PermissionOracle;
  return { oracle, mapping };
}
describe('explicit acceptance policy audit with synthetic inputs', () => {
  it('keeps normative boolean guards separate from base scope comparison', () => {
    const { oracle, mapping } = fixture();
    const result = auditPermissionPolicies(oracle, mapping);
    expect(result.issues).toEqual([]);
    expect(result.semanticGuardsRequireReview).toBe(true);
    expect(result.facts[0].policies[0].conditions[0].field).toBe('verified');
    expect(result.facts[0].policies[0].separation).toBe('not_author');
  });
  it('detects missing and excess authority, stale coverage, and premature approval', () => {
    const { oracle, mapping } = fixture();
    mapping.policies[0].roleId = 'unknown';
    mapping.policies[0].stateCondition = ['in_review', 'reviewed'];
    mapping.recordTypes[0].actionCoverage[0].policyIds = [];
    const facets = auditPermissionPolicies(oracle, mapping).issues.map(item => item.facet);
    expect(facets).toContain('roles'); expect(facets).toContain('states'); expect(facets).toContain('coverage_policy_ids');
  });
  it('detects uncompiled conditions and a missing required review role', () => {
    const { oracle, mapping } = fixture();
    mapping.policies[0].scopeCondition.conditions = {};
    mapping.recordTypes[0].requiredReviewRoleIds = ['independent'];
    const facets = auditPermissionPolicies(oracle, mapping).issues.map(item => item.facet);
    expect(facets).toContain('condition_compilation:approval'); expect(facets).toContain('missing_required_review_policy');
  });
  it('audits record approval separately without treating an outcome policy as record permission', () => {
    const { oracle, mapping } = fixture();
    mapping.recordTypes[0].recordApproval = { label: 'Record only', limitations: 'No completed outcome' };
    expect(auditPermissionPolicies(oracle, mapping).issues.some(item => item.facet === 'roles')).toBe(true);
    const record = structuredClone(mapping.policies[0]);
    record.id = 'record-approval'; record.approvalScope = 'record';
    record.conditions = []; record.scopeCondition.conditions = {};
    mapping.policies.push(record); mapping.recordTypes[0].actionCoverage[0].policyIds.push(record.id);
    expect(auditPermissionPolicies(oracle, mapping).issues).toEqual([]);
    expect(mapping.policies[0].conditions).toHaveLength(1);
  });
  it('requires designation guards on every policy of a record-specific action', () => {
    const { oracle, mapping } = fixture();
    oracle.rows[0].recordCases = [{ informationId: 'SYNTHETIC-001', sourcePath: 'docs/records/SYNTHETIC-001.md', sourceSha256: 'a'.repeat(64), systemCode: 'synthetic', allowedPersons: [], deniedSamples: ['other'], evidence: [{ lineStart: 1, lineEnd: 1, quote: 'Synthetic' }], note: 'Synthetic direct designation' }];
    expect(auditPermissionPolicies(oracle, mapping).issues.some(item => item.facet === 'record_designation:approval')).toBe(true);
    mapping.policies[0].requiresRecordDesignation = true;
    expect(auditPermissionPolicies(oracle, mapping).issues).toEqual([]);
  });
  it('detects a common formal reviewer accidentally restricted to record approval', () => {
    const { oracle, mapping } = fixture();
    const row = oracle.rows[0]; row.action = 'review'; row.states = ['in_review'];
    const policy = mapping.policies[0]; policy.action = 'review'; policy.stateCondition = ['in_review']; policy.approvalScope = 'record';
    mapping.recordTypes[0].recordApproval = { label: 'Record only', limitations: 'Outcome still has controls' };
    mapping.recordTypes[0].actionCoverage[0].action = 'review';
    expect(auditPermissionPolicies(oracle, mapping).issues.some(item => item.facet === 'missing_outcome_formal_review_role')).toBe(true);
    delete policy.approvalScope;
    expect(auditPermissionPolicies(oracle, mapping).issues).toEqual([]);
  });
  it('does not hide a mandatory specialist role held by an unapproved person', () => {
    const { oracle, mapping } = fixture();
    const row = oracle.rows[0]; row.action = 'review'; row.states = ['in_review'];
    row.allowedPersons = [{ personaId: 'P2', name: 'Synthetic reviewer', role: 'Technical', scope: 'all' }];
    const policy = mapping.policies[0]; policy.action = 'review'; policy.stateCondition = ['in_review'];
    const specialist = structuredClone(policy); specialist.id = 'specialist'; specialist.roleId = 'resource';
    mapping.policies.push(specialist); mapping.roles.push({ id: 'resource', name: 'Resource' });
    mapping.recordTypes[0].requiredReviewRoleIds = ['resource'];
    mapping.recordTypes[0].actionCoverage[0].action = 'review'; mapping.recordTypes[0].actionCoverage[0].policyIds.push('specialist');
    const approved = { persons: [{ personaId: 'P2', roles: [{ name: 'Resource', scope: 'all' }] }] };
    expect(auditPermissionPolicies(oracle, mapping, approved).representationDetails).toHaveLength(1);
    const unapproved = { persons: [...approved.persons, { personaId: 'P9', roles: [{ name: 'Resource', scope: 'all' }] }] };
    expect(auditPermissionPolicies(oracle, mapping, unapproved).issues.some(item => item.facet === 'roles')).toBe(true);
  });
});
