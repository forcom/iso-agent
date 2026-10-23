import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertOracleApproved, comparePermissions, oracleDigest, refreshPermissionComparison, validatePermissionPersonnel, validatePermissions, validatePermissionSources, validatePolicyComparison, type PermissionOracle, type PermissionMapping } from './permissions';

// Issue #6 authorizes these real-source reads only in an explicitly invoked acceptance preparation.
const args = process.argv.slice(2);
if (!args.includes('--prepare') || args.some(arg => !['--prepare', '--write-comparison'].includes(arg))) {
  throw Error('Explicit preparation required: permissions-prepare.ts --prepare [--write-comparison]');
}
const root = fileURLToPath(new URL('../../../', import.meta.url));
const oraclePath = resolve(root, 'apps/test/acceptance/expected-permissions.json');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
async function read(path: string): Promise<string> {
  const absolute = await realpath(resolve(root, path));
  const inside = relative(root, absolute);
  if (inside === '..' || inside.startsWith(`..${sep}`) || resolve(root, path) !== absolute) throw Error('Source escaped repository or is a symlink');
  return readFile(absolute, 'utf8');
}
const oracle: PermissionOracle = JSON.parse(await readFile(oraclePath, 'utf8'));
const formCodes = new Set<string>();
for (const file of await readdir(resolve(root, 'docs/records'))) {
  if (file.endsWith('.md')) {
    const content = await read(`docs/records/${file}`);
    const form = content.match(/^form_id:\s*"([^"]+)"\s*$/m)?.[1];
    if (form) formCodes.add(form);
  }
}
const errors = validatePermissions(oracle, [...formCodes]);
if (formCodes.size !== 54) errors.push(`Expected 54 source forms, found ${formCodes.size}`);
if (errors.length) throw Error(errors.join('; '));
const policyText = await read('apps/seed/inputs/reviewed-mappings.json');
const personnelText = await read('apps/seed/inputs/aidu-personnel.json');
const mapping: PermissionMapping = JSON.parse(policyText);
errors.push(...await validatePermissionSources(oracle, read));
errors.push(...validatePermissionPersonnel(oracle, JSON.parse(personnelText), hash(personnelText)));
const differences = comparePermissions(oracle, mapping);
if (args.includes('--write-comparison') && errors.length === 0) {
  for (const row of oracle.rows) row.policyScopes ??= null;
  oracle.comparison = refreshPermissionComparison(oracle, mapping, hash(policyText), new Date().toISOString());
  await writeFile(oraclePath, `${JSON.stringify(oracle, null, 2)}\n`);
}
errors.push(...validatePolicyComparison(oracle, mapping, hash(policyText)));
let gateError: string | null = null;
try { assertOracleApproved(oracle, [...formCodes]); } catch (error) { gateError = error instanceof Error ? error.message : String(error); }
const report = {
  preparedAt: new Date().toISOString(), preparationOnly: true, acceptanceExecuted: false,
  oracleSha256: oracleDigest(oracle), sourceFormCount: formCodes.size, rowCount: oracle.rows.length,
  sourceAndBindingErrors: errors, humanAuthor: oracle.humanAuthor, humanReviewer: oracle.humanReviewer,
  unresolvedRowCount: oracle.rows.filter(row => row.status === 'unresolved').length,
  proposedRowCount: oracle.rows.filter(row => row.status === 'proposed').length,
  executionAllowed: errors.length === 0 && gateError === null, gateError, differences,
};
const output = resolve(root, 'output/test/acceptance/permissions-preparation.json');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ report: relative(root, output), rows: oracle.rows.length, differences: differences.length, errors: errors.length, executionAllowed: report.executionAllowed }));
// A successful preparation can still leave human review blocked; it is never an acceptance pass.
if (errors.length) process.exitCode = 1;
