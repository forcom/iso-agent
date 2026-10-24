import { createHash } from 'node:crypto';

export type PermissionAction = 'create' | 'revise' | 'submit' | 'review' | 'approve' | 'reject' | 'circulate' | 'apply_assignment';
export interface PermissionSource { path: string; clause: string; quote: string; sha256: string }
export interface PermissionPerson { personaId: string; name: string; role: string; scope: string; installedRole?: string }
export interface PermissionCase {
  informationId: string; sourcePath: string; sourceSha256: string; systemCode: string;
  allowedPersons: PermissionPerson[]; deniedSamples: string[];
  evidence: { lineStart: number; lineEnd: number; quote: string }[]; note: string;
}
export interface PermissionRow {
  formCode: string; action: PermissionAction; allowedRoles: string[]; allowedPersons: PermissionPerson[]; deniedSamples: string[];
  source: PermissionSource; additionalSources: PermissionSource[]; separation: string | null; condition: string | null;
  states: string[] | null; status: 'proposed' | 'unresolved' | 'approved'; note: string;
  /** Required by the execution gate when no denied sample can exist for the row. */
  noDeniedSampleReason?: string;
  policyScopes?: { role: string; scopeCondition: Record<string, unknown> | null; adminRequired: boolean }[] | null;
  /** Record-specific candidates override the form-level union; original decisions are never imported. */
  recordCases?: PermissionCase[];
}
export interface HumanConfirmation { name: string; confirmedAt: string; oracleSha256: string }
export interface PermissionDifference {
  id: string; formCode: string; action: PermissionAction; facet: string; expected: unknown; actual: unknown;
  resolution: { reviewer: string; reason: string; resolvedAt: string; outcome?: 'equivalent' | 'expected_value_controls' } | null;
}
export interface PermissionOracle {
  schemaVersion: 1; authoredBy: { kind: 'ai'; name: string }; authoredAt: string;
  humanAuthor: HumanConfirmation | null; humanReviewer: HumanConfirmation | null; formCodes: string[];
  personnel: { path: string; sha256: string; fictional: boolean } | null;
  roleBindings?: { sourceRole: string; installedRole: string; note: string }[];
  independence?: { initialRoleDraftSha256: string; note: string };
  rows: PermissionRow[];
  comparison: { comparedAt: string; policiesSha256: string; oracleSha256: string; differences: PermissionDifference[] } | null;
}
export interface PermissionMapping {
  roles: { id: string; name: string }[];
  recordTypes: { id: string; code: string }[];
  policies: { resourceTypeId: string; action: string; roleId: string; stateCondition?: string | string[]; separationCondition?: string; conditions?: unknown[]; scopeCondition?: unknown; adminRequired?: boolean }[];
  productPolicies?: unknown[];
}
const baseActions: PermissionAction[] = ['create', 'revise', 'submit', 'review', 'approve', 'reject', 'circulate'];
const shaPattern = /^[a-f0-9]{64}$/;
const sourcePath = /^docs\/(manual|procedure|guide)\/[A-Za-z0-9_-]+\.md$/;
const recordPath = /^docs\/records\/(?!README\.md$)[A-Za-z0-9_-]+\.md$/;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string' && item.trim());
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const unique = (values: string[]) => [...new Set(values)].sort();
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function oracleDigest(oracle: PermissionOracle): string {
  const { humanAuthor: _author, humanReviewer: _reviewer, comparison: _comparison, ...authored } = oracle;
  return hash(stable(authored));
}

export function permissionCandidates(row: PermissionRow | undefined, record: { informationId: string; sourcePath: string; sourceSha256: string; systemCode: string }): PermissionPerson[] {
  if (!row) return [];
  if (!row.recordCases) return row.allowedPersons;
  return row.recordCases.find(item => item.informationId === record.informationId && item.sourcePath === record.sourcePath && item.sourceSha256 === record.sourceSha256 && item.systemCode === record.systemCode)?.allowedPersons ?? [];
}

