import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertOracleApproved, comparePermissions, oracleDigest, refreshPermissionComparison, summarizeDifferences, validatePermissionPersonnel, validatePermissionSources, validatePermissions, validatePolicyComparison, type PermissionOracle } from './permissions';

const text = '# 3 책임\n\n## 3.1 검토자\n검토자는 합성 기록을 검토한다.\n\n## 3.2 승인자\n승인자는 합성 기록을 승인한다.\n';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const actions = ['create', 'revise', 'submit', 'review', 'approve', 'reject', 'circulate'] as const;
function fixture(): PermissionOracle {
  return {
    schemaVersion: 1, authoredBy: { kind: 'ai', name: 'synthetic author' }, authoredAt: '2026-10-23T00:00:00Z',
    humanAuthor: null, humanReviewer: null, formCodes: ['SYNTHETIC-F01'], personnel: null,
    rows: actions.map(action => ({ formCode: 'SYNTHETIC-F01', action, allowedRoles: ['검토자'],
      allowedPersons: [{ personaId: 'S01', name: '합성 검토자', role: '검토자', scope: 'all' }], deniedSamples: ['S02'],
      source: { path: 'docs/procedure/synthetic.md', clause: '3.1', quote: '검토자는 합성 기록을 검토한다.', sha256: digest(text) },
      additionalSources: [], separation: null, condition: null, states: null, status: 'proposed', note: '합성 기대값' })),
    comparison: null,
  };
}
function approve(oracle: PermissionOracle) {
  oracle.rows.forEach(row => { row.status = 'approved'; });
  const oracleSha256 = oracleDigest(oracle);
  oracle.humanAuthor = { name: 'Human Author', confirmedAt: '2026-10-23T01:00:00Z', oracleSha256 };
  oracle.humanReviewer = { name: 'Human Reviewer', confirmedAt: '2026-10-23T02:00:00Z', oracleSha256 };
  oracle.comparison = { comparedAt: '2026-10-23T03:00:00Z', policiesSha256: digest('synthetic mapping'), oracleSha256, differences: [] };
}
describe('independent acceptance permissions', () => {
  it('blocks absent, duplicate or unknown action rows rather than treating holes as deny', () => {
    const oracle = fixture();
    expect(validatePermissions(oracle, ['SYNTHETIC-F01'])).toEqual([]);
    oracle.rows.pop();
    expect(validatePermissions(oracle, ['SYNTHETIC-F01'])).toContain('Missing SYNTHETIC-F01:circulate');
    oracle.rows.push(oracle.rows[0]);
    expect(validatePermissions(oracle, ['SYNTHETIC-F01'])).toContain('Duplicate SYNTHETIC-F01:create');
    const appointment = fixture();
    appointment.formCodes = ['AIDU-AIP-05-02-F01'];
    appointment.rows.forEach(row => { row.formCode = appointment.formCodes[0]; });
    expect(validatePermissions(appointment, appointment.formCodes)).toContain('Missing AIDU-AIP-05-02-F01:apply_assignment');
    expect(validatePermissions({})).not.toEqual([]);
  });
  it('requires two independent human confirmations tied to the current content and resolved differences', () => {
    const oracle = fixture();
    expect(() => assertOracleApproved(oracle, oracle.formCodes)).toThrow(/human/i);
    approve(oracle);
    expect(() => assertOracleApproved(oracle, oracle.formCodes)).not.toThrow();
    oracle.humanReviewer = oracle.humanAuthor;
    expect(() => assertOracleApproved(oracle, oracle.formCodes)).toThrow(/distinct/i);
    approve(oracle);
    oracle.rows[0].allowedRoles = ['다른 역할'];
    expect(() => assertOracleApproved(oracle, oracle.formCodes)).toThrow();
    oracle.rows[0].allowedRoles = ['검토자'];
    approve(oracle);
    oracle.comparison!.differences.push({ id: 'one', formCode: 'SYNTHETIC-F01', action: 'review', facet: 'roles', expected: ['검토자'], actual: [], resolution: null });
    expect(() => assertOracleApproved(oracle, oracle.formCodes)).toThrow(/unresolved/i);
  });
  it('requires denied samples or a stated reason before execution and separates oracle gaps from policy mismatches', () => {
    const oracle = fixture();
    oracle.rows[0].deniedSamples = [];approve(oracle);
    expect(() => assertOracleApproved(oracle, oracle.formCodes)).toThrow(/denied samples/i);
    oracle.rows[0].noDeniedSampleReason = '모든 임직원이 작성할 수 있어 거부 대상이 없음';approve(oracle);
    expect(() => assertOracleApproved(oracle, oracle.formCodes)).not.toThrow();
    const base = { formCode: 'SYNTHETIC-F01', action: 'review' as const, actual: [], resolution: null };
    expect(summarizeDifferences([{ ...base, id: 'a', facet: 'scope', expected: null }, { ...base, id: 'b', facet: 'roles', expected: ['검토자'] }, { ...base, id: 'c', facet: 'roles', expected: null }]))
      .toEqual({ total: 3, unspecified: 2, mismatch: 1, byFacet: { scope: { unspecified: 1, mismatch: 0 }, roles: { unspecified: 1, mismatch: 1 } } });
  });
  it('verifies quoted words inside the cited clause and detects file drift without reading operational data in regression', async () => {
    const oracle = fixture();
    expect(await validatePermissionSources(oracle, async () => text)).toEqual([]);
    oracle.rows[0].source.clause = '3.2';
    expect(await validatePermissionSources(oracle, async () => text)).toContain('Quote outside clause SYNTHETIC-F01:create:3.2');
    oracle.rows[0].source.path = 'docs/procedure/../../.dev.vars';
    expect(await validatePermissionSources(oracle, async () => { throw Error('must not read'); })).toContain('Invalid source path docs/procedure/../../.dev.vars');
    oracle.rows[0].source.path = 'docs/procedure/synthetic.md';
    expect(await validatePermissionSources(oracle, async () => text + 'changed')).toContain('Source hash changed docs/procedure/synthetic.md');
  });
  it('reports role, state and separation differences without replacing independently authored expectations', () => {
    const oracle = fixture();
    const before = JSON.stringify(oracle);
    const mapping = { roles: [{ id: 'r-other', name: '다른 역할' }], recordTypes: [{ id: 't-one', code: 'SYNTHETIC-F01' }],
      policies: [{ resourceTypeId: 't-one', action: 'review', roleId: 'r-other', stateCondition: 'submitted', separationCondition: 'not_author' }] };
    const differences = comparePermissions(oracle, mapping);
    expect(differences).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'review', facet: 'roles', expected: ['검토자'], actual: ['다른 역할'], resolution: null }),
      expect.objectContaining({ action: 'review', facet: 'states', expected: null, actual: ['submitted'] }),
      expect.objectContaining({ action: 'review', facet: 'separation', expected: null, actual: ['not_author'] }),
    ]));
    expect(JSON.stringify(oracle)).toBe(before);
  });
  it('blocks stale or deleted policy differences even if the file hash is unchanged', () => {
    const oracle = fixture();
    const mapping = { roles: [], recordTypes: [], policies: [] };
    approve(oracle);
    expect(validatePolicyComparison(oracle, mapping, digest('other mapping'))).toEqual(['Policy comparison is stale']);
    expect(validatePolicyComparison(oracle, mapping, digest('synthetic mapping'))).toEqual(['Policy differences changed or missing']);
    oracle.comparison!.differences = comparePermissions(oracle, mapping);
    expect(validatePolicyComparison(oracle, mapping, digest('synthetic mapping'))).toEqual([]);
    oracle.comparison!.differences[0].actual = ['concealed mismatch'];
    expect(validatePolicyComparison(oracle, mapping, digest('synthetic mapping'))).toEqual(['Policy differences changed or missing']);
  });
  it('rejects a persona whose exact name, role or assigned scope no longer matches the frozen personnel input', () => {
    const oracle = fixture();
    oracle.personnel = { path: 'synthetic.json', fictional: true, sha256: digest('personnel') };
    const personnel = { fictional: true, persons: [{ personaId: 'S01', name: '합성 검토자', roles: [{ name: '검토자', scope: 'all' }] }] };
    expect(validatePermissionPersonnel(oracle, personnel, digest('personnel'))).toEqual([]);
    personnel.persons[0].roles[0].scope = 'another-system';
    expect(validatePermissionPersonnel(oracle, personnel, digest('personnel'))).toContain('Invalid personnel binding SYNTHETIC-F01:create:S01');
    expect(validatePermissionPersonnel(oracle, personnel, digest('changed'))).toContain('Personnel input changed');
  });
  it('records unresolved source scope and detects system scope widening and removal of the administrator requirement', () => {
    const oracle = fixture();
    const mapping = { roles: [{ id: 'r-review', name: '검토자' }], recordTypes: [{ id: 't-one', code: 'SYNTHETIC-F01' }],
      policies: [{ resourceTypeId: 't-one', action: 'review', roleId: 'r-review', scopeCondition: { kind: 'system', systemIds: ['synthetic-a'] }, adminRequired: true }] };
    const original = comparePermissions(oracle, mapping).find(diff => diff.action === 'review' && diff.facet === 'scope');
    expect(original).toEqual(expect.objectContaining({ expected: null, actual: [{ role: '검토자', scopeCondition: { kind: 'system', systemIds: ['synthetic-a'] }, adminRequired: true }], resolution: null }));
    mapping.policies[0].scopeCondition.systemIds = ['synthetic-b'];
    expect(comparePermissions(oracle, mapping).find(diff => diff.action === 'review' && diff.facet === 'scope')?.id).not.toBe(original?.id);
    mapping.policies[0].scopeCondition = { kind: 'all', systemIds: [] };
    const widened = comparePermissions(oracle, mapping).find(diff => diff.action === 'review' && diff.facet === 'scope');
    expect(widened?.id).not.toBe(original?.id);
    mapping.policies[0].adminRequired = false;
    expect(comparePermissions(oracle, mapping).find(diff => diff.action === 'review' && diff.facet === 'scope')?.id).not.toBe(widened?.id);
  });
  it('does not carry an old human scope resolution across policy scope changes during preparation', () => {
    const oracle = fixture();
    const mapping = { roles: [{ id: 'r-review', name: '검토자' }], recordTypes: [{ id: 't-one', code: 'SYNTHETIC-F01' }],
      policies: [{ resourceTypeId: 't-one', action: 'review', roleId: 'r-review', scopeCondition: { kind: 'owner' } }] };
    const now = '2026-10-23T03:00:00Z';
    oracle.comparison = refreshPermissionComparison(oracle, mapping, digest('original policy'), now);
    const original = oracle.comparison.differences.find(diff => diff.action === 'review' && diff.facet === 'scope')!;
    original.resolution = { reviewer: 'Human Reviewer', reason: 'Synthetic owner restriction checked', resolvedAt: now };
    expect(refreshPermissionComparison(oracle, mapping, digest('original policy'), now).differences.find(diff => diff.id === original.id)?.resolution).toEqual(original.resolution);
    mapping.policies[0].scopeCondition.kind = 'all';
    const changed = refreshPermissionComparison(oracle, mapping, digest('changed policy'), now);
    expect(changed.differences.find(diff => diff.action === 'review' && diff.facet === 'scope')?.resolution).toBeNull();
    expect(changed.differences.find(diff => diff.action === 'review' && diff.facet === 'scope')?.id).not.toBe(original.id);
    oracle.comparison.policiesSha256 = digest('changed policy');
    expect(validatePolicyComparison(oracle, mapping, digest('changed policy'))).toEqual(['Policy differences changed or missing']);
  });
});
