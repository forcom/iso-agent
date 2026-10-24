import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditPermissionPolicies, type AuditableMapping } from './policy-audit';
import { assertOracleApproved, oracleDigest, validatePermissionPersonnel, validatePermissionSources, type PermissionOracle } from './permissions';

const args = process.argv.slice(2);
if (args.length !== 3 || args[0] !== '--audit' || args[1] !== '--output') throw Error('Explicit acceptance audit required: --audit --output output/test/acceptance/<run>/policy-audit.json');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = resolve(root, args[2]);
if (!relative(resolve(root, 'output/test/acceptance'), output).match(/^[^.]|^\.[^.]/) || !output.endsWith('.json')) throw Error('Audit output must be inside output/test/acceptance');
async function read(path: string) {
  const candidate = resolve(root, path), actual = await realpath(candidate), inside = relative(root, actual);
  if (candidate !== actual || inside === '..' || inside.startsWith(`..${sep}`)) throw Error('Acceptance source must remain inside repository without symlinks');
  return readFile(actual, 'utf8');
}
const oracleText = await read('apps/test/acceptance/expected-permissions.json');
const mappingText = await read('apps/seed/inputs/reviewed-mappings.json');
const personnelText = await read('apps/seed/inputs/aidu-personnel.json');
const oracle: PermissionOracle = JSON.parse(oracleText), mapping: AuditableMapping = JSON.parse(mappingText);
const personnel = JSON.parse(personnelText);
assertOracleApproved(oracle);
const sourceErrors = await validatePermissionSources(oracle, read);
sourceErrors.push(...validatePermissionPersonnel(oracle, personnel, createHash('sha256').update(personnelText).digest('hex')));
const report = { preparedAt: new Date().toISOString(), explicitAcceptanceAudit: true, runtimeExecuted: false,
  mappingSha256: createHash('sha256').update(mappingText).digest('hex'), oracleSha256: oracleDigest(oracle),
  sourceErrors, ...auditPermissionPolicies(oracle, mapping, personnel) };
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output: relative(root, output), rows: report.rowCount, forms: report.formCount,
  sourceErrors: sourceErrors.length, structuralIssues: report.issues.length, runtimeExecuted: false }));
if (sourceErrors.length || report.issues.length) process.exitCode = 1;