/** Structural validation has no filesystem reads; preparation alone reads operational sources. */
export function validatePermissions(input: unknown, requiredFormCodes?: string[]): string[] {
  if (!object(input) || input.schemaVersion !== 1 || !strings(input.formCodes) || !Array.isArray(input.rows)) return ['Invalid permission oracle'];
  const errors: string[] = [];
  if (!object(input.authoredBy) || input.authoredBy.kind !== 'ai' || !nonempty(input.authoredBy.name)) errors.push('Missing AI authorship disclosure');
  const forms = input.formCodes;
  if (new Set(forms).size !== forms.length) errors.push('Duplicate form codes');
  if (requiredFormCodes ? stable(unique(forms)) !== stable(unique(requiredFormCodes)) : forms.length !== 54) errors.push('Acceptance form coverage mismatch');
  const seen = new Set<string>();
  for (const row of input.rows) {
    if (!object(row) || !nonempty(row.formCode) || !nonempty(row.action)) { errors.push('Malformed permission row'); continue; }
    const key = `${row.formCode}:${row.action}`;
    if (seen.has(key)) errors.push(`Duplicate ${key}`);
    seen.add(key);
    const actions = row.formCode === 'AIDU-AIP-05-02-F01' ? [...baseActions, 'apply_assignment'] : baseActions;
    if (!forms.includes(row.formCode) || !actions.includes(row.action as PermissionAction)) errors.push(`Unexpected ${key}`);
    if (!strings(row.allowedRoles) || new Set(row.allowedRoles).size !== row.allowedRoles.length || !Array.isArray(row.allowedPersons) || !strings(row.deniedSamples)) { errors.push(`Invalid actors ${key}`); continue; }
    const formActors = row.allowedPersons;
    for (const person of row.allowedPersons) {
      if (!object(person) || !nonempty(person.personaId) || !nonempty(person.name) || !nonempty(person.role) || !nonempty(person.scope) || !row.allowedRoles.includes(person.role)) errors.push(`Invalid person ${key}`);
    }
    if (row.recordCases !== undefined) {
      if (!Array.isArray(row.recordCases) || !row.recordCases.length) errors.push(`Invalid record cases ${key}`);
      else {
        const ids = new Set<string>();
        for (const item of row.recordCases) {
          if (!object(item) || !nonempty(item.informationId) || !nonempty(item.sourcePath) || !recordPath.test(item.sourcePath) || !shaPattern.test(String(item.sourceSha256)) || !nonempty(item.systemCode) || !nonempty(item.note)
            || !Array.isArray(item.allowedPersons) || !item.allowedPersons.length || !strings(item.deniedSamples) || !item.deniedSamples.length
            || !Array.isArray(item.evidence) || !item.evidence.length || item.evidence.some(proof => !object(proof) || !Number.isInteger(proof.lineStart) || Number(proof.lineStart) < 1 || !Number.isInteger(proof.lineEnd) || Number(proof.lineEnd) < Number(proof.lineStart) || !nonempty(proof.quote))) {
            errors.push(`Invalid record case ${key}`); continue;
          }
          if (ids.has(item.informationId)) errors.push(`Duplicate record case ${key}:${item.informationId}`);
          ids.add(item.informationId);
          const caseActors = item.allowedPersons;
          if (caseActors.some(person => !formActors.some(candidate => stable(candidate) === stable(person)))) errors.push(`Record case actor outside form candidates ${key}:${item.informationId}`);
          if (item.deniedSamples.some(id => caseActors.some(person => object(person) && person.personaId === id))) errors.push(`Record case actor also denied ${key}:${item.informationId}`);
        }
      }
    }
    if (!['proposed', 'unresolved', 'approved'].includes(String(row.status)) || !nonempty(row.note)) errors.push(`Invalid review status ${key}`);
    for (const field of ['condition', 'separation']) if (row[field] !== null && !nonempty(row[field])) errors.push(`Invalid ${field} ${key}`);
    if (row.states !== null && !strings(row.states)) errors.push(`Invalid states ${key}`);
    if (row.noDeniedSampleReason !== undefined && !nonempty(row.noDeniedSampleReason)) errors.push(`Invalid denied-sample reason ${key}`);
    if (row.policyScopes !== undefined && row.policyScopes !== null && (!Array.isArray(row.policyScopes) || row.policyScopes.some(scope => !object(scope) || !nonempty(scope.role) || (scope.scopeCondition !== null && !object(scope.scopeCondition)) || typeof scope.adminRequired !== 'boolean'))) errors.push(`Invalid policy scopes ${key}`);
    if (!Array.isArray(row.additionalSources)) { errors.push(`Invalid sources ${key}`); continue; }
    for (const source of [row.source, ...row.additionalSources]) {
      if (!object(source) || !nonempty(source.path) || !sourcePath.test(source.path) || !nonempty(source.clause) || !nonempty(source.quote) || !shaPattern.test(String(source.sha256))) errors.push(`Invalid source ${key}`);
    }
  }
  for (const form of forms) for (const action of form === 'AIDU-AIP-05-02-F01' ? [...baseActions, 'apply_assignment'] : baseActions) {
    if (!seen.has(`${form}:${action}`)) errors.push(`Missing ${form}:${action}`);
  }
  return errors;
}

export function assertOracleApproved(input: unknown, requiredFormCodes?: string[]): asserts input is PermissionOracle {
  const errors = validatePermissions(input, requiredFormCodes);
  if (errors.length) throw Error(errors.join('; '));
  const oracle = input as PermissionOracle;
  const confirmation = (person: HumanConfirmation | null) => person && nonempty(person.name) && Number.isFinite(Date.parse(person.confirmedAt)) && person.oracleSha256 === oracleDigest(oracle);
  if (!confirmation(oracle.humanAuthor) && !confirmation(oracle.humanReviewer)) throw Error('Human confirmation of current oracle content required');
  if (oracle.rows.some(row => row.status !== 'approved')) throw Error('Unresolved permission rows');
  // AT-03/07 judge refusals against these samples; an empty list is not "everyone allowed".
  if (oracle.rows.some(row => !row.deniedSamples.length && !nonempty(row.noDeniedSampleReason))) throw Error('Each row needs denied samples or a stated reason');
  if (!oracle.comparison || !shaPattern.test(oracle.comparison.policiesSha256) || oracle.comparison.oracleSha256 !== oracleDigest(oracle) || !Number.isFinite(Date.parse(oracle.comparison.comparedAt)) || !Array.isArray(oracle.comparison.differences)) throw Error('Current policy comparison required');
  if (oracle.comparison.differences.some(diff => !diff.resolution || !nonempty(diff.resolution.reviewer) || !nonempty(diff.resolution.reason) || !Number.isFinite(Date.parse(diff.resolution.resolvedAt)))) throw Error('Unresolved policy differences');
}

export async function validatePermissionSources(oracle: PermissionOracle, readText: (path: string) => Promise<string>): Promise<string[]> {
  const errors: string[] = []; const cache = new Map<string, Promise<string>>();
  for (const row of oracle.rows) for (const source of [row.source, ...row.additionalSources]) {
    if (!sourcePath.test(source.path)) { errors.push(`Invalid source path ${source.path}`); continue; }
    try {
      if (!cache.has(source.path)) cache.set(source.path, readText(source.path));
      const text = await cache.get(source.path)!;
      if (hash(text) !== source.sha256) errors.push(`Source hash changed ${source.path}`);
      const lines = text.split(/\r?\n/);
      const start = lines.findIndex(line => /^#{1,6}\s/.test(line) && line.replace(/^#+\s+/, '').split(/\s/)[0] === source.clause);
      const level = start < 0 ? 0 : lines[start].match(/^#+/)![0].length;
      let end = start + 1;
      while (end < lines.length && (!/^#{1,6}\s/.test(lines[end]) || lines[end].match(/^#+/)![0].length > level)) end++;
      if (start < 0 || !lines.slice(start, end).join('\n').includes(source.quote)) errors.push(`Quote outside clause ${row.formCode}:${row.action}:${source.clause}`);
    } catch { errors.push(`Unreadable source ${source.path}`); }
  }
  for (const row of oracle.rows) for (const item of row.recordCases ?? []) {
    if (!recordPath.test(item.sourcePath)) { errors.push(`Invalid record case path ${item.sourcePath}`); continue; }
    try {
      if (!cache.has(item.sourcePath)) cache.set(item.sourcePath, readText(item.sourcePath));
      const text = await cache.get(item.sourcePath)!;
      if (hash(text) !== item.sourceSha256) errors.push(`Record case hash changed ${item.informationId}`);
      const front = text.replace(/\r\n?/g, '\n').match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1] ?? '';
      const field = (key: string) => front.match(new RegExp(`^${key}:\\s*"([^"\\n]+)"\\s*$`, 'm'))?.[1];
      if (field('information_id') !== item.informationId || field('form_id') !== row.formCode) errors.push(`Record case identity changed ${item.informationId}`);
      const lines = text.replace(/\r\n?/g, '\n').split('\n');
      for (const proof of item.evidence) if (proof.lineStart < 1 || proof.lineEnd < proof.lineStart || proof.lineEnd > lines.length || lines.slice(proof.lineStart - 1, proof.lineEnd).join('\n') !== proof.quote) errors.push(`Record case quote changed ${item.informationId}`);
    } catch { errors.push(`Unreadable record case ${item.sourcePath}`); }
  }
  return unique(errors);
}

export function comparePermissions(oracle: PermissionOracle, mapping: PermissionMapping): PermissionDifference[] {
  const differences: PermissionDifference[] = [];
  const types = new Map(mapping.recordTypes.map(type => [type.code, type.id]));
  const roles = new Map(mapping.roles.map(role => [role.id, role.name]));
  for (const row of oracle.rows) {
    const policies = mapping.policies.filter(policy => policy.resourceTypeId === types.get(row.formCode) && policy.action === row.action);
    const expectedRoles = unique(row.allowedRoles.flatMap(role => {
      const bindings = oracle.roleBindings?.filter(binding => binding.sourceRole === role);
      return bindings?.length ? bindings.map(binding => binding.installedRole) : [role];
    }));
    const facts: [string, unknown, unknown][] = [
      ['roles', expectedRoles, unique(policies.map(policy => roles.get(policy.roleId) ?? `unknown:${policy.roleId}`))],
      ['scope', row.policyScopes ?? null, policies.map(policy => ({ role: roles.get(policy.roleId) ?? `unknown:${policy.roleId}`, scopeCondition: policy.scopeCondition ?? null, adminRequired: policy.adminRequired ?? false }))],
      ['states', row.states === null ? null : unique(row.states), unique(policies.flatMap(policy => policy.stateCondition ? Array.isArray(policy.stateCondition) ? policy.stateCondition : [policy.stateCondition] : []))],
      ['separation', row.separation, unique(policies.map(policy => policy.separationCondition ?? 'none'))],
      ['condition', row.condition, policies.filter(policy => policy.conditions?.length).map(policy => ({ role: roles.get(policy.roleId) ?? policy.roleId, conditions: policy.conditions }))],
    ];
    for (const [facet, expected, actual] of facts) {
      if (facet === 'condition' && expected === null && Array.isArray(actual) && actual.length === 0) continue;
      if (facet === 'separation' && expected === null && stable(actual) === '["none"]') continue;
      if (stable(expected) !== stable(actual)) differences.push({ id: hash(stable({ formCode: row.formCode, action: row.action, facet, expected, actual })), formCode: row.formCode, action: row.action, facet, expected, actual, resolution: null });
    }
  }
  return differences;
}

export function refreshPermissionComparison(oracle: PermissionOracle, mapping: PermissionMapping, policiesSha256: string, comparedAt: string): NonNullable<PermissionOracle['comparison']> {
  const previous = oracle.comparison;
  const oracleSha256 = oracleDigest(oracle);
  const sameInputs = previous?.oracleSha256 === oracleSha256 && previous.policiesSha256 === policiesSha256;
  return { comparedAt, policiesSha256, oracleSha256, differences: comparePermissions(oracle, mapping).map(diff => ({ ...diff,
    resolution: sameInputs ? previous.differences.find(saved => saved.id === diff.id)?.resolution ?? null : null })) };
}

/** Recompute differences so editing the saved comparison cannot silently discard new policy differences. */
export function validatePolicyComparison(oracle: PermissionOracle, mapping: PermissionMapping, policiesSha256: string): string[] {
  if (!oracle.comparison || oracle.comparison.policiesSha256 !== policiesSha256 || oracle.comparison.oracleSha256 !== oracleDigest(oracle)) return ['Policy comparison is stale'];
  const content = ({ resolution: _resolution, ...diff }: PermissionDifference) => stable(diff);
  const actual = comparePermissions(oracle, mapping).map(content).sort();
  const saved = oracle.comparison.differences.map(content).sort();
  return stable(actual) === stable(saved) ? [] : ['Policy differences changed or missing'];
}

export function validatePermissionPersonnel(oracle: PermissionOracle, personnel: { fictional: boolean; persons: { personaId: string; name: string; roles: { name: string; scope: string }[] }[] }, sha256: string): string[] {
  const errors: string[] = [];
  if (!oracle.personnel || oracle.personnel.sha256 !== sha256 || oracle.personnel.fictional !== personnel.fictional) errors.push('Personnel input changed');
  for (const row of oracle.rows) for (const actor of [...row.allowedPersons, ...(row.recordCases ?? []).flatMap(item => item.allowedPersons)]) {
    const person = personnel.persons.find(person => person.personaId === actor.personaId);
    const binding = oracle.roleBindings?.find(binding => binding.sourceRole === actor.role)?.installedRole ?? actor.role;
    if (person?.name !== actor.name || (actor.installedRole && actor.installedRole !== binding) || !person?.roles.some(role => role.name === binding && role.scope === actor.scope)) errors.push(`Invalid personnel binding ${row.formCode}:${row.action}:${actor.personaId}`);
  }
  return errors;
}

/** An unspecified facet (oracle value null) is a gap in the oracle, not a disagreement with policy. */
export function summarizeDifferences(differences: PermissionDifference[]) {
  const summary = { total: differences.length, unspecified: 0, mismatch: 0, byFacet: {} as Record<string, { unspecified: number; mismatch: number }> };
  for (const diff of differences) {
    const kind = diff.expected === null ? 'unspecified' : 'mismatch';
    summary[kind]++; (summary.byFacet[diff.facet] ??= { unspecified: 0, mismatch: 0 })[kind]++;
  }
  return summary;
}
